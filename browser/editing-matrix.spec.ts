import { expect, test } from './editing-fixture'
import { comparable, editingScenarios } from '../test/scenarios/editing'
import type {} from '../debug/testing'

for (const scenario of editingScenarios) {
  test(`default editing: ${scenario.name}`, async ({ page }) => {
    await page.goto('/testing.html')
    await page.waitForFunction(() => !!window.__EDITING__)
    for (const mode of ['commonmark', 'mdi'] as const) {
      await page.evaluate(async ({ mode, scenario }) => {
        await window.__EDITING__.create(mode, { source: scenario.source, mode })
        window.__EDITING__.select(mode, scenario.from, 'to' in scenario ? scenario.to : scenario.from)
      }, { mode, scenario })
      if ('key' in scenario) await page.keyboard.press(scenario.key)
      else await page.keyboard.insertText(scenario.text)
    }
    const states = await page.evaluate(() => ['commonmark', 'mdi'].map(id => window.__EDITING__.snapshot(id)))
    const expected = comparable(states[0].doc)
    if (expected.content.length > 1) {
      for (const node of expected.content) {
        if (node.type === 'paragraph' && !node.content?.length) node.attrs = { ...node.attrs, mdiBlank: true }
      }
    }
    expect(comparable(states[1].doc)).toEqual(expected)
    expect(states[1].selection).toEqual(states[0].selection)
    expect(await page.evaluate(() => window.__EDITING__.errors)).toEqual([])
  })
}

for (const mode of ['commonmark', 'mdi', 'input', 'vertical'] as const) {
  for (const prepared of mode === 'commonmark' ? [false] : [false, true]) {
    test(`isolated lifecycle ${mode} prepared=${prepared}`, async ({ page }) => {
      await page.goto('/testing.html')
      await page.waitForFunction(() => !!window.__EDITING__)
      await page.evaluate(async ({ mode, prepared }) => {
        await window.__EDITING__.create('one', { source: 'first', mode, prepared })
        await window.__EDITING__.create('two', { source: 'second', mode, prepared })
        window.__EDITING__.select('one', 3)
      }, { mode, prepared })
      const second = await page.evaluate(() => window.__EDITING__.snapshot('two'))
      await page.keyboard.insertText('日')
      const saved = await page.evaluate(() => window.__EDITING__.snapshot('one').source)
      await page.evaluate(async source => {
        await window.__EDITING__.rebuild('one', source)
      }, saved)
      expect(await page.evaluate(() => window.__EDITING__.snapshot('one').source)).toBe(saved)
      expect(await page.evaluate(() => window.__EDITING__.snapshot('two'))).toEqual(second)
      expect(await page.evaluate(() => window.__EDITING__.errors)).toEqual([])
    })
  }
}

test('select all, delete, and type again', async ({ page }) => {
  await page.goto('/testing.html')
  await page.waitForFunction(() => !!window.__EDITING__)
  await page.evaluate(async () => {
    await window.__EDITING__.create('clear', { source: '前\n\n後', mode: 'mdi' })
    window.__EDITING__.select('clear', 1)
  })
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Backspace')
  await page.keyboard.insertText('再入力')
  const state = await page.evaluate(() => window.__EDITING__.snapshot('clear'))
  expect(state.doc.content).toHaveLength(1)
  expect(state.doc.content[0].type).toBe('paragraph')
  expect(state.source).toBe('再入力\n')
  expect(state.selection).toMatchObject({ anchor: 4, head: 4 })
})
