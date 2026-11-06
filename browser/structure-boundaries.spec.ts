import { expect, test } from './editing-fixture'
import type {} from '../debug/testing'

for (const mode of ['input', 'vertical'] as const) {
  for (const side of ['before', 'after'] as const) {
    test(`ruby ${side} input and adjacent arrow navigation ${mode}`, async ({ page }) => {
      await page.goto('/testing.html')
      await page.waitForFunction(() => !!window.__EDITING__)
      await page.evaluate(async ({ mode, side }) => {
        await window.__EDITING__.create('boundary', { source: '前{東京|とうきょう}後', mode })
        window.__EDITING__.select('boundary', side === 'before' ? 2 : 3)
      }, { mode, side })
      await page.keyboard.insertText('日')
      await expect(page.locator('#boundary ruby')).toHaveAttribute('data-mdi-base', '東京')
      await expect(page.locator('#boundary ruby rt')).toHaveText('とうきょう')
      const saved = await page.evaluate(() => window.__EDITING__.snapshot('boundary').source)
      expect(saved).toContain(side === 'before' ? '前日{東京|とうきょう}後' : '前{東京|とうきょう}日後')
      await page.keyboard.press('ArrowLeft')
      await page.keyboard.press('ArrowRight')
      await page.locator('#boundary ruby').click()
      expect(await page.evaluate(() => window.__EDITING__.errors)).toEqual([])
    })
  }
}

for (const key of ['Backspace', 'Delete']) {
  test(`ruby atomic deletion ${key}`, async ({ page }) => {
    await page.goto('/testing.html')
    await page.waitForFunction(() => !!window.__EDITING__)
    await page.evaluate(async key => {
      await window.__EDITING__.create('boundary', { source: '前{東京|とうきょう}後', mode: 'input' })
      window.__EDITING__.select('boundary', key === 'Backspace' ? 3 : 2)
    }, key)
    await page.keyboard.press(key)
    // ProseMirror may first select the atom; a second key deletes that selection.
    if (await page.locator('#boundary ruby').count()) await page.keyboard.press(key)
    await expect(page.locator('#boundary ruby')).toHaveCount(0)
    expect(await page.evaluate(() => window.__EDITING__.snapshot('boundary').source)).toBe('前後\n')
  })
}
