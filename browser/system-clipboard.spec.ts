import { expect, test } from './editing-fixture'
import type {} from '../debug/testing'

test('Chromium system clipboard: copy between instances and paste with keyboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/testing.html')
  await page.waitForFunction(() => !!window.__EDITING__)
  await page.evaluate(async () => {
    await window.__EDITING__.create('from', { source: '日本語', mode: 'input' })
    await window.__EDITING__.create('to', { source: '', mode: 'input' })
    window.__EDITING__.select('from', 1, 4)
  })
  await page.keyboard.press('ControlOrMeta+c')
  await page.evaluate(() => window.__EDITING__.select('to', 1))
  await page.keyboard.press('ControlOrMeta+v')
  await expect(page.locator('#to .ProseMirror')).toHaveText('日本語')
  expect(await page.evaluate(() => window.__EDITING__.errors)).toEqual([])
})
