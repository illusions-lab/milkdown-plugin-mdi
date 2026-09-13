import { expect, test } from '@playwright/test'

test('editable two-line geometry and wrapping never write visual splits to canonical MDI', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await page.waitForFunction(() => window.__MDI_SMOKE__?.ready)
  const source = `前[[warichu:${'一二三四五六七八九十'.repeat(12)}]]後`
  await page.evaluate(source => (window as unknown as { __MDI_WARICHU__: { load(source: string): string } }).__MDI_WARICHU__.load(source), source)
  await expect(page.locator('.mdi-warichu-space').first()).toBeAttached()
  const geometry = await page.locator('.mdi-warichu').evaluate(element => {
    const lines = Array.from(element.querySelectorAll<HTMLElement>('[data-mdi-fragment-line]'))
    return lines.map(line => ({ row: line.dataset.mdiRow, y: line.getBoundingClientRect().y, size: getComputedStyle(line).fontSize }))
  })
  expect(await page.locator('.mdi-warichu-space').count()).toBeGreaterThan(1)
  expect(geometry.some(line => line.row === '0')).toBe(true)
  expect(geometry.some(line => line.row === '1')).toBe(true)
  expect(new Set(geometry.map(line => line.y)).size).toBeGreaterThan(1)
  expect(geometry.every(line => line.size === '10px')).toBe(true)
  const fits = await page.locator('.mdi-warichu').evaluate(element => Array.from(element.querySelectorAll<HTMLElement>('.mdi-warichu-space')).every(widget => {
    const box = widget.getBoundingClientRect()
    return Array.from(element.querySelectorAll<HTMLElement>(`[data-mdi-fragment-line="${widget.dataset.mdiFragment}"]`)).every(line => {
      const rect = line.getBoundingClientRect()
      return rect.left >= box.left - 1 && rect.right <= box.right + 1 && rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1
    })
  }))
  expect(fits).toBe(true)
  const after = await page.evaluate(() => (window as unknown as { __MDI_WARICHU__: { source(): string } }).__MDI_WARICHU__.source())
  expect(errors).toEqual([])
  expect(after.trim()).toBe(source)
  expect(await page.evaluate(() => (window as unknown as { __MDI_WARICHU__: { writes(): number } }).__MDI_WARICHU__.writes())).toBe(0)
})

test('typing and undo at both editable line positions retain the selected text', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await page.waitForFunction(() => window.__MDI_SMOKE__?.ready)
  await page.evaluate(() => {
    const api = (window as unknown as { __MDI_WARICHU__: { load(source: string): string; select(from: number): void } }).__MDI_WARICHU__
    api.load('前[[warichu:一二三四五六七八九十]]後')
    api.select(4)
  })
  await expect(page.locator('.mdi-warichu-editable-line').first()).toBeAttached()
  await page.keyboard.insertText('注')
  const source = () => page.evaluate(() => (window as unknown as { __MDI_WARICHU__: { source(): string } }).__MDI_WARICHU__.source())
  await expect.poll(source).toContain('[[warichu:一注二三四五六七八九十]]')
  await page.evaluate(() => (window as unknown as { __MDI_WARICHU__: { undo(): void } }).__MDI_WARICHU__.undo())
  await expect.poll(source).toContain('[[warichu:一二三四五六七八九十]]')
  const last = page.locator('[data-mdi-row="1"]').last()
  await last.click()
  const position = await page.evaluate(() => (window as unknown as { __MDI_WARICHU__: { position(): number } }).__MDI_WARICHU__.position())
  expect(position).toBeGreaterThan(3)
  expect(position).toBeLessThan(14)
})

test('nested and formatted indivisible content retains geometry and grapheme positions', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => window.__MDI_SMOKE__?.ready)
  const source = '前[[warichu:一[[no-break:二**三**四]][[warichu:内注]]**e**́五六七八九十]]後'
  await page.evaluate(source => {
    const api = (window as unknown as { __MDI_WARICHU__: { load(source: string): string } }).__MDI_WARICHU__
    api.load(source)
  }, source)
  await expect(page.locator('.mdi-warichu-space').first()).toBeAttached()
  const result = await page.locator('.mdi-warichu').first().evaluate(element => {
    const ranges = Array.from(element.querySelectorAll<HTMLElement>('.mdi-no-break')).map(node => ({ text: node.textContent, x: node.getBoundingClientRect().left, right: node.getBoundingClientRect().right }))
    return { text: element.textContent, ranges }
  })
  expect(result.text).toContain('二三四内注é')
  for (let index = 1; index < result.ranges.length; index += 1) expect(result.ranges[index]!.x).toBeGreaterThanOrEqual(result.ranges[index - 1]!.right - 1)
  expect(await page.evaluate(() => (window as unknown as { __MDI_WARICHU__: { writes(): number } }).__MDI_WARICHU__.writes())).toBe(0)
})

