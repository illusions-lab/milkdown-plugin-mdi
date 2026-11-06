import { expect, test } from '@playwright/test'

for (const structured of [false, true]) test.describe(`clipboard=${structured}`, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/layout-contract.html${structured ? '?structured' : ''}`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => (window as any).layout?.ready)
  })
  for (const directive of ['[[indent:2]]', '[[bottom]]', '[[bottom:3]]']) test(`actual copy preserves top-level semantic layout ${directive} (${structured})`, async ({ page }) => {
    const result = await page.evaluate(async directive => {
      const api = (window as any).layout
      await api.load('source', directive + '\n**source**')
      api.select('source', 0, true)
      const before = api.snapshot('source')
      api.select('target')
      const data = await api.transfer('source', 'target', false, true)
      const doc = api.snapshot('target').doc
      await api.load('target', api.source('target'))
      return { data, before, after: api.snapshot('source'), doc, reloaded: api.snapshot('target').doc }
    }, directive)
    expect(result.data.html).toContain('mdi-')
    expect(result.data.types.some((type: string) => type.includes('markdown-slice'))).toBe(structured)
    expect(result.after).toEqual(result.before)
    expect(result.doc).toEqual(result.reloaded)
    expect(result.doc).toEqual(result.before.doc)
  })
  for (const source of ['> target', '- target', '1. target', '> - target', '- outer\n  > target', '- outer\n  1. target']) {
    test(`actual copy into container ${source} (${structured})`, async ({ page }) => {
      const result = await page.evaluate(async source => {
        const api = (window as any).layout
        await api.load('target', source)
        api.select('source', 0, true)
        const before = api.snapshot('source')
        api.paragraph('target')
        const target = api.snapshot('target')
        await api.transfer('source', 'target', false, true)
        return { before, after: api.snapshot('source'), target, final: api.snapshot('target'), attempts: api.attempts('target') }
      }, source)
      expect(result.after).toEqual(result.before)
      if (result.attempts.some((count: number) => count > 0)) expect(result.final).toEqual(result.target)
      else expect(await page.locator('#target blockquote p[data-mdi-indent], #target li p[data-mdi-indent]').count()).toBe(0)
    })
  }
  for (const drag of [false, true]) for (const same of drag ? [false, true] : [false]) {
    test(`legacy closed container rejection drag=${drag} same=${same} (${structured})`, async ({ page }) => {
      const result = await page.evaluate(async ({ drag, same }) => {
        const api = (window as any).layout
        api.legacy('source')
        api.select('source', 0, true)
        if (!same) api.select('target', 2)
        const before = api.snapshot('source'), target = api.snapshot('target')
        const data = await api.transfer('source', same ? 'source' : 'target', drag, !same)
        return { data, before, target, after: api.snapshot('source'), final: api.snapshot('target'), attempts: api.attempts(same ? 'source' : 'target'), rejected: api.rejected(same ? 'source' : 'target') }
      }, { drag, same })
      expect(result.data.html).toContain('mdi-indent')
      expect(result.attempts.some((count: number) => count > 0)).toBe(true)
      expect(result.rejected).toContain(true)
      expect(result.after).toEqual(result.before)
      expect(result.final).toEqual(result.target)
    })
  }
  for (const same of [false, true]) test(`legal top-level drag same=${same} (${structured})`, async ({ page }) => {
    const result = await page.evaluate(async same => {
      const api = (window as any).layout
      await api.load('source', '[[indent:2]]\nsource\n\nend')
      api.select('source', 0, true)
      const before = api.snapshot('source')
      const data = await api.transfer('source', same ? 'source' : 'target', true, !same, same)
      const final = api.snapshot(same ? 'source' : 'target')
      const saved = api.source(same ? 'source' : 'target')
      await api.load('target', saved)
      return { data, before, after: api.snapshot('source'), final, reloaded: api.snapshot('target') }
    }, same)
    expect(result.data.html).toContain('mdi-indent')
    if (!same) expect(result.after).toEqual(result.before)
    else expect(result.after.doc).not.toEqual(result.before.doc)
    expect(result.final.doc.content.filter((node: any) => node.attrs?.mdiIndent === 2)).toHaveLength(1)
    expect(result.reloaded.doc).toEqual(result.final.doc)
  })
  test.afterEach(async ({ page }) => {
    await expect(page.locator('.ProseMirror-paste')).toHaveCount(0)
  })
})
