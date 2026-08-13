import { editorStateCtx, editorViewCtx, schemaCtx } from '@milkdown/core'
import { parse, serializeMdi } from '@illusions-lab/mdi'
import { DOMParser, DOMSerializer, type Node as ProseMirrorNode, type Schema } from '@milkdown/prose/model'
import { describe, expect, it, vi } from 'vitest'
import { getMdi } from '../src/index'
import { createEditor } from './harness'

const parseDom = (schema: Schema, html: string) => {
  const root = document.createElement('div')
  root.innerHTML = html
  return DOMParser.fromSchema(schema).parse(root)
}

const serializeFragment = (schema: Schema, node: ProseMirrorNode) => {
  const root = document.createElement('div')
  root.append(DOMSerializer.fromSchema(schema).serializeFragment(node.content))
  return root
}

describe('canonical CommonMark boundaries', () => {
  it.each([
    '*em* and _em_ and **strong** and __strong__',
    '***nested***, _**mixed**_, and **_inside_**',
    '`*code*` and \\*literal\\* and [link](https://example.com)',
    '> quoted **strong**\n>\n> - nested *emphasis*',
  ])('matches upstream canonicalization exactly: %s', async (source) => {
    const editor = await createEditor(source)
    expect(editor.action(getMdi())).toBe(serializeMdi(source))
  })

  it.each([
    ['tate-chu-yoko', '^12^', '34', '^34^'],
    ['boten', '[[em:字]]', '語', '[[em:語]]'],
    ['no-break', '[[no-break:字]]', '語', '[[no-break:語]]'],
    ['warichu', '[[warichu:字]]', '語', '[[warichu:語]]'],
    ['kern', '[[kern:+0.3em:字]]', '語', '[[kern:+0.3em:語]]'],
    ['GFM deletion', '~~字~~', '語', '~~語~~'],
  ])('retains the %s mark across a text replacement', async (_label, source, replacement, expected) => {
    const editor = await createEditor(source)
    const view = editor.action((ctx) => ctx.get(editorViewCtx))
    view.dispatch(view.state.tr.insertText(replacement, 1, 1 + view.state.doc.textContent.length))

    expect(editor.action(getMdi())).toContain(expected)
  })
})

describe('DOM and schema trust boundaries', () => {
  it('imports every supported semantic DOM hook with its attributes', async () => {
    const editor = await createEditor('boundary')
    const schema = editor.action((ctx) => ctx.get(schemaCtx))
    const doc = parseDom(schema, [
      '<p>',
      '<ruby data-mdi-ruby="split" data-mdi-base="東京" data-mdi-reading="[&quot;とう&quot;,&quot;きょう&quot;]"></ruby>',
      '<span class="mdi-tcy">12</span>',
      '<span class="mdi-boten" data-mdi-mark="●">点</span>',
      '<span class="mdi-no-break">禁則</span>',
      '<span class="mdi-warichu">注</span>',
      '<span class="mdi-kern" data-mdi-kern="-0.1em">字</span>',
      '<del>削除</del>',
      '<br class="mdi-break">',
      '</p>',
    ].join(''))
    const json = doc.toJSON()
    const encoded = JSON.stringify(json)

    expect(encoded).toContain('"type":"mdiRuby","attrs":{"base":"東京","ruby":["とう","きょう"]}')
    for (const name of ['mdiTcy', 'mdiBoten', 'mdiNoBreak', 'mdiWarichu', 'mdiKern', 'mdiGfmDelete', 'mdiBreak']) {
      expect(encoded).toContain(`"type":"${name}"`)
    }
    expect(encoded).toContain('"amount":"-0.1em"')
    expect(encoded).toContain('"mark":"●"')
  })

  it.each([
    ['JSON null', 'null'],
    ['a mixed array', '[&quot;とう&quot;,1]'],
    ['an object', '{&quot;reading&quot;:&quot;とう&quot;}'],
  ])('rejects %s as a ruby reading DOM attribute', async (_label, reading) => {
    const editor = await createEditor('boundary')
    const schema = editor.action((ctx) => ctx.get(schemaCtx))
    const doc = parseDom(
      schema,
      `<p><ruby data-mdi-ruby data-mdi-base="字" data-mdi-reading="${reading}"></ruby></p>`,
    )

    expect(doc.toJSON().content[0].content[0]).toMatchObject({
      type: 'mdiRuby',
      attrs: { base: '字', ruby: '' },
    })
  })

  it('accepts only em-based kern values imported from DOM', async () => {
    const editor = await createEditor('boundary')
    const schema = editor.action((ctx) => ctx.get(schemaCtx))
    const valid = ['0em', '+0.3em', '-0.1em', '12.5em']
    const invalid = ['', '-.1em', '1px', 'calc(1em)', '1em;color:red']

    for (const amount of valid) {
      const json = parseDom(schema, `<p><span class="mdi-kern" data-mdi-kern="${amount}">v</span></p>`).toJSON()
      expect(json.content[0].content[0]).toMatchObject({
        type: 'text',
        marks: [{ type: 'mdiKern', attrs: { amount } }],
      })
    }
    for (const amount of invalid) {
      const json = parseDom(schema, `<p><span class="mdi-kern" data-mdi-kern="${amount}">i</span></p>`).toJSON()
      expect(json.content[0].content[0]).toEqual({ type: 'text', text: 'i' })
    }
  })

  it('rejects invalid programmatic ruby and kern attributes', async () => {
    const editor = await createEditor('boundary')
    const schema = editor.action((ctx) => ctx.get(schemaCtx))

    expect(() => schema.nodeFromJSON({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'mdiRuby', attrs: { base: '字', ruby: 42 } }] }],
    })).toThrow('MDI ruby must be a string or an array of strings')
    expect(() => schema.nodeFromJSON({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: '字', marks: [{ type: 'mdiKern', attrs: { amount: '1px' } }] }],
      }],
    })).toThrow('Invalid MDI kern amount')
    expect(() => schema.nodeFromJSON({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: '字', marks: [{ type: 'mdiBoten', attrs: { mark: 'ab' } }] }],
      }],
    })).toThrow('Invalid MDI emphasis mark')
  })

  it('rejects a DOM-provided boten marker that is not one valid grapheme', async () => {
    const editor = await createEditor('boundary')
    const schema = editor.action((ctx) => ctx.get(schemaCtx))
    const parsed = parseDom(
      schema,
      '<p><span class="mdi-boten" data-mdi-mark="\';color:red;--x:evil">安全</span></p>',
    )
    const rendered = serializeFragment(schema, parsed)
    const boten = rendered.querySelector<HTMLElement>('.mdi-boten')

    expect(boten).toBeNull()
  })
})

