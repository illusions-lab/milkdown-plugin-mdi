import { expect, test } from '@playwright/test'

for (const source of ['> text', '- text', '1. text']) {
  test(`native HTML paste cannot introduce nested layout: ${source}`, async ({ page }) => {
    await page.goto('/')
    await page.waitForFunction(() => window.__MDI_SMOKE__?.ready)
    await page.evaluate(source => {
      const api = (window as any).__MDI_WARICHU__
      api.load(source)
      api.select(source.startsWith('>') ? 2 : 3)
    }, source)
    await page.evaluate(() => {
      const root = document.querySelector('#editor [contenteditable="true"]')!
      const data = new DataTransfer()
      data.setData('text/html', '<p data-mdi-indent="2">pasted layout</p>')
      data.setData('text/plain', 'pasted layout')
      root.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }))
    })
    await expect(page.locator('#editor blockquote, #editor ul, #editor ol')).toHaveCount(1)
    await expect(page.locator('#editor .ProseMirror')).toContainText('text')
    await expect(page.locator('#editor p[data-mdi-indent]')).toHaveCount(0)
  })
}

test('rejects cross-editor HTML carrying nested layout as one transaction', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => window.__MDI_SMOKE__?.ready)
  const before = await page.evaluate(() => {
    const api = (window as any).__MDI_WARICHU__
    api.load('text')
    api.select(2)
    return api.source()
  })
  await page.evaluate(() => {
    const data = new DataTransfer()
    data.setData('text/html', '<div data-pm-slice="0 0 []"><blockquote><p data-mdi-indent="2">invalid</p></blockquote></div>')
    document.querySelector('#editor [contenteditable="true"]')!.dispatchEvent(
      new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }),
    )
  })
  expect(await page.evaluate(() => (window as any).__MDI_WARICHU__.source())).toBe(before)
})
