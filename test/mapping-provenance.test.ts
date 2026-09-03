import { editorStateCtx, editorViewCtx, parserCtx, schemaCtx } from '@milkdown/core'
import { history, redo, undo, undoDepth } from '@milkdown/prose/history'
import { TextSelection } from '@milkdown/prose/state'
import { $prose } from '@milkdown/utils'
import * as mdiRuntime from '@illusions-lab/mdi'
import { describe, expect, it, vi } from 'vitest'
import {
  createMdiEditorMapping,
  getMdi,
  isCurrentMdiEditorMapping,
  mapMdiSourceSpanToCurrentEditorRanges,
  mapMdiSourceSpanToEditorRanges,
  mapMdiSourceSpansToEditorRanges,
} from '../src/index'
import { buildMdiProvenanceRangeIndex } from '../src/mapping'
import type { MdiProvenanceRange } from '../src/provenance'
import { createEditor } from './harness'

vi.mock('@illusions-lab/mdi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@illusions-lab/mdi')>()
  return {
    ...actual,
    resolveMdiSourceSpans: vi.fn(actual.resolveMdiSourceSpans),
  }
})

const byteSpan = (source: string, value: string, occurrence = 0) => {
  let offset = -1
  for (let index = 0; index <= occurrence; index += 1) offset = source.indexOf(value, offset + 1)
  if (offset < 0) throw new Error(`missing fixture value: ${value}`)
  const startByte = new TextEncoder().encode(source.slice(0, offset)).length
  return {
    startByte,
    endByte: startByte + new TextEncoder().encode(value).length,
  }
}