test('vertical layout and synthetic composition freeze preserve the document', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => window.__MDI_SMOKE__?.ready)
  await page.evaluate(() => (window as unknown as { __MDI_WARICHU__: { load(source: string): string } }).__MDI_WARICHU__.load('前[[warichu:一二三四五六七八九十]]後'))
  const editor = page.locator('.ProseMirror')
  await editor.evaluate(element => { (element as HTMLElement).style.writingMode = 'vertical-rl'; (element as HTMLElement).style.height = '180px' })
  await expect.poll(async () => page.locator('[data-mdi-row]').evaluateAll(lines => new Set(lines.map(line => line.getBoundingClientRect().x)).size)).toBeGreaterThan(1)
  await editor.dispatchEvent('compositionstart', { data: '' })
  const before = await page.locator('.mdi-warichu').evaluate(element => element.innerHTML)
  await editor.evaluate(element => { (element as HTMLElement).style.height = '220px' })
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  expect(await page.locator('.mdi-warichu').evaluate(element => element.innerHTML)).toBe(before)
  await editor.dispatchEvent('compositionend', { data: '' })
  expect(await page.evaluate(() => (window as unknown as { __MDI_WARICHU__: { writes(): number } }).__MDI_WARICHU__.writes())).toBe(0)
})

test('second-row glyph click inserts at the exact canonical offset and supports boundary arrows', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => window.__MDI_SMOKE__?.ready)
  await page.evaluate(() => (window as unknown as { __MDI_WARICHU__: { load(source: string): string } }).__MDI_WARICHU__.load('前[[warichu:一二三四五六七八九十]]後'))
  const second = page.locator('[data-mdi-row="1"]').first()
  await expect(second).toBeAttached()
  const point = await second.evaluate(element => {
    const text = element.firstChild!
    const range = document.createRange()
    range.setStart(text, 1); range.setEnd(text, 2)
    const rect = range.getBoundingClientRect()
    return { x: rect.right - 1, y: rect.top + rect.height / 2 }
  })
  await page.mouse.click(point.x, point.y)
  const position = () => page.evaluate(() => (window as unknown as { __MDI_WARICHU__: { position(): number } }).__MDI_WARICHU__.position())
  expect(await position()).toBe(10)
  await page.keyboard.insertText('注')
  const source = () => page.evaluate(() => (window as unknown as { __MDI_WARICHU__: { source(): string } }).__MDI_WARICHU__.source())
  await expect.poll(source).toContain('[[warichu:一二三四五六七注八九十]]')
  await page.keyboard.press('Backspace')
  await expect.poll(source).toContain('[[warichu:一二三四五六七八九十]]')
  await page.evaluate(() => (window as unknown as { __MDI_WARICHU__: { undo(): void } }).__MDI_WARICHU__.undo())
  await expect.poll(source).toContain('[[warichu:一二三四五六七注八九十]]')
  await page.evaluate(() => (window as unknown as { __MDI_WARICHU__: { select(from: number): void } }).__MDI_WARICHU__.select(2))
  await page.keyboard.press('ArrowRight')
  expect(await position()).toBe(3)
  await page.keyboard.press('ArrowLeft')
  expect(await position()).toBe(2)
})

