import { editorStateCtx, editorViewCtx, schemaCtx } from '@milkdown/core'
import { parse } from '@illusions-lab/mdi'
import { DOMParser } from '@milkdown/prose/model'
import { getHTML, getMarkdown } from '@milkdown/utils'
import { describe, expect, it } from 'vitest'
import { getMdi, initializeMdi, mdi } from '../src/index'
import { createEditor } from './harness'

const withoutSpans = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(withoutSpans)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== 'span').map(([key, child]) => [key, withoutSpans(child)]))
  return value
}

describe('CommonMark compatibility and editor lifecycle', () => {
  it.each([
    '*em* and _em_ and **strong** and __strong__',
    '***nested***, _**mixed**_, and \\*literal\\*',
    '`*code*`\n\n> [link](https://example.com) ![image](x.png)',
    '- one\n  - two\n\n---\n\n<div>HTML</div>',
  ])('keeps ordinary Markdown serializable: %s', async (source) => {
    const editor = await createEditor(source)
    const markdown = editor.action(getMarkdown())
    expect(markdown).toBeTruthy()
    expect(editor.action(getMdi())).toBeTruthy()
    expect(editor.action(getHTML())).toBeTruthy()
  })

  it('has independent plugin arrays and idempotent concurrent initialization', async () => {
    const [first, second] = await Promise.all([initializeMdi(), initializeMdi()])
    expect(first).toBeUndefined()
    expect(second).toBeUndefined()
    const one = mdi()
    const two = mdi()
    expect(one).not.toBe(two)
    one.pop()
    expect(two).toHaveLength(mdi().length)
    const editor = await createEditor('still works')
    expect(editor.action(getMdi())).toBe('still works\n')
  })

  it('keeps front matter isolated across replacement and multiple editors', async () => {
    const first = await createEditor('---\ntitle: One\n---\n\nfirst')
    const second = await createEditor('---\ntitle: Two\n---\n\nsecond')
    expect(first.action(getMdi())).toContain('title: One')
    expect(second.action(getMdi())).toContain('title: Two')
    const view = first.action((ctx) => ctx.get(editorViewCtx))
    view.dispatch(view.state.tr.insertText(' changed', view.state.doc.content.size))
    expect(first.action(getMdi())).toContain('changed')
    expect(first.action(getMdi())).not.toContain('title: Two')
  })

  it('keeps atomic ruby editable through delete and undo/redo', async () => {
    const editor = await createEditor('A{東京|とうきょう}B')
    const view = editor.action((ctx) => ctx.get(editorViewCtx))
    view.dispatch(view.state.tr.delete(2, 3))
    expect(editor.action((ctx) => ctx.get(editorStateCtx).doc.textContent)).toBe('AB')
    // A normal subsequent edit proves the document remains usable after atomic removal.
    view.dispatch(view.state.tr.insertText('C', 2))
    expect(editor.action(getMdi())).toContain('ACB')
  })
})

describe('malformed inputs and deterministic fuzzing', () => {
  const malformed = [
    '[[kern:999999999999999999999em:x]]', '[[kern:calc(1em):x]]',
    '[[em:\";color:red:word]]', '{a|b.c.d}', '{👨‍👩‍👧‍👦|x.y}',
    '[[no-break:[[warichu:^123^]]]', '***', '---\nmissing close',
    '\uFEFF---\ntitle: bom\n---', '   ---\ntitle: indented\n---',
  ]
  it.each(malformed)('never aborts on malformed input: %j', async (source) => {
    const editor = await createEditor(source)
    const output = editor.action(getMdi())
    expect(typeof output).toBe('string')
    expect(() => parse(output)).not.toThrow()
    const view = editor.action((ctx) => ctx.get(editorViewCtx))
    view.dispatch(view.state.tr.insertText('x', 1))
  })

  it('does not turn MDI attributes into executable DOM or CSS', async () => {
    const editor = await createEditor("[[em:';color:red;--x:evil:安全]] [[kern:calc(1em):字]]")
    const html = editor.action(getHTML())
    const boten = document.createElement('div')
    boten.innerHTML = html
    expect(boten.querySelector('.mdi-boten')?.getAttribute('style')).toBe("--mdi-boten-mark: '﹅';")
    expect(boten.querySelector('.mdi-kern')).toBeNull()
    expect(html).not.toContain('<script')
  })

  it('validates DOM attributes and schema attributes at the trust boundary', async () => {
    const editor = await createEditor('boundary')
    const schema = editor.action((ctx) => ctx.get(schemaCtx))
    const root = document.createElement('div')
    root.innerHTML = '<p><ruby data-mdi-ruby data-mdi-base="字" data-mdi-reading="not-json"></ruby><span class="mdi-kern" data-mdi-kern="calc(1em)">x</span></p>'
    const parsed = DOMParser.fromSchema(schema).parse(root).toJSON()
    expect(parsed.content[0].content?.[0]).toMatchObject({ type: 'mdiRuby', attrs: { base: '字', ruby: '' } })
    expect(parsed.content[0].content?.[1]).toMatchObject({ type: 'text', text: 'x' })
  })

  it('canonicalizes a bounded seeded corpus without losing parseability', async () => {
    let state = 0x5eed1234
    const next = () => (state = (state * 1664525 + 1013904223) >>> 0)
    const tokens = ['{東|とう}', '^12^', '[[em:字]]', '[[kern:-.1em:x]]', '*', '_', '\n', '👩🏽‍💻', '[[', '---']
    for (let caseNumber = 0; caseNumber < 32; caseNumber += 1) {
      const seed = state
      const source = Array.from({ length: 1 + (next() % 12) }, () => tokens[next() % tokens.length]).join('')
      const editor = await createEditor(source)
      const output = editor.action(getMdi())
      expect(typeof output, `seed=${seed} source=${JSON.stringify(source)}`).toBe('string')
      expect(() => parse(output), `seed=${seed} source=${JSON.stringify(source)}`).not.toThrow()
      expect(withoutSpans(parse(output).document), `seed=${seed}`).toEqual(withoutSpans(parse(editor.action(getMdi())).document))
    }
  })
})
