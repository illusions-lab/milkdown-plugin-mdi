import { editorStateCtx, editorViewCtx } from '@milkdown/core'
import { parse } from '@illusions-lab/mdi'
import { DOMParser } from '@milkdown/prose/model'
import { TextSelection } from '@milkdown/prose/state'
import { getHTML, getMarkdown } from '@milkdown/utils'
import { describe, expect, it } from 'vitest'
import { getMdi } from '../src/index'
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

describe('MDI parsing and serialization', () => {
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

  it('falls unknown block syntax back to editable Markdown text', async () => {
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

  it.each(['[[blank]]', '\\'])('maps %j to a canonical blank block', async (source) => {
    const editor = await createEditor(source)
    const json = editor.action((ctx) => ctx.get(editorStateCtx).doc.toJSON())
    expect(json).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', attrs: { mdiIndent: null, mdiBottom: null, mdiBlank: true } }],
    })
    expect(editor.action(getMdi())).toBe('\\\n')
    const html = editor.action(getHTML())
    expect(html).toContain(
      '<p class="mdi-blank" data-mdi-blank=""></p>',
    )
    editor.action((ctx) => {
      const state = ctx.get(editorStateCtx)
      const container = document.createElement('div')
      container.innerHTML = html
      expect(DOMParser.fromSchema(state.schema).parse(container).toJSON()).toEqual(json)
      const legacy = document.createElement('div')
      legacy.innerHTML = '<div class="mdi-blank" data-mdi-blank><br></div>'
      expect(DOMParser.fromSchema(state.schema).parse(legacy).firstChild?.toJSON()).toMatchObject({
        type: 'paragraph', attrs: { mdiBlank: true },
      })
    })
  })

  it('keeps text when a semantic blank is edited and clears only its internal flag', async () => {
    const editor = await createEditor('\\')
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)))
      view.dispatch(view.state.tr.insertText('本文'))
    })
    const paragraph = editor.action((ctx) => ctx.get(editorStateCtx).doc.firstChild)
    expect(paragraph?.type.name).toBe('paragraph')
    expect(paragraph?.attrs.mdiBlank).toBe(false)
    expect(paragraph?.textContent).toBe('本文')
    expect(editor.action(getMdi())).toContain('本文')
  })

  it.each([
    '[[indent:-1]]\nText',
    '[[bottom:abc]]\nText',
    '[[pagebreak:center]]',
  ])('leaves invalid block MDI as literal text: %s', async (source) => {
    const editor = await createEditor(source)
    const json = editor.action((ctx) => ctx.get(editorStateCtx).doc.toJSON())
    expect(JSON.stringify(json)).not.toContain('mdiPagebreak')
    expect(json.content[0]).toMatchObject({
      type: 'paragraph',
      attrs: { mdiIndent: null, mdiBottom: null },
    })
    expect(editor.action((ctx) => ctx.get(editorStateCtx).doc.textContent))
      .toContain(source.split('\n')[0])
  })

  it.each([
    ['[[pagebreak]]', null],
    ['[[pagebreak:right]]', 'right'],
    ['[[pagebreak:left]]', 'left'],
  ])('round-trips semantic pagebreak %s', async (source, variant) => {
    const editor = await createEditor(source)
    const json = editor.action((ctx) => ctx.get(editorStateCtx).doc.toJSON())
    expect(json).toEqual({
      type: 'doc',
      content: [{ type: 'mdiPagebreak', attrs: { variant } }],
    })
    expect(editor.action(getMdi()).trim()).toBe(source)

    const html = editor.action(getHTML())
    expect(html).toContain('class="mdi-pagebreak"')
    expect(html).toContain('data-mdi-pagebreak=""')
    if (variant) expect(html).toContain(`data-mdi-variant="${variant}"`)
    else expect(html).not.toContain('data-mdi-variant')

    editor.action((ctx) => {
      const state = ctx.get(editorStateCtx)
      const container = document.createElement('div')
      container.innerHTML = html
      expect(DOMParser.fromSchema(state.schema).parse(container).toJSON()).toEqual(json)
      expect(() => state.schema.nodeFromJSON({
        type: 'mdiPagebreak',
        attrs: { variant: 'center' },
      })).toThrow('Invalid MDI pagebreak variant')
    })
  })

  it.each([
    ['[[indent:2]]\n本文', { mdiIndent: 2, mdiBottom: null }],
    ['[[bottom]]\n本文', { mdiIndent: null, mdiBottom: 0 }],
    ['[[bottom:3]]\n本文', { mdiIndent: null, mdiBottom: 3 }],
  ])('round-trips paragraph layout attributes: %s', async (source, attrs) => {
    const editor = await createEditor(source)
    const before = editor.action((ctx) => ctx.get(editorStateCtx).doc.toJSON())
    expect(before.content[0]).toMatchObject({ type: 'paragraph', attrs })

    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.insertText('追記', 3))
      expect(view.state.doc.firstChild?.attrs).toMatchObject(attrs)
    })
    const serialized = editor.action(getMdi())
    expect(serialized).toContain(source.split('\n')[0])
    expect(serialized).toContain('本文追記')

    const html = editor.action(getHTML())
    const attribute = attrs.mdiIndent === null ? 'bottom' : 'indent'
    const value = attrs.mdiIndent ?? attrs.mdiBottom
    expect(html).toContain(`class="mdi-${attribute}"`)
    expect(html).toContain(`data-mdi-${attribute}="${value}"`)

    editor.action((ctx) => {
      const state = ctx.get(editorStateCtx)
      const container = document.createElement('div')
      container.innerHTML = html
      expect(DOMParser.fromSchema(state.schema).parse(container).firstChild?.attrs)
        .toMatchObject(attrs)
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