test('deleting at each outer note boundary and undo retains the remaining content', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => window.__MDI_SMOKE__?.ready)
  const load = (position: number) => page.evaluate(position => {
    const api = (window as unknown as { __MDI_WARICHU__: { load(source: string): string; select(from: number, to?: number): void } }).__MDI_WARICHU__
    api.load('前[[warichu:一二三四五六七八九十]]後'); api.select(position)
  }, position)
  const source = () => page.evaluate(() => (window as unknown as { __MDI_WARICHU__: { source(): string } }).__MDI_WARICHU__.source())
  await load(2)
  await page.keyboard.press('Delete')
  await expect.poll(source).toContain('前[[warichu:二三四五六七八九十]]後')
  await page.evaluate(() => (window as unknown as { __MDI_WARICHU__: { undo(): void } }).__MDI_WARICHU__.undo())
  await expect.poll(source).toContain('前[[warichu:一二三四五六七八九十]]後')
  await load(14)
  await page.keyboard.press('Backspace')
  await expect.poll(source).toContain('前[[warichu:一二三四五六七八九]]後')
  await page.evaluate(() => (window as unknown as { __MDI_WARICHU__: { undo(): void } }).__MDI_WARICHU__.undo())
  await expect.poll(source).toContain('前[[warichu:一二三四五六七八九十]]後')
  await page.evaluate(() => (window as unknown as { __MDI_WARICHU__: { select(from: number, to: number): void } }).__MDI_WARICHU__.select(1, 15))
  await page.keyboard.press('Backspace')
  await expect.poll(async () => (await source()).trim()).toBe('')
  await page.evaluate(() => (window as unknown as { __MDI_WARICHU__: { undo(): void } }).__MDI_WARICHU__.undo())
  await expect.poll(source).toContain('前[[warichu:一二三四五六七八九十]]後')
})

test('reflows measured text with tracking inside positioned paragraphs after resize', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => window.__MDI_SMOKE__?.ready)
  await page.evaluate(() => {
    const api = (window as unknown as { __MDI_WARICHU__: { load(source: string): string } }).__MDI_WARICHU__
    api.load(`前[[warichu:${'長い割注の本文を自動的に二行へ配置する。'.repeat(12)}]]後`)
    const editor = document.querySelector<HTMLElement>('.ProseMirror')!
    editor.style.fontSize = '16px'; editor.style.letterSpacing = '.025em'; editor.style.width = '312px'
    editor.querySelectorAll<HTMLElement>('p').forEach(paragraph => { paragraph.style.position = 'relative'; paragraph.style.padding = '4px 8px' })
  })
  const fits = () => page.locator('.mdi-warichu').evaluate(element => {
    const widgets = Array.from(element.querySelectorAll<HTMLElement>('.mdi-warichu-space'))
    return widgets.length > 1 && widgets.every(widget => {
      const box = widget.getBoundingClientRect()
      const paragraph = widget.closest('p')!.getBoundingClientRect()
      return box.left >= paragraph.left - 1 && box.right <= paragraph.right + 1 && Array.from(element.querySelectorAll<HTMLElement>(`[data-mdi-fragment-line="${widget.dataset.mdiFragment}"]`)).every(line => {
        const rect = line.getBoundingClientRect()
        return getComputedStyle(line).fontSize === '8px' && rect.left >= box.left - 1 && rect.right <= box.right + 1 && rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1
      })
    })
  })
  await expect.poll(fits).toBe(true)
  const count = await page.locator('.mdi-warichu-space').count()
  await page.locator('.ProseMirror').evaluate(element => { (element as HTMLElement).style.width = '180px' })
  await expect.poll(fits).toBe(true)
  await expect.poll(() => page.locator('.mdi-warichu-space').count()).toBeGreaterThan(count)
  expect(await page.evaluate(() => (window as unknown as { __MDI_WARICHU__: { writes(): number } }).__MDI_WARICHU__.writes())).toBe(0)
})

test('nested notes keep two rows at half body size and reserve their full block extent', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => window.__MDI_SMOKE__?.ready)
  await page.evaluate(() => (window as unknown as { __MDI_WARICHU__: { load(source: string): string } }).__MDI_WARICHU__.load('前[[warichu:一[[warichu:内側注記]]二三四五六七八九]]後'))
  const nested = page.locator('.mdi-warichu .mdi-warichu')
  await expect(nested.locator('.mdi-warichu-space')).toBeAttached()
  const geometry = await nested.evaluate(element => Array.from(element.querySelectorAll<HTMLElement>('[data-mdi-row]')).map(line => ({ top: line.getBoundingClientRect().top, font: getComputedStyle(line).fontSize })))
  expect(new Set(geometry.map(line => line.top)).size).toBe(2)
  expect(geometry.every(line => line.font === '10px')).toBe(true)
  const outer = await page.locator('.mdi-warichu').first().evaluate(element => {
    const widget = element.querySelector<HTMLElement>(':scope > .mdi-warichu-space')!
    const box = widget.getBoundingClientRect()
    const lines = Array.from(element.querySelectorAll<HTMLElement>(`[data-mdi-fragment-line="${widget.dataset.mdiFragment}"]`))
    return { height: box.height, contained: lines.every(line => { const rect = line.getBoundingClientRect(); return rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1 }) }
  })
  expect(outer.height).toBeGreaterThanOrEqual(30)
  expect(outer.contained).toBe(true)
})

