import { expect, test } from '@playwright/test'

test('initializes WASM, creates Milkdown, and serializes inline MDI', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))

  await page.goto('/')
  await page.waitForFunction(() => window.__MDI_SMOKE__?.ready || window.__MDI_SMOKE__?.error)

  const smoke = await page.evaluate(() => window.__MDI_SMOKE__)
  expect(smoke?.error).toBeUndefined()
  expect(smoke?.ready).toBe(true)
  expect(smoke?.serialized).toContain('title: Inline MDI Debug')
  expect(smoke?.serialized).toContain('debug-fixture: inline-edge-cases')
  expect(smoke?.serialized).toContain('{東京|とうきょう}')
  expect(smoke?.serialized).toContain('{雪女|ゆき.おんな}')
  expect(smoke?.serialized).toContain('^12^')
  expect(smoke?.serialized).toContain('[[em:')
  expect(smoke?.serialized).toContain('[[no-break:')
  expect(smoke?.serialized).toContain('[[warichu:')
  expect(smoke?.serialized).toContain('[[kern:-0.1em:')
  expect(smoke?.serialized).toContain('[[br]]')
  await expect(page.getByRole('heading', { name: 'Front Matter' })).toBeVisible()
  await expect(page.locator('#frontmatter-values')).toContainText('Inline MDI Debug')
  await expect(page.locator('#frontmatter-values')).toContainText('inline-edge-cases')
  await expect(page.locator('.editor')).not.toContainText('title: Inline MDI Debug')

  for (const className of ['mdi-ruby', 'mdi-tcy', 'mdi-boten', 'mdi-no-break', 'mdi-warichu', 'mdi-kern', 'mdi-break']) {
    await expect(page.locator(`.${className}`).first()).toBeAttached()
  }

  await page.getByRole('button', { name: 'Vertical' }).click()
  await expect(page.getByRole('button', { name: 'Vertical' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.milkdown-vertical-writing')).toHaveAttribute('data-writing-mode', 'vertical-rl')
  const verticalStyles = await page.evaluate(() => ({
    tcy: getComputedStyle(document.querySelector('.mdi-tcy')!).getPropertyValue('text-combine-upright'),
    noBreak: getComputedStyle(document.querySelector('.mdi-no-break')!).whiteSpace,
    kern: getComputedStyle(document.querySelector('.mdi-kern')!).letterSpacing,
  }))
  expect(verticalStyles.tcy).toBe('all')
  expect(verticalStyles.noBreak).toBe('nowrap')
  expect(verticalStyles.kern).not.toBe('normal')

  await page.getByRole('button', { name: 'Horizontal' }).click()
  await expect(page.getByRole('button', { name: 'Horizontal' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.milkdown-vertical-writing')).toHaveAttribute('data-writing-mode', 'horizontal-tb')

  await page.getByRole('button', { name: 'Serialize MDI' }).click()
  await expect(page.getByLabel('Canonical MDI output')).toBeVisible()
  await expect(page.getByLabel('Canonical MDI output')).toContainText('{東京|とうきょう}')

  const lastParagraph = page.locator('#editor [contenteditable="true"] p').last()
  await lastParagraph.click()
  await page.keyboard.press('End')
  await page.keyboard.type(' browser-edit-ok')
  await page.getByRole('button', { name: 'Serialize MDI' }).click()
  await expect(page.getByLabel('Canonical MDI output')).toContainText('browser-edit-ok')
  expect(errors).toEqual([])
})
