import { expect, test } from '@playwright/test'

test('initializes WASM, creates Milkdown, and serializes inline and block MDI', async ({ page }) => {
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
  expect(smoke?.mappingMatches).toBe(1)
  expect(smoke?.clipboardParsed).toBe(true)
  expect(smoke?.serialized).toContain('title: MDI Editor Showroom')
  expect(smoke?.serialized).toContain('debug-fixture: editor-showroom')
  expect(smoke?.serialized).toContain('{東京|とうきょう}')
  expect(smoke?.serialized).toContain('{雪女|ゆき.おんな}')
  expect(smoke?.serialized).toContain('^12^')
  expect(smoke?.serialized).toContain('[[em:')
  expect(smoke?.serialized).toContain('[[no-break:')
  expect(smoke?.serialized).toContain('[[warichu:')
  expect(smoke?.serialized).toContain('[[kern:-0.1em:')
  expect(smoke?.serialized).toContain('[[br]]')
  expect(smoke?.serialized).toContain('[[indent:2]]')
  expect(smoke?.serialized).toContain('[[bottom]]')
  expect(smoke?.serialized).toContain('[[bottom:2]]')
  expect(smoke?.serialized).toContain('[[pagebreak]]')
  expect(smoke?.serialized).toContain('[[pagebreak:right]]')
  expect(smoke?.serialized).toContain('[[pagebreak:left]]')
  expect(smoke?.serialized).toContain('\\\n')
  await expect(page.getByRole('heading', { name: 'Front Matter' })).toBeVisible()
  await expect(page.locator('#frontmatter-values')).toContainText('MDI Editor Showroom')
  await expect(page.locator('#frontmatter-values')).toContainText('editor-showroom')
  await expect(page.locator('.editor')).not.toContainText('title: MDI Editor Showroom')

  for (const className of ['mdi-ruby', 'mdi-tcy', 'mdi-boten', 'mdi-no-break', 'mdi-warichu', 'mdi-kern', 'mdi-break']) {
    await expect(page.locator(`.${className}`).first()).toBeAttached()
  }
  for (const className of ['mdi-blank', 'mdi-pagebreak', 'mdi-indent', 'mdi-bottom']) {
    await expect(page.locator(`.${className}`).first()).toBeAttached()
  }
  await expect(page.locator('.mdi-pagebreak')).toHaveCount(3)
  await expect(page.locator('.mdi-pagebreak').nth(0)).not.toHaveAttribute('data-mdi-variant')
  await expect(page.locator('.mdi-pagebreak').nth(1)).toHaveAttribute('data-mdi-variant', 'right')
  await expect(page.locator('.mdi-pagebreak').nth(2)).toHaveAttribute('data-mdi-variant', 'left')
  await expect(page.locator('.mdi-blank')).toHaveCount(2)
  await expect(page.locator('.mdi-indent')).toHaveAttribute('data-mdi-indent', '2')
  await expect(page.locator('.mdi-bottom')).toHaveCount(2)
  await expect(page.locator('.mdi-bottom').nth(0)).toHaveAttribute('data-mdi-bottom', '0')
  await expect(page.locator('.mdi-bottom').nth(1)).toHaveAttribute('data-mdi-bottom', '2')

  const blockStyles = await page.evaluate(() => ({
    blankMinBlockSize: getComputedStyle(document.querySelector('.mdi-blank')!).minBlockSize,
    plainBreak: getComputedStyle(document.querySelector('.mdi-pagebreak')!).breakAfter,
    rightBreak: getComputedStyle(document.querySelector('.mdi-pagebreak[data-mdi-variant="right"]')!).breakAfter,
    leftBreak: getComputedStyle(document.querySelector('.mdi-pagebreak[data-mdi-variant="left"]')!).breakAfter,
    indentMargin: getComputedStyle(document.querySelector('.mdi-indent')!).marginBlockStart,
    bottomPosition: getComputedStyle(document.querySelector('.mdi-bottom')!).position,
  }))
  expect(blockStyles.blankMinBlockSize).not.toBe('0px')
  expect(blockStyles.plainBreak).toBe('page')
  expect(blockStyles.rightBreak).toBe('right')
  expect(blockStyles.leftBreak).toBe('left')
  expect(blockStyles.indentMargin).not.toBe('0px')
  expect(blockStyles.bottomPosition).toBe('relative')

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
  const rubyCount = await page.locator('.mdi-ruby').count()
  await lastParagraph.click()
  await page.keyboard.press('End')
  await page.keyboard.type(' {字|じ} browser-edit-ok')
  await expect(page.locator('.mdi-ruby')).toHaveCount(rubyCount + 1)
  await page.getByRole('button', { name: 'Serialize MDI' }).click()
  await expect(page.getByLabel('Canonical MDI output')).toContainText('{字|じ}')
  await expect(page.getByLabel('Canonical MDI output')).toContainText('browser-edit-ok')

  const editable = page.locator('#editor [contenteditable="true"]')
  await editable.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
  const copied = await page.evaluate(() => {
    const target = document.querySelector<HTMLElement>('#editor [contenteditable="true"]')!
    const values = new Map<string, string>()
    const event = new Event('copy', { bubbles: true, cancelable: true }) as ClipboardEvent
    Object.defineProperty(event, 'clipboardData', { value: {
      setData: (type: string, value: string) => values.set(type, value),
    } })
    target.dispatchEvent(event)
    return {
      prevented: event.defaultPrevented,
      mdi: values.get('application/x-illusion-markdown;version=2.0') ?? '',
      plain: values.get('text/plain') ?? '',
    }
  })
  expect(copied.prevented).toBe(true)
  expect(copied.plain).toContain('{字|じ}')
  if (copied.mdi) expect(copied.mdi).toBe(copied.plain)
  const pasted = await page.evaluate(({ mdi, plain }) => {
    const target = document.querySelector<HTMLElement>('#editor [contenteditable="true"]')!
    const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
    Object.defineProperty(event, 'clipboardData', { value: {
      getData: (type: string) => type === 'application/x-illusion-markdown;version=2.0'
        ? mdi
        : type === 'text/plain' ? plain : '',
    } })
    target.dispatchEvent(event)
    return event.defaultPrevented
  }, copied)
  expect(pasted).toBe(true)
  await page.getByRole('button', { name: 'Serialize MDI' }).click()
  await expect(page.getByLabel('Canonical MDI output')).toContainText('{字|じ}')
  await expect(page.getByLabel('Canonical MDI output')).toContainText('browser-edit-ok')
  expect(errors).toEqual([])
})