describe('ruby grapheme rendering', () => {
  it('aligns split ruby by grapheme cluster rather than UTF-16 code unit', async () => {
    const editor = await createEditor('boundary')
    const schema = editor.action((ctx) => ctx.get(schemaCtx))
    const ruby = schema.nodes.mdiRuby.create({
      base: '👨‍👩‍👧‍👦人',
      ruby: ['かぞく', 'ひと'],
    })
    const paragraph = schema.nodes.paragraph.create(undefined, ruby)
    const rendered = serializeFragment(schema, paragraph)

    expect(Array.from(rendered.querySelectorAll('rt'), (node) => node.textContent)).toEqual(['かぞく', 'ひと'])
    expect(rendered.querySelector('ruby')?.textContent).toContain('👨‍👩‍👧‍👦')
  })

  it('uses a deterministic code-point fallback when Intl.Segmenter is unavailable', async () => {
    const editor = await createEditor('boundary')
    const schema = editor.action((ctx) => ctx.get(schemaCtx))
    const originalIntl = globalThis.Intl
    vi.stubGlobal('Intl', { Segmenter: undefined })
    try {
      const ruby = schema.nodes.mdiRuby.create({ base: '𠮷人', ruby: ['よし', 'ひと'] })
      const paragraph = schema.nodes.paragraph.create(undefined, ruby)
      const rendered = serializeFragment(schema, paragraph)
      expect(Array.from(rendered.querySelectorAll('rt'), (node) => node.textContent)).toEqual(['よし', 'ひと'])
    } finally {
      vi.stubGlobal('Intl', originalIntl)
    }
  })
})

describe('persistence edge cases', () => {
  it.each([
    [
      'Unicode scalar',
      '---\ntitle: "日本語: 👩🏽‍💻"\n---\n\n本文',
      [{ key: 'title', value: '日本語: 👩🏽‍💻' }],
    ],
    [
      'typed scalar values',
      '---\nempty: ""\nzero: 0\nflag: false\n---\n\nbody',
      [{ key: 'empty', value: '' }, { key: 'zero', value: 0 }, { key: 'flag', value: false }],
    ],
    [
      'collection values',
      '---\ntags: [a, b]\nnested: { a: b }\n---\n\nbody',
      [{ key: 'tags', value: ['a', 'b'] }, { key: 'nested', value: { a: 'b' } }],
    ],
  ])('preserves %s in front matter without exposing it as editor text', async (_label, source, entries) => {
    const editor = await createEditor(source)
    const output = editor.action(getMdi())

    expect(parse(output).document.frontmatter?.entries).toEqual(entries)
    expect(editor.action((ctx) => ctx.get(editorStateCtx).doc.textContent)).not.toContain(entries[0].key)
    expect(editor.action(getMdi())).toBe(output)
  })

  it('keeps an unknown table extension parseable and deterministic', async () => {
    const editor = await createEditor('| A | B |\n| - | - |\n| 1 | 2 |')
    const first = editor.action(getMdi())
    expect(first).toContain('| A | B |')
    expect(editor.action(getMdi())).toBe(first)
    expect(() => parse(first)).not.toThrow()
  })

  it.each([
    ['indent', '[[indent:2]]\nIndented', '[[indent:2]]'],
    ['bottom alignment', '[[bottom]]\nBottom', '[[bottom]]'],
    ['page break', 'Before\n\n[[pagebreak]]\n\nAfter', '[[pagebreak]]'],
    ['blank paragraph', 'Before\n\n[[blank]]\n\nAfter', '\\'],
  ])('keeps semantic %s blocks parseable and deterministic', async (_label, source, expected) => {
    const editor = await createEditor(source)
    const first = editor.action(getMdi())
    const second = editor.action(getMdi())

    expect(first).toContain(expected)
    expect(second).toBe(first)
    expect(() => parse(first)).not.toThrow()
  })
})
