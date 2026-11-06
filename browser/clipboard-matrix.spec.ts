import { expect, test } from './editing-fixture'
import type {} from '../debug/testing'

for (const source of ['', '前後', '- 前後', '> 前後']) {
  for (const format of ['text/plain', 'text/html', 'application/x-illusion-markdown;version=2.0']) {
    test(`synthetic paste ${format} into ${JSON.stringify(source)}`, async ({ page }) => {
      await page.goto('/testing.html')
      await page.waitForFunction(() => !!window.__EDITING__)
      await page.evaluate(async ({ source, format }) => {
        await window.__EDITING__.create('target', { source, mode: 'input' })
        const nested = source.startsWith('-') ? 4 : source.startsWith('>') ? 3 : source ? 2 : 1
        window.__EDITING__.select('target', nested)
        const data = new DataTransfer()
        data.setData(format, format === 'text/html' ? '<p>貼付</p><p>二行</p>' : format === 'text/plain' ? '貼付\n二行' : '{貼付|はりつけ}')
        const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data })
        Object.defineProperty(event, 'clipboardData', { value: data })
        document.querySelector('#target .ProseMirror')!.dispatchEvent(event)
      }, { source, format })
      await expect(page.locator('#target .ProseMirror')).toContainText('貼付')
      if (format.startsWith('application/')) await expect(page.locator('#target ruby')).toHaveCount(1)
      const saved = await page.evaluate(() => window.__EDITING__.snapshot('target').source)
      await page.evaluate(async source => window.__EDITING__.rebuild('target', source), saved)
      expect(await page.evaluate(() => window.__EDITING__.snapshot('target').source)).toBe(saved)
      expect(await page.evaluate(() => window.__EDITING__.errors)).toEqual([])
    })
  }
}


for (const operation of ['copy', 'cut'] as const) {
  test(`synthetic cross-paragraph ${operation} and cross-editor paste`, async ({ page }) => {
    await page.goto('/testing.html')
    await page.waitForFunction(() => !!window.__EDITING__)
    const payload = await page.evaluate(async operation => {
      await window.__EDITING__.create('origin', { source: '前{字|じ}\n\n後', mode: 'input' })
      await window.__EDITING__.create('destination', { source: '置換', mode: 'input' })
      window.__EDITING__.select('origin', 1, 6)
      const clipboardData = new DataTransfer()
      const event = new ClipboardEvent(operation, { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'clipboardData', { value: clipboardData })
      document.querySelector('#origin .ProseMirror')!.dispatchEvent(event)
      // Firefox clones the supplied DataTransfer; read the event's actual store.
      return Array.from(event.clipboardData!.types).map(type => [type, event.clipboardData!.getData(type)])
    }, operation)
    expect(payload.length).toBeGreaterThan(0)
    await page.evaluate(payload => {
      const clipboardData = new DataTransfer()
      for (const [type, value] of payload) clipboardData.setData(type, value)
      window.__EDITING__.select('destination', 1, 3)
      const paste = new ClipboardEvent('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(paste, 'clipboardData', { value: clipboardData })
      document.querySelector('#destination .ProseMirror')!.dispatchEvent(paste)
    }, payload)
    await expect(page.locator('#destination .ProseMirror')).toContainText('前')
    await expect(page.locator('#destination ruby')).toHaveCount(1)
    await expect(page.locator('#destination .ProseMirror')).not.toContainText('置換')
    if (operation === 'cut') await expect(page.locator('#origin .ProseMirror')).not.toContainText('前')
    const source = await page.evaluate(() => window.__EDITING__.snapshot('destination').source)
    await page.evaluate(() => window.__EDITING__.history('destination', 'undo'))
    await expect(page.locator('#destination .ProseMirror')).toHaveText('置換')
    await page.evaluate(() => window.__EDITING__.history('destination', 'redo'))
    expect(await page.evaluate(() => window.__EDITING__.snapshot('destination').source)).toBe(source)
  })
}

test('synthetic first composition after external plain-text paste', async ({ page }) => {
  await page.goto('/testing.html')
  await page.waitForFunction(() => !!window.__EDITING__)
  await page.evaluate(async () => {
    await window.__EDITING__.create('pasted', { source: '', mode: 'input' })
    window.__EDITING__.select('pasted', 1)
    const data = new DataTransfer()
    data.setData('text/plain', '外部')
    const root = document.querySelector('#pasted .ProseMirror')!
    const paste = new ClipboardEvent('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(paste, 'clipboardData', { value: data })
    root.dispatchEvent(paste)
  })
  await expect(page.locator('#pasted .ProseMirror')).toHaveText('外部')
  await page.evaluate(() => {
    const root = document.querySelector('#pasted .ProseMirror')!
    root.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    const text = document.createTextNode('t')
    root.querySelector('p')!.append(text)
    window.getSelection()!.collapse(text, 1)
  })
  await expect.poll(() => page.evaluate(() => window.__EDITING__.snapshot('pasted').source)).toContain('外部t')
  await page.evaluate(() => {
    const root = document.querySelector('#pasted .ProseMirror')!
    const text = root.querySelector('p')!.lastChild!
    text.textContent = 'ち'
    window.getSelection()!.collapse(text, 1)
    root.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'ち' }))
  })
  await expect.poll(() => page.evaluate(() => window.__EDITING__.snapshot('pasted').source)).toContain('外部ち')
})