test('consecutive and trailing author breaks retain empty fragment reservations', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => window.__MDI_SMOKE__?.ready)
  const source = '前[[warichu:一[[br]][[br]]二[[br]]]]後'
  await page.evaluate(source => (window as unknown as { __MDI_WARICHU__: { load(source: string): string } }).__MDI_WARICHU__.load(source), source)
  await expect(page.locator('.mdi-warichu-space')).toHaveCount(3)
  const tops = await page.locator('.mdi-warichu-space').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().top))
  expect(tops[1]!).toBeGreaterThan(tops[0]!)
  expect(tops[2]!).toBeGreaterThan(tops[1]!)
  expect(await page.evaluate(() => (window as unknown as { __MDI_WARICHU__: { source(): string } }).__MDI_WARICHU__.source())).toContain(source)
})

test('synthetic composition keeps existing positions during text updates then resumes layout', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => window.__MDI_SMOKE__?.ready)
  await page.evaluate(() => {
    const api = (window as unknown as { __MDI_WARICHU__: { load(source: string): string; select(from: number): void } }).__MDI_WARICHU__
    api.load('前[[warichu:一二三四五六七八九十]]後'); api.select(4)
  })
  await expect(page.locator('.mdi-warichu-space')).toBeAttached()
  const styles = () => page.locator('.mdi-warichu-editable-line').evaluateAll(elements => elements.map(element => element.getAttribute('style')))
  const before = await styles()
  const editor = page.locator('.ProseMirror')
  await editor.dispatchEvent('compositionstart', { data: '' })
  await page.evaluate(() => (window as unknown as { __MDI_WARICHU__: { insert(text: string): void } }).__MDI_WARICHU__.insert('注記'))
  await editor.evaluate(element => { (element as HTMLElement).style.fontSize = '24px' })
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  expect(await styles()).toEqual(before)
  await editor.dispatchEvent('compositionend', { data: '注記' })
  await expect.poll(async () => page.locator('.mdi-warichu-editable-line').evaluateAll(elements => elements.every(element => (element as HTMLElement).style.fontSize === '12px'))).toBe(true)
  expect(await page.evaluate(() => (window as unknown as { __MDI_WARICHU__: { source(): string } }).__MDI_WARICHU__.source())).toContain('[[warichu:一注記二三四五六七八九十]]')
  await editor.evaluate(element => { (element as HTMLElement).style.writingMode = 'vertical-rl'; (element as HTMLElement).style.height = '180px' })
  await page.evaluate(() => (window as unknown as { __MDI_WARICHU__: { select(from: number): void } }).__MDI_WARICHU__.select(2))
  // ProseMirror Safari suppresses the first key within 500ms after compositionend.
  await page.waitForTimeout(550)
  await page.keyboard.press('ArrowDown')
  expect(await page.evaluate(() => (window as unknown as { __MDI_WARICHU__: { position(): number } }).__MDI_WARICHU__.position())).toBe(3)
  await page.keyboard.press('ArrowUp')
  expect(await page.evaluate(() => (window as unknown as { __MDI_WARICHU__: { position(): number } }).__MDI_WARICHU__.position())).toBe(2)
})

