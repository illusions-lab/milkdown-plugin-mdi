import { expect, test } from '@playwright/test'

// Synthetic DOM/composition regression checks, not an OS IME test.
for (const source of ['前\n\n後', '前']) {
  test(`retains the IME text node until composition ends: ${JSON.stringify(source)}`, async ({ page }) => {
    await page.goto('/')
    await page.waitForFunction(() => window.__MDI_SMOKE__?.ready)
    await page.evaluate(source => {
      const api = (window as any).__MDI_WARICHU__
      api.load(source)
      api.select(2)
    }, source)
    await page.keyboard.press('Enter')
    await expect(page.locator('#editor h1')).toHaveCount(0)
    const blank = page.locator('#editor [contenteditable="true"] p').nth(1)
    await expect(blank).toBeEmpty()
    await page.evaluate(() => {
      const root = document.querySelector('#editor [contenteditable="true"]')!
      const paragraph = root.querySelectorAll('p')[1]!
      const markedBlank = paragraph.hasAttribute('data-mdi-blank')
      root.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
      const text = document.createTextNode('t')
      paragraph.replaceChildren(text)
      const selection = window.getSelection()!
      selection.collapse(text, 1)
      ;(window as any).__blankComposition = { paragraph, text, root, markedBlank }
    })
    await expect.poll(() => page.evaluate(() => (window as any).__MDI_WARICHU__.source())).toContain('t')
    expect(await page.evaluate(() => {
      const { paragraph, text, markedBlank } = (window as any).__blankComposition
      return paragraph.isConnected && text.parentNode === paragraph && paragraph.hasAttribute('data-mdi-blank') === markedBlank
    })).toBe(true)
    await page.evaluate(() => {
      const { text, root } = (window as any).__blankComposition
      text.data = 'ち'
      window.getSelection()!.collapse(text, 1)
      root.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'ち' }))
    })
    await expect(page.locator('#editor p[data-mdi-blank]')).toHaveCount(0)
    expect(await page.evaluate(() => (window as any).__MDI_WARICHU__.source())).toContain('ち')
  })
}
