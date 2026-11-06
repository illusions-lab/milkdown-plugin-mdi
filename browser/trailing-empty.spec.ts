import { test, expect } from './editing-fixture'

for (const prepared of [false, true]) {
  for (const count of [1, 3]) {
    test(`${count} terminal Enter blocks survive three save/reopens prepared=${prepared}`, async ({ page }) => {
      await page.goto('/testing.html')
      await page.waitForFunction(() => !!window.__EDITING__)
      await page.evaluate(async prepared => {
        await window.__EDITING__.create('terminal', { source: '字', mode: 'mdi', prepared })
        window.__EDITING__.select('terminal', 2)
      }, prepared)
      for (let i = 0; i < count; i++) await page.keyboard.press('Enter')
      await expect(page.locator('#terminal p')).toHaveCount(count + 1)
      const before = await page.evaluate(() => window.__EDITING__.snapshot('terminal'))
      for (let i = 0; i < 3; i++) {
        await page.evaluate(async () => {
          const source = window.__EDITING__.snapshot('terminal').source
          await window.__EDITING__.rebuild('terminal', source)
        })
        await expect(page.locator('#terminal p')).toHaveCount(count + 1)
        const after = await page.evaluate(() => window.__EDITING__.snapshot('terminal'))
        expect(after.doc).toEqual(before.doc)
        expect(after.source).toBe(before.source)
      }
    })
  }
}
