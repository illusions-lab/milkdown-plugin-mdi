import { commandsCtx, editorStateCtx, editorViewCtx } from '@milkdown/core'
import { parse } from '@illusions-lab/mdi'
import { DOMParser } from '@milkdown/prose/model'
import { TextSelection } from '@milkdown/prose/state'
import { getHTML, getMarkdown } from '@milkdown/utils'
import { describe, expect, it } from 'vitest'
import {
  getMdi,
  insertMdiRubyCommand,
  toggleMdiTcyCommand,
} from '../src/index'
import { createEditor } from './harness'

const withoutSpans = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(withoutSpans)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== 'span')
        .map(([key, child]) => [key, withoutSpans(child)]),
    )
  }
  return value
}

describe('inline MDI parsing and serialization', () => {
  const cases = [
    ['group ruby', '{東京|とうきょう}', 'mdiRuby'],
    ['split ruby', '{雪女|ゆき.おんな}', 'mdiRuby'],
    ['Unicode ruby', '{珈琲|コーヒー}', 'mdiRuby'],
    ['tate-chu-yoko', '^12^', 'mdiTcy'],
    ['boten', '[[em:●:重要]]', 'mdiBoten'],
    ['no-break', '[[no-break:東京都新宿区]]', 'mdiNoBreak'],
    ['warichu', '[[warichu:注記]]', 'mdiWarichu'],
    ['kern', '[[kern:-0.1em:字間]]', 'mdiKern'],
    ['explicit break', '前[[br]]後', 'mdiBreak'],
  ] as const

  it.each(cases)('round-trips %s', async (_label, source, schemaName) => {
    const editor = await createEditor(source)
    const json = editor.action((ctx) => ctx.get(editorStateCtx).doc.toJSON())
    expect(JSON.stringify(json)).toContain(schemaName)
    expect(editor.action(getMarkdown())).toContain(source)
    expect(editor.action(getMdi())).toContain(source)
  })

  it('preserves group and split ruby attributes in ProseMirror JSON', async () => {
    const editor = await createEditor('{東京|とうきょう}と{雪女|ゆき.おんな}')
    const json = editor.action((ctx) => ctx.get(editorStateCtx).doc.toJSON())
    const paragraph = json.content[0]
    expect(paragraph.content[0]).toMatchObject({
      type: 'mdiRuby',
      attrs: { base: '東京', ruby: 'とうきょう' },
    })
    expect(paragraph.content[2]).toMatchObject({
      type: 'mdiRuby',
      attrs: { base: '雪女', ruby: ['ゆき', 'おんな'] },
    })
  })

  it('preserves editable marks and nested inline structures', async () => {
    const source = '[[em:{東京|とうきょう}]] [[no-break:第^12^話]]'
    const editor = await createEditor(source)
    const json = editor.action((ctx) => ctx.get(editorStateCtx).doc.toJSON())
    const content = json.content[0].content

    expect(content[0]).toMatchObject({
      type: 'mdiRuby',
      marks: [{ type: 'mdiBoten', attrs: { mark: '﹅' } }],
    })
    expect(content[2]).toMatchObject({ marks: [{ type: 'mdiNoBreak' }] })
    expect(content[3]).toMatchObject({
      marks: expect.arrayContaining([{ type: 'mdiTcy' }, { type: 'mdiNoBreak' }]),
    })
    expect(content[4]).toMatchObject({ marks: [{ type: 'mdiNoBreak' }] })
    expect(editor.action(getMdi())).toContain(source)
  })

  it('keeps editable mark boundaries when text changes', async () => {
    const editor = await createEditor('第^12^話 [[kern:+0.3em:字間]]外')
    const before = editor.action((ctx) => ctx.get(editorStateCtx).doc.toJSON()).content[0].content
    expect(before[0]).toMatchObject({ type: 'text', text: '第' })
    expect(before[1]).toMatchObject({ type: 'text', text: '12', marks: [{ type: 'mdiTcy' }] })
    expect(before[2]).toMatchObject({ type: 'text', text: '話 ' })
    expect(before[3]).toMatchObject({
      type: 'text',
      text: '字間',
      marks: [{ type: 'mdiKern', attrs: { amount: '+0.3em' } }],
    })
    expect(before[4]).toMatchObject({ type: 'text', text: '外' })

    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.insertText('34', 2, 4))
    })
    expect(editor.action(getMdi())).toContain('第^34^話')
  })

  it('keeps invalid Rust syntax as literal editable text', async () => {
    const source = 'Invalid: [[kern:abc:text]] and ^too long^.'
    const editor = await createEditor(source)
    const json = editor.action((ctx) => ctx.get(editorStateCtx).doc.toJSON())
    expect(JSON.stringify(json)).not.toContain('mdiKern')
    expect(JSON.stringify(json)).not.toContain('mdiTcy')
    expect(editor.action((ctx) => ctx.get(editorStateCtx).doc.textContent)).toBe(source)
  })

  it('supports GFM deletion emitted by the upstream MDI parser', async () => {
    const source = 'これは~~取り消し線~~です。'
    const editor = await createEditor(source)
    const json = editor.action((ctx) => ctx.get(editorStateCtx).doc.toJSON())
    expect(json.content[0].content[1]).toMatchObject({
      type: 'text',
      text: '取り消し線',
      marks: [{ type: 'mdiGfmDelete' }],
    })
    expect(editor.action(getMdi())).toContain(source)
    expect(editor.action(getHTML())).toContain('<del>取り消し線</del>')
  })

  it.each([
    '{東京|とうきょう',
    '^12',
    '[[em:未完',
    '[[no-break:未完',
    '[[warichu:未完',
    '[[kern:-0.1em:未完',
    '~~未完',
  ])('treats malformed syntax as literal text without aborting: %s', async (source) => {
    const editor = await createEditor(source)
    expect(editor.action((ctx) => ctx.get(editorStateCtx).doc.textContent)).toBe(source)
    expect(editor.action(getMdi())).toBeTruthy()
  })

  it('falls unsupported block syntax back to editable Markdown text', async () => {
    const source = [
      '---',
      'mdi: "2.0"',
      'title: Fallback',
      '---',
      '',
      '| A | B |',
      '| - | - |',
      '| 1 | 2 |',
      '',
      'Reference[^1].',
      'Reference-style [link][id].',
      '',
      '[^1]: Footnote.',
      '[id]: https://example.com',
      '',
      '[[pagebreak]]',
    ].join('\n')
    const editor = await createEditor(source)
    const text = editor.action((ctx) => ctx.get(editorStateCtx).doc.textContent)
    expect(text).not.toContain('title: Fallback')
    expect(text).toContain('| A | B |')
    expect(text).toContain('[^1]')
    expect(text).toContain('[link][id]')
    expect(JSON.stringify(editor.action((ctx) => ctx.get(editorStateCtx).doc.toJSON())))
      .toContain('mdiPagebreak')
    const serialized = editor.action(getMdi())
    expect(serialized).toContain('title: Fallback')
    expect(serialized).toContain('[^1]: Footnote.')
    expect(serialized).toContain('[id]:')
    expect(parse(serialized).document.frontmatter?.entries).toEqual(
      expect.arrayContaining([{ key: 'title', value: 'Fallback' }]),
    )
  })

  it.each([
    ['blank paragraph', '\\', 'mdiBlank'],
    ['pagebreak', '[[pagebreak]]', 'mdiPagebreak'],
    ['right pagebreak', '[[pagebreak:right]]', 'mdiPagebreak'],
    ['left pagebreak', '[[pagebreak:left]]', 'mdiPagebreak'],
  ])('round-trips semantic %s blocks', async (_label, source, schemaName) => {
    const editor = await createEditor(source)
    const json = editor.action((ctx) => ctx.get(editorStateCtx).doc.toJSON())
    expect(JSON.stringify(json)).toContain(schemaName)
    editor.action((ctx) => ctx.get(editorStateCtx).doc.check())
    expect(editor.action(getMdi()).trim()).toBe(source)
  })

  it.each([
    ['[[indent:2]]\n本文', { mdiIndent: 2, mdiBottom: null }],
    ['[[bottom]]\n本文', { mdiIndent: null, mdiBottom: 0 }],
    ['[[bottom:3]]\n本文', { mdiIndent: null, mdiBottom: 3 }],
  ])('round-trips paragraph layout attributes: %s', async (source, attrs) => {
    const editor = await createEditor(source)
    const json = editor.action((ctx) => ctx.get(editorStateCtx).doc.toJSON())
    expect(json.content[0]).toMatchObject({ type: 'paragraph', attrs })
    expect(editor.action(getMdi()).trim()).toBe(source)
  })

  it('exposes structured Ruby and TCY editor commands', async () => {
    const editor = await createEditor('12')
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.setSelection(
        // Positions 1..3 cover the paragraph text.
        TextSelection.create(view.state.doc, 1, 3),
      ))
      expect(ctx.get(commandsCtx).call(toggleMdiTcyCommand.key)).toBe(true)
      view.dispatch(view.state.tr.setSelection(
        TextSelection.create(view.state.doc, 3),
      ))
      expect(ctx.get(commandsCtx).call(insertMdiRubyCommand.key, {
        base: '東京',
        ruby: 'とうきょう',
      })).toBe(true)
    })
    expect(editor.action(getMdi())).toContain('^12^{東京|とうきょう}')
  })

  it('copies semantic MDI as clean plain text', async () => {
    const editor = await createEditor([
      '# {花|はな}と^12^[[br]]改行',
      '',
      '\\',
      '',
      '- 項目',
      '',
      '```mdi',
      '{literal|value}',
      '```',
      '',
      '![alt](https://example.com/image.png)',
      '',
      '次',
    ].join('\n'))
    const value = editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const serializer = view.someProp('clipboardTextSerializer')
      if (!serializer) throw new Error('MDI clipboard serializer is not registered')
      return serializer(view.state.doc.slice(0, view.state.doc.content.size), view)
    })
    expect(value).toBe('花（はな）と12\n改行\n\n\n\n項目\n\n{literal|value}\n\n次')
  })

  it('renders semantic block DOM hooks', async () => {
    const editor = await createEditor('[[indent:2]]\n本文\n\n[[pagebreak:right]]\n\n\\')
    const html = editor.action(getHTML())
    expect(html).toContain('class="mdi-indent"')
    expect(html).toContain('data-mdi-indent="2"')
    expect(html).toContain('class="mdi-pagebreak"')
    expect(html).toContain('data-mdi-variant="right"')
    expect(html).toContain('class="mdi-blank"')

    editor.action((ctx) => {
      const state = ctx.get(editorStateCtx)
      const container = document.createElement('div')
      container.innerHTML = '<hr data-mdi-pagebreak data-mdi-variant="left">'
      const parsed = DOMParser.fromSchema(state.schema).parse(container)
      let parsedVariant: unknown
      parsed.descendants((node) => {
        if (node.type.name === 'mdiPagebreak') parsedVariant = node.attrs.variant
      })
      expect(parsedVariant).toBe('left')

      expect(() => state.schema.nodeFromJSON({
          type: 'mdiPagebreak',
          attrs: { variant: 'center' },
        }))
        .toThrow('Invalid MDI pagebreak variant')
    })
  })

  it('keeps front matter out of the visible document and preserves unknown keys', async () => {
    const source = [
      '---',
      'mdi: "2.0"',
      'title: Metadata',
      'writing-mode: vertical',
      'custom-key: preserved',
      '---',
      '',
      '# Visible body',
    ].join('\n')
    const editor = await createEditor(source)
    const text = editor.action((ctx) => ctx.get(editorStateCtx).doc.textContent)
    expect(text).toBe('Visible body')
    expect(editor.action(getMarkdown())).not.toContain('title: Metadata')

    const serialized = editor.action(getMdi())
    const frontmatter = parse(serialized).document.frontmatter
    expect(frontmatter?.entries).toEqual(expect.arrayContaining([
      { key: 'title', value: 'Metadata' },
      { key: 'writing-mode', value: 'vertical' },
      { key: 'custom-key', value: 'preserved' },
    ]))
  })

  it('isolates front matter between editor instances', async () => {
    const withMetadata = await createEditor('---\ntitle: First\n---\n\nFirst body')
    const withoutMetadata = await createEditor('Second body')
    expect(withMetadata.action(getMdi())).toContain('title: First')
    expect(withoutMetadata.action(getMdi())).not.toContain('title: First')
    expect(withoutMetadata.action(getMdi())).toBe('Second body\n')
  })

  it('canonicalizes with Rust and reparses to the same semantic tree', async () => {
    const source = '《《強調》》と{雪女|ゆき.おんな}、[[no-break:第^12^話]]。'
    const editor = await createEditor(source)
    const canonical = editor.action(getMdi())
    expect(canonical).toContain('[[em:強調]]')

    const second = await createEditor(canonical)
    const secondCanonical = second.action(getMdi())
    expect(withoutSpans(parse(canonical).document)).toEqual(
      withoutSpans(parse(secondCanonical).document),
    )
  })

  it('emits semantic DOM and stable CSS hooks', async () => {
    const editor = await createEditor(
      '{東京|とうきょう} {雪女|ゆき.おんな} ^12^ [[em:強調]] [[no-break:禁則]] [[warichu:注]] [[kern:+0.2em:字]][[br]]',
    )
    const html = editor.action(getHTML())
    expect(html).toContain('<ruby class="mdi-ruby mdi-ruby--group"')
    expect(html).toContain('<rt>とうきょう</rt>')
    expect(html).toContain('<ruby class="mdi-ruby mdi-ruby--split"')
    expect(html).toContain('雪<rp>（</rp><rt>ゆき</rt><rp>）</rp>女<rp>（</rp><rt>おんな</rt>')
    for (const className of ['mdi-tcy', 'mdi-boten', 'mdi-no-break', 'mdi-warichu', 'mdi-kern', 'mdi-break']) {
      expect(html).toContain(className)
    }
  })
})