describe('Rust-provenance editor mapping', () => {
  it('indexes one thousand provenance ranges in one linear pass by block and channel', () => {
    let blockIndexReads = 0
    const ranges = Array.from({ length: 1_000 }, (_, blockIndex) => {
      const target = {
        get blockIndex() {
          blockIndexReads += 1
          return blockIndex
        },
        channel: 'blockText' as const,
        range: {
          start: `${blockIndex + 1}:0` as const,
          end: `${blockIndex + 1}:1` as const,
        },
      }
      return {
        target,
        from: blockIndex * 2 + 1,
        to: blockIndex * 2 + 2,
        targetOffsetStart: 0,
        targetOffsetEnd: 1,
      } satisfies MdiProvenanceRange
    })

    const index = buildMdiProvenanceRangeIndex(ranges)

    expect(index.size).toBe(1_000)
    expect(blockIndexReads).toBe(1_000)
    expect(index.get('0:blockText')).toEqual([ranges[0]])
    expect(index.get('999:blockText')).toEqual([ranges[999]])
    // Bucket reads do not revisit every provenance target.
    expect(blockIndexReads).toBe(1_000)
  })

  it('batch maps headings, paragraphs, duplicate graphemes, image alt, and explicit breaks', async () => {
    const editor = await createEditor('# 同じ e\u0301 👨‍👩‍👧‍👦\n\n同じ 同じ ![代替](x) 前[[br]]後')
    const snapshot = editor.action(createMdiEditorMapping())
    const spans = [
      byteSpan(snapshot.source, '同じ', 0),
      byteSpan(snapshot.source, 'e\u0301'),
      byteSpan(snapshot.source, '👨‍👩‍👧‍👦'),
      byteSpan(snapshot.source, '同じ', 1),
      byteSpan(snapshot.source, '同じ', 2),
      byteSpan(snapshot.source, '代替'),
      byteSpan(snapshot.source, '[[br]]'),
    ]
    const results = mapMdiSourceSpansToEditorRanges(snapshot, spans)

    expect(results).toHaveLength(spans.length)
    expect(results.map(({ matches }) => matches.length)).toEqual([1, 1, 1, 1, 1, 1, 1])
    expect(results[0]!.matches[0]!.from).toBeLessThan(results[3]!.matches[0]!.from)
    expect(results[3]!.matches[0]!.from).toBeLessThan(results[4]!.matches[0]!.from)
    for (const result of [results[0]!, results[3]!, results[4]!]) {
      const match = result.matches[0]!
      expect(snapshot.doc.textBetween(match.from, match.to)).toBe('同じ')
    }
    expect(results[1]!.matches[0]!.to - results[1]!.matches[0]!.from).toBe(2)
    expect(results[2]!.matches[0]!.to - results[2]!.matches[0]!.from).toBe(11)
  })

  it('crosses the Rust batch resolver exactly once for many source spans', async () => {
    const editor = await createEditor('one two three')
    const snapshot = editor.action(createMdiEditorMapping())
    const resolver = vi.mocked(mdiRuntime.resolveMdiSourceSpans)
    resolver.mockClear()
    const spans = ['one', 'two', 'three'].map((value) => byteSpan(snapshot.source, value))

    expect(mapMdiSourceSpansToEditorRanges(snapshot, spans).map(({ matches }) => matches.length)).toEqual([1, 1, 1])
    expect(resolver).toHaveBeenCalledTimes(1)
    expect(resolver).toHaveBeenCalledWith(snapshot.source, spans)
  })

  it('maps one thousand short duplicate-text blocks through one indexed snapshot', async () => {
    const source = Array.from({ length: 1_000 }, (_, index) =>
      index % 25 === 0 ? `段落 **重複** [[no-break:注記]] ${index}` : `段落 **重複** ${index}`,
    ).join('\n\n')
    const editor = await createEditor(source)
    const snapshot = editor.action(createMdiEditorMapping())
    const blocks = mdiRuntime.getMdiTextBlocks(snapshot.source).blocks
    const resolver = vi.mocked(mdiRuntime.resolveMdiSourceSpans)
    resolver.mockClear()

    const results = mapMdiSourceSpansToEditorRanges(
      snapshot,
      blocks.map((block) => block.span!),
    )

    expect(blocks).toHaveLength(1_000)
    expect(results).toHaveLength(1_000)
    expect(results.every(({ matches }) => matches.length === 1)).toBe(true)
    expect(results.map(({ matches }) => matches[0]!.blockIndex)).toEqual(
      Array.from({ length: 1_000 }, (_, index) => index + 1),
    )
    expect(resolver).toHaveBeenCalledTimes(1)
  })

  it('maps whole block spans assembled from mixed inline provenance segments', async () => {
    const editor = await createEditor('first\n\nplain **strong** tail\n\nthird')
    const snapshot = editor.action(createMdiEditorMapping())
    const blocks = mdiRuntime.getMdiTextBlocks(snapshot.source).blocks
    const results = mapMdiSourceSpansToEditorRanges(
      snapshot,
      blocks.map((block) => block.span!),
    )

    expect(results.map(({ matches }) => matches.length)).toEqual([1, 1, 1])
    expect(
      results.map(({ matches }) => {
        const match = matches[0]!
        return snapshot.doc.textBetween(match.from, match.to)
      }),
    ).toEqual(['first', 'plain strong tail', 'third'])
  })

  it('maps both blockquote/list nesting directions without traversal-order association', async () => {
    const editor = await createEditor('> - quote list\n\n- outer\n  > list quote')
    const snapshot = editor.action(createMdiEditorMapping())
    const quoteList = mapMdiSourceSpanToEditorRanges(snapshot, byteSpan(snapshot.source, 'quote list'))
    const listQuote = mapMdiSourceSpanToEditorRanges(snapshot, byteSpan(snapshot.source, 'list quote'))

    expect(quoteList.matches).toHaveLength(1)
    expect(listQuote.matches).toHaveLength(1)
    expect(quoteList.matches[0]!.from).toBeLessThan(listQuote.matches[0]!.from)
  })

  it('maps canonical blocks while the live editor has a transient trailing paragraph', async () => {
    const editor = await createEditor('first\n\nsecond')
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const paragraph = ctx.get(schemaCtx).nodes.paragraph!.create()
      view.dispatch(view.state.tr.insert(view.state.doc.content.size, paragraph))
    })

    const snapshot = editor.action(createMdiEditorMapping())
    expect(snapshot.source).toBe('first\n\nsecond\n')
    expect(snapshot.doc.lastChild?.type.name).toBe('paragraph')
    expect(snapshot.doc.lastChild?.childCount).toBe(0)

    for (const value of ['first', 'second']) {
      const result = mapMdiSourceSpanToEditorRanges(snapshot, byteSpan(snapshot.source, value))
      expect(result.matches, value).toHaveLength(1)
      const match = result.matches[0]!
      expect(snapshot.doc.textBetween(match.from, match.to), value).toBe(value)
    }
  })

  it('rejects reordered and structurally divergent editor documents instead of reassociating candidates', async () => {
    const editor = await createEditor('# first\n\nsecond')
    const snapshot = editor.action(createMdiEditorMapping())
    const span = byteSpan(snapshot.source, 'first')
    editor.action((ctx) => {
      const parse = ctx.get(parserCtx)
      for (const doc of [parse('second\n\n# first'), parse('first\n\nsecond')]) {
        expect(
          mapMdiSourceSpanToEditorRanges(snapshot, span, {
            source: snapshot.source,
            doc,
          }),
        ).toEqual({ coverage: 'none', matches: [], reason: 'stale' })
      }
    })
  })

  it('maps code, tables, and source-backed HTML while leaving syntax-only regions unmapped', async () => {
    const source = '```ts\nconst x = 1\n```\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n<div>HTML</div>'
    const editor = await createEditor(source)
    const snapshot = editor.action(createMdiEditorMapping())

    for (const value of ['const x = 1', 'A', '2']) {
      const result = mapMdiSourceSpanToEditorRanges(snapshot, byteSpan(snapshot.source, value))
      expect(result.matches, value).toHaveLength(1)
      const match = result.matches[0]!
      expect(snapshot.doc.textBetween(match.from, match.to), value).toBe(value)
    }
    const html = mapMdiSourceSpanToEditorRanges(snapshot, byteSpan(snapshot.source, 'HTML'))
    expect(html.matches).toHaveLength(1)
    const htmlMatch = html.matches[0]!
    const htmlNode = snapshot.doc.nodeAt(htmlMatch.from)
    expect(htmlNode?.type.name).toBe('html')
    expect(htmlMatch.to - htmlMatch.from).toBe(htmlNode?.nodeSize)
    for (const value of ['```ts', '| --- | --- |']) {
      expect(mapMdiSourceSpanToEditorRanges(snapshot, byteSpan(snapshot.source, value))).toMatchObject({
        matches: [],
        reason: 'unmapped',
      })
    }
  })

  it('maps numeric/named Unicode footnote text and leaves footnote syntax unmapped', async () => {
    const editor = await createEditor(
      ['本文[^1]と注記[^注]。', '', '[^1]: Footnote 👩🏽‍💻.', '', '[^注]: 日本語の注。'].join('\n'),
    )
    const snapshot = editor.action(createMdiEditorMapping())
    expect(snapshot.source).toContain('[^1]: Footnote 👩🏽‍💻.')
    expect(snapshot.source).toContain('[^注]: 日本語の注。')

    for (const value of ['Footnote 👩🏽‍💻.', '日本語の注。']) {
      const result = mapMdiSourceSpanToEditorRanges(snapshot, byteSpan(snapshot.source, value))
      expect(result.matches, value).toHaveLength(1)
      const match = result.matches[0]!
      expect(snapshot.doc.textBetween(match.from, match.to)).toBe(value)
    }
    for (const value of ['[^1]', '[^1]:', '[^注]', '[^注]:']) {
      expect(mapMdiSourceSpanToEditorRanges(snapshot, byteSpan(snapshot.source, value)), value).toMatchObject({
        matches: [],
        reason: 'unmapped',
      })
    }
  })

  it('keeps initial compact GFM table syntax source-backed after canonicalization', async () => {
    const source = [
      '---',
      'mdi: "2.0"',
      '---',
      '',
      '# 見出し',
      '',
      '本文',
      '',
      '|列|値|',
      '|---|---|',
      '|a|b|',
      '',
      '## 後続',
      '',
      '末尾',
    ].join('\n')
    const editor = await createEditor(source)
    const snapshot = editor.action(createMdiEditorMapping())

    for (const value of ['見出し', '本文', '列', '後続', '末尾']) {
      expect(mapMdiSourceSpanToEditorRanges(snapshot, byteSpan(snapshot.source, value)).matches, value).toHaveLength(1)
    }
  })

  it('documents blank, pagebreak, indent, and bottom as structural/unmapped', async () => {
    const editor = await createEditor(
      [
        '[[blank]]',
        '',
        '[[pagebreak]]',
        '',
        '[[pagebreak:right]]',
        '',
        '[[pagebreak:left]]',
        '',
        '[[indent:2]]',
        'indent',
        '',
        '[[bottom:3]]',
        'bottom',
      ].join('\n'),
    )
    const snapshot = editor.action(createMdiEditorMapping())

    for (const value of [
      '\\',
      '[[pagebreak]]',
      '[[pagebreak:right]]',
      '[[pagebreak:left]]',
      '[[indent:2]]',
      '[[bottom:3]]',
    ]) {
      expect(mapMdiSourceSpanToEditorRanges(snapshot, byteSpan(snapshot.source, value)), value).toMatchObject({
        matches: [],
        reason: 'unmapped',
      })
    }
    expect(mapMdiSourceSpanToEditorRanges(snapshot, byteSpan(snapshot.source, 'indent', 1)).matches).toHaveLength(1)
    expect(mapMdiSourceSpanToEditorRanges(snapshot, byteSpan(snapshot.source, 'bottom', 1)).matches).toHaveLength(1)
  })

  it('rejects snapshots after edit, undo, redo, selection change, replacement, and reparse', async () => {
    const editor = await createEditor('stable', [$prose(() => history({ newGroupDelay: -1 }))])
    const snapshot = editor.action(createMdiEditorMapping())
    const span = byteSpan(snapshot.source, 'stable')
    expect(editor.action(isCurrentMdiEditorMapping(snapshot))).toBe(true)
    expect(editor.action(mapMdiSourceSpanToCurrentEditorRanges(snapshot, span)).matches).toHaveLength(1)

    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.insertText('!', 7))
      expect(undo(view.state, view.dispatch)).toBe(true)
    })
    expect(editor.action(isCurrentMdiEditorMapping(snapshot))).toBe(false)
    expect(editor.action(mapMdiSourceSpanToCurrentEditorRanges(snapshot, span)).reason).toBe('stale')

    const afterUndo = editor.action(createMdiEditorMapping())
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      expect(redo(view.state, view.dispatch)).toBe(true)
    })
    expect(editor.action(isCurrentMdiEditorMapping(afterUndo))).toBe(false)

    const afterRedo = editor.action(createMdiEditorMapping())
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)))
    })
    expect(editor.action(isCurrentMdiEditorMapping(afterRedo))).toBe(false)

    const beforeReplace = editor.action(createMdiEditorMapping())
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const parsed = ctx.get(parserCtx)(getMdi()(ctx))
      view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, parsed.content))
    })
    expect(editor.action(isCurrentMdiEditorMapping(beforeReplace))).toBe(false)
  })

  it('does not mutate the document, canonical source, selection, or history', async () => {
    const editor = await createEditor('immutable', [$prose(() => history({ newGroupDelay: -1 }))])
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const beforeDoc = view.state.doc
      const beforeSelection = view.state.selection
      const beforeSource = getMdi()(ctx)
      const beforeUndo = undoDepth(view.state)
      const snapshot = createMdiEditorMapping()(ctx)

      expect(mapMdiSourceSpanToEditorRanges(snapshot, byteSpan(snapshot.source, 'immutable')).matches).toHaveLength(1)
      expect(view.state.doc).toBe(beforeDoc)
      expect(view.state.selection.eq(beforeSelection)).toBe(true)
      expect(getMdi()(ctx)).toBe(beforeSource)
      expect(undoDepth(view.state)).toBe(beforeUndo)
    })
  })
})