test('mouse drag selects from an annotation glyph through following body text', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => window.__MDI_SMOKE__?.ready)
  await page.evaluate(() => (window as unknown as { __MDI_WARICHU__: { load(source: string): string } }).__MDI_WARICHU__.load('前[[warichu:一二三四五六七八九十]]後'))
  const first = page.locator('[data-mdi-row="0"]').first()
  await expect(first).toBeAttached()
  const start = await first.evaluate(element => {
    const range = document.createRange(); range.setStart(element.firstChild!, 0); range.setEnd(element.firstChild!, 1)
    const rect = range.getBoundingClientRect(); return { x: rect.right - 1, y: rect.top + rect.height / 2 }
  })
  const end = await page.locator('.ProseMirror p').evaluate(element => {
    const node = element.lastChild!; const range = document.createRange(); range.selectNodeContents(node)
    const rect = range.getBoundingClientRect(); return { x: rect.right - 1, y: rect.top + rect.height / 2 }
  })
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y, { steps: 12 }); await page.mouse.up()
  expect(await page.evaluate(() => (window as unknown as { __MDI_WARICHU__: { range(): { from: number; to: number } } }).__MDI_WARICHU__.range())).toEqual({ from: 4, to: 15 })
})

test('ruby annotation glyphs stay inside the reserved row extent', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => window.__MDI_SMOKE__?.ready)
  await page.evaluate(() => (window as unknown as { __MDI_WARICHU__: { load(source: string): string } }).__MDI_WARICHU__.load('前[[warichu:{東京|とうきょう}一二三四五六七八九十]]後'))
  await expect(page.locator('.mdi-warichu-space')).toBeAttached()
  const contained = await page.locator('.mdi-warichu').evaluate(element => {
    const box = element.querySelector('.mdi-warichu-space')!.getBoundingClientRect()
    return Array.from(element.querySelectorAll('ruby,rt')).every(node => { const rect = node.getBoundingClientRect(); return rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1 })
  })
  expect(contained).toBe(true)
})


test('idle presentation stops transactions and preserves native selection outside warichu', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => window.__MDI_SMOKE__?.ready)
  await page.evaluate(() => {
    const api = (window as unknown as { __MDI_WARICHU__: { load(source: string): void; select(pos: number): void } }).__MDI_WARICHU__
    api.load('前\n\n\\\n\n文[[warichu:注釈]]\n\n終')
    api.select(1)
  })
  await expect(page.locator('.mdi-warichu-space')).toBeAttached()
  await page.waitForTimeout(300)
  const transactions = () => page.evaluate(() => (window as unknown as { __MDI_WARICHU__: { transactions(): number } }).__MDI_WARICHU__.transactions())
  const count = await transactions()
  await page.waitForTimeout(300)
  expect(await transactions()).toBe(count)
  const empty = page.locator('.ProseMirror > p').nth(1)
  await empty.click()
  await page.waitForTimeout(300)
  expect(await page.evaluate(() => (window as unknown as { __MDI_WARICHU__: { position(): number } }).__MDI_WARICHU__.position())).toBe(4)
  expect(await empty.evaluate(element => element.contains(window.getSelection()?.anchorNode ?? null))).toBe(true)
  await page.keyboard.insertText('末')
  await expect.poll(() => page.evaluate(() => (window as unknown as { __MDI_WARICHU__: { source(): string } }).__MDI_WARICHU__.source())).toContain('前\n\n末\n\n文[[warichu:注釈]]')
})

test('native caret after trailing Ruby preserves the atom when typing', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => window.__MDI_SMOKE__?.ready)
  await page.evaluate(() => {
    const api = (window as unknown as { __MDI_WARICHU__: { load(source: string): void; select(pos: number): void } }).__MDI_WARICHU__
    api.load('文{東|ひがし}')
    api.select(1)
  })
  await page.waitForTimeout(250)
  const point = await page.locator('.ProseMirror p').evaluate(element => {
    const ruby = element.querySelector('ruby')!.getBoundingClientRect()
    const paragraph = element.getBoundingClientRect()
    return { x: ruby.right + 2, y: paragraph.top + paragraph.height / 2 }
  })
  await page.mouse.click(point.x, point.y)
  await expect.poll(() => page.evaluate(() => (window as unknown as { __MDI_WARICHU__: { position(): number } }).__MDI_WARICHU__.position())).toBe(3)
  await page.keyboard.insertText('末')
  await expect.poll(() => page.evaluate(() => (window as unknown as { __MDI_WARICHU__: { source(): string } }).__MDI_WARICHU__.source())).toBe('文{東|ひがし}末\n')
})
