import { test as base, expect } from '@playwright/test'
import type {} from '../debug/testing'
export { expect }
export const test = base.extend<{ editingEvidence: void }>({
  editingEvidence: [async ({ page }, use, info) => {
    const exceptions: string[] = []
    page.on('pageerror', error => exceptions.push(String(error)))
    await use()
    if (info.status !== info.expectedStatus) {
      const state = await page.evaluate(() => {
        const api = window.__EDITING__
        if (!api) return null
        return { errors: api.errors, editors: api.ids().map(id => {
          try { return { id, ...api.snapshot(id) } } catch (error) { return { id, error: String(error) } }
        }) }
      }).catch(error => ({ error: String(error) }))
      await info.attach('editing-state', { body: JSON.stringify({ state, exceptions }, null, 2), contentType: 'application/json' })
    }
    expect(exceptions).toEqual([])
  }, { auto: true }],
})
