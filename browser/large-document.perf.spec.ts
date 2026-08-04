import { expect, test } from '@playwright/test'

const enabled = process.env.RUN_BROWSER_PERFORMANCE_TESTS === '1'
const maximumLoadMs = (size: '1M' | '10M') => Number(
  process.env[`MDI_BROWSER_${size}_LOAD_MAX_MS`] ?? (size === '1M' ? 60_000 : 300_000),
)

test.describe.configure({ mode: 'serial' })
test.describe('large-document browser performance', () => {
  test.skip(!enabled, 'Run with RUN_BROWSER_PERFORMANCE_TESTS=1')

  for (const [label, characters, size] of [
    ['one-million-character', 1_000_000, '1M'],
    ['ten-million-character', 10_000_000, '10M'],
  ] as const) {
    test(`loads, renders, and scrolls a ${label} MDI book`, async ({ page }, testInfo) => {
      test.setTimeout(360_000)
      await page.goto('/')
      await page.waitForFunction(() => window.__MDI_SMOKE__?.ready || window.__MDI_SMOKE__?.error)
      await expect.poll(async () => page.evaluate(() => window.__MDI_SMOKE__?.error)).toBeUndefined()

      const metrics = await page.evaluate((characterCount) => window.__MDI_PERF__!.loadBook(characterCount), characters)
      testInfo.annotations.push({
        type: 'performance',
        description: `${size}: load ${metrics.loadMs.toFixed(1)} ms; paint ${metrics.firstPaintMs.toFixed(1)} ms; scroll ${metrics.scrollToEndMs.toFixed(1)} ms`,
      })
      console.info(`[performance][${testInfo.project.name}] ${size}:`, metrics)

      expect(metrics.sourceCharacters).toBeGreaterThanOrEqual(characters)
      expect(metrics.paragraphCount).toBeGreaterThan(characters / 2_000)
      expect(metrics.loadMs).toBeLessThan(maximumLoadMs(size))
      expect(metrics.firstPaintMs).toBeLessThan(maximumLoadMs(size))
      expect(metrics.scrollToEndMs).toBeLessThan(10_000)
      expect(metrics.scrollExtent).toBeGreaterThan(10_000)
      expect(metrics.scrollOffset).toBeGreaterThan(0)
    })
  }
})
