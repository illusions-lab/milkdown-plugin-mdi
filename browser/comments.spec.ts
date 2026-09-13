import { expect, test } from '@playwright/test'

test('hidden comments survive adjacent edits, undo, saving and reopening', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => window.__MDI_SMOKE__?.ready)
  const original = '<!--block note-->\n\nBefore<!--inline note-->after'
  await page.evaluate(source => {
    const api = (window as unknown as { __MDI_WARICHU__: { load(source: string): string; select(from: number): void } }).__MDI_WARICHU__
    api.load(source)
    api.select(2)
  }, original)
  const comments = page.locator('.ProseMirror [data-mdi-comment]')
  await expect(comments).toHaveCount(2)
  expect(await comments.evaluateAll(nodes => nodes.every(node => getComputedStyle(node).display === 'none'))).toBe(true)
  await page.keyboard.insertText('New ')
  const source = () => page.evaluate(() => (window as unknown as { __MDI_WARICHU__: { source(): string } }).__MDI_WARICHU__.source())
  await expect.poll(source).toContain('New Before<!--inline note-->after')
  await page.evaluate(() => (window as unknown as { __MDI_WARICHU__: { undo(): void } }).__MDI_WARICHU__.undo())
  await expect.poll(source).toBe(`${original}\n`)
  const saved = await source()
  await page.evaluate(source => (window as unknown as { __MDI_WARICHU__: { load(source: string): string } }).__MDI_WARICHU__.load(source), saved)
  expect(await source()).toBe(saved)
  expect(await page.locator('.ProseMirror').innerText()).not.toContain('note')
  await expect(comments).toHaveCount(2)
})
