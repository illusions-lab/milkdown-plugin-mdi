import { editorStateCtx, editorViewCtx, parserCtx, serializerCtx } from '@milkdown/core'
import { Slice } from '@milkdown/prose/model'
import { NodeSelection, TextSelection } from '@milkdown/prose/state'
import { describe, expect, it } from 'vitest'
import {
  canApplyMdiEdit,
  createMdiEditorMapping,
  getMdi,
  inspectMdiSelection,
  isCurrentMdiEditorMapping,
  mapMdiSourceSpanToEditorRanges,
  mapMdiSourceSpanToCurrentEditorRanges,
  mdiEditCommand,
  mdiClipboard,
  mdiInputRules,
  mapMdiSourceSpanToEditorRange,
  MDI_CLIPBOARD_MIME,
  parseMdiClipboard,
  projectCurrentMdiEditorBlocks,
  projectMdiEditorBlocks,
  serializeMdiClipboard,
} from '../src/index'
import { createEditor } from './harness'

const byteSpan = (source: string, value: string, occurrence = 0) => {
  let utf16 = -1
  for (let index = 0; index <= occurrence; index += 1) utf16 = source.indexOf(value, utf16 + 1)
  if (utf16 < 0) throw new Error('missing fixture value')
  const startByte = new TextEncoder().encode(source.slice(0, utf16)).length
  return { startByte, endByte: startByte + new TextEncoder().encode(value).length }
}

describe('source/editor mapping primitives', () => {
  it('projects source blocks and editable blanks into display order', async () => {
    const editor = await createEditor('# heading\n\n> quote\n\n- item\n\n```txt\ncode\n```\n\n\\')
    const projection = editor.action(projectCurrentMdiEditorBlocks())
    expect(projection.complete).toBe(true)
    expect(projection.blocks.map(({ displayIndex }) => displayIndex)).toEqual(
      projection.blocks.map((_block, index) => index + 1),
    )
    expect(projection.blocks.some(({ kind }) => kind === 'heading')).toBe(true)
    expect(projection.blocks.some(({ kind }) => kind === 'blockquote')).toBe(true)
    expect(projection.blocks.some(({ kind }) => kind === 'listItem')).toBe(true)
    expect(projection.blocks.some(({ kind }) => kind === 'code')).toBe(true)
    expect(projection.blocks.some(({ semanticBlank }) => semanticBlank)).toBe(true)
    const snapshot = editor.action(createMdiEditorMapping())
    expect(projectMdiEditorBlocks(snapshot).source).toBe(snapshot.source)

    const leaf = await createEditor('[[pagebreak]]')
    expect(leaf.action(projectCurrentMdiEditorBlocks()).blocks).toHaveLength(0)
  })

  it('maps repeated Unicode source spans by block identity, not text search', async () => {
    const editor = await createEditor('同じ 👩🏽‍💻\n\n同じ 👩🏽‍💻')
    const snapshot = editor.action(createMdiEditorMapping())
    const first = mapMdiSourceSpanToEditorRanges(snapshot, byteSpan(snapshot.source, '同じ', 0))
    const second = mapMdiSourceSpanToEditorRanges(snapshot, byteSpan(snapshot.source, '同じ', 1))

    expect(first.matches).toHaveLength(1)
    expect(second.matches).toHaveLength(1)
    expect(first.matches[0]!.from).toBeLessThan(second.matches[0]!.from)
    expect(first.coverage).toBe('complete')
  })

  it('maps ruby readings to their atomic editor anchor and detects stale snapshots', async () => {
    const editor = await createEditor('{東京|とうきょう}')
    const snapshot = editor.action(createMdiEditorMapping())
    const reading = mapMdiSourceSpanToEditorRanges(snapshot, byteSpan(snapshot.source, 'とうきょう'))
    expect(reading.matches[0]).toMatchObject({ channel: 'annotation', from: 1, to: 2 })
    expect(editor.action(isCurrentMdiEditorMapping(snapshot))).toBe(true)

    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.insertText('後', 2))
    })
    expect(editor.action(isCurrentMdiEditorMapping(snapshot))).toBe(false)
    expect(editor.action(mapMdiSourceSpanToCurrentEditorRanges(
      snapshot,
      byteSpan(snapshot.source, '東京'),
    )).reason).toBe('stale')
  })

  it('maps source-backed table cells retained as literal Markdown', async () => {
    const editor = await createEditor('| A | B |\n| --- | --- |\n| 1 | 2 |')
    const snapshot = editor.action(createMdiEditorMapping())
    const header = mapMdiSourceSpanToEditorRanges(snapshot, byteSpan(snapshot.source, 'A'))
    const cell = mapMdiSourceSpanToEditorRanges(snapshot, byteSpan(snapshot.source, '1'))
    expect(header.matches).toHaveLength(1)
    expect(cell.matches).toHaveLength(1)
    expect(header.matches[0]!.from).toBeLessThan(cell.matches[0]!.from)
    expect(snapshot.doc.textBetween(header.matches[0]!.from, header.matches[0]!.to)).toBe('A')
    expect(snapshot.doc.textBetween(cell.matches[0]!.from, cell.matches[0]!.to)).toBe('1')

    const canonicalEditor = await createEditor('| X | Y |\n| --- | --- |\n| 3 | 4 |')
    const canonical = canonicalEditor.action(createMdiEditorMapping())
    expect(mapMdiSourceSpanToEditorRanges(canonical, byteSpan(canonical.source, 'X')).matches).toHaveLength(1)
  })

  it('maps nested containers and code from parse-bridge provenance', async () => {
    const editor = await createEditor('> quote\n> second\n\n- first\n  - nested\n\n```txt\ncode\n```\n\n![image alt](x.png)')
    const snapshot = editor.action(createMdiEditorMapping())
    for (const value of ['quote', 'second', 'first', 'nested', 'code', 'image alt']) {
      const result = mapMdiSourceSpanToEditorRanges(snapshot, byteSpan(snapshot.source, value))
      expect(result.matches, value).toHaveLength(1)
    }

    const nestedContainer = await createEditor('> - quoted list')
    const nestedSnapshot = nestedContainer.action(createMdiEditorMapping())
    expect(mapMdiSourceSpanToEditorRanges(
      nestedSnapshot,
      byteSpan(nestedSnapshot.source, 'quoted list'),
    ).matches).toHaveLength(1)
  })

  it('returns explicit unmapped and singular mapping results', async () => {
    const editor = await createEditor('text\n\n[[pagebreak]]')
    const snapshot = editor.action(createMdiEditorMapping())
    expect(mapMdiSourceSpanToEditorRange(snapshot, byteSpan(snapshot.source, 'text'))).not.toBeNull()
    const pagebreak = mapMdiSourceSpanToEditorRanges(snapshot, byteSpan(snapshot.source, '[[pagebreak]]'))
    expect(pagebreak).toMatchObject({ matches: [], reason: 'unmapped' })
    const multipleEditor = await createEditor('one\n\ntwo')
    const multiple = multipleEditor.action(createMdiEditorMapping())
    expect(mapMdiSourceSpanToEditorRange(multiple, {
      startByte: 0,
      endByte: new TextEncoder().encode(multiple.source).length,
    })).toBeNull()
    expect(mapMdiSourceSpanToEditorRanges(snapshot, byteSpan(snapshot.source, 'text'), {
      source: 'different',
      doc: snapshot.doc,
    }).reason).toBe('stale')
  })

  it('supports the deterministic grapheme fallback and literal HTML blocks', async () => {
    const segmenter = Object.getOwnPropertyDescriptor(Intl, 'Segmenter')
    Object.defineProperty(Intl, 'Segmenter', { configurable: true, value: undefined })
    try {
      const editor = await createEditor('fallback')
      const snapshot = editor.action(createMdiEditorMapping())
      expect(mapMdiSourceSpanToEditorRange(snapshot, byteSpan(snapshot.source, 'fallback'))).not.toBeNull()
    } finally {
      if (segmenter) Object.defineProperty(Intl, 'Segmenter', segmenter)
    }

    const html = await createEditor('<div>HTML</div>')
    const snapshot = html.action(createMdiEditorMapping())
    const result = mapMdiSourceSpanToEditorRanges(snapshot, byteSpan(snapshot.source, 'HTML'))
    expect(result.matches).toHaveLength(1)
    expect(result.matches[0]).toMatchObject({ channel: 'blockText', relation: 'exact' })
  })
})

describe('typed editing primitives', () => {
  it('applies, inspects, updates, and removes ruby without schema literals', async () => {
    const editor = await createEditor('東京')
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 3)))
      expect(canApplyMdiEdit(view.state, { type: 'setRuby', reading: 'とうきょう' })).toBe(true)
      mdiEditCommand({ type: 'setRuby', reading: 'とうきょう' })(view.state, view.dispatch)
      expect(inspectMdiSelection(view.state).ruby).toEqual({ base: '東京', reading: 'とうきょう' })
      mdiEditCommand({ type: 'setRuby', reading: ['とう', 'きょう'] })(view.state, view.dispatch)
      expect(inspectMdiSelection(view.state).ruby?.reading).toEqual(['とう', 'きょう'])
      mdiEditCommand({ type: 'removeRuby' })(view.state, view.dispatch)
    })
    expect(editor.action(getMdi()).includes('東京')).toBe(true)
  })

  it('validates marks and paragraph/block operations explicitly', async () => {
    const editor = await createEditor('12')
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 3)))
      expect(mdiEditCommand({ type: 'setInlineMark', mark: 'tcy' })(view.state, view.dispatch)).toBe(true)
      expect(getMdi()(ctx)).toContain('^12^')
      expect(canApplyMdiEdit(view.state, { type: 'setInlineMark', mark: 'boten', value: 'ab' })).toBe(false)
      expect(canApplyMdiEdit(view.state, { type: 'setParagraphLayout', layout: 'indent', value: -1 })).toBe(false)
      expect(mdiEditCommand({ type: 'setParagraphLayout', layout: 'indent', value: 2 })(view.state, view.dispatch)).toBe(true)
    })
    expect(editor.action(getMdi())).toContain('[[indent:2]]')
  })

  it('inserts typed pagebreak and blank nodes', async () => {
    const editor = await createEditor('text')
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      expect(mdiEditCommand({ type: 'insertPagebreak', variant: 'right' })(view.state, view.dispatch)).toBe(true)
      const found: string[] = []
      view.state.doc.descendants((node) => { found.push(node.type.name) })
      expect(found).toContain('mdiPagebreak')
    })
  })

  it('covers every inline mark, explicit break, blank, bottom, clear, and rejection path', async () => {
    for (const [mark, value] of [
      ['boten', '●'], ['noBreak', undefined], ['warichu', undefined], ['kern', '-0.1em'],
    ] as const) {
      const editor = await createEditor('対象')
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 3)))
        expect(mdiEditCommand({ type: 'setInlineMark', mark, value })(view.state, view.dispatch)).toBe(true)
        expect(inspectMdiSelection(view.state).marks[mark]).toBeTruthy()
        expect(mdiEditCommand({ type: 'removeInlineMark', mark })(view.state)).toBe(true)
        expect(mdiEditCommand({ type: 'removeInlineMark', mark })(view.state, view.dispatch)).toBe(true)
        expect(mdiEditCommand({ type: 'removeInlineMark', mark })(view.state)).toBe(false)
      })
    }

    const editor = await createEditor('text')
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      expect(canApplyMdiEdit(view.state, { type: 'setRuby', reading: '' })).toBe(false)
      expect(canApplyMdiEdit(view.state, { type: 'setRuby', reading: ['one'] })).toBe(false)
      expect(canApplyMdiEdit(view.state, { type: 'removeRuby' })).toBe(false)
      expect(canApplyMdiEdit(view.state, { type: 'setInlineMark', mark: 'tcy' })).toBe(false)
      expect(canApplyMdiEdit(view.state, { type: 'setInlineMark', mark: 'kern', value: '1px' })).toBe(false)
      expect(canApplyMdiEdit(view.state, { type: 'setInlineMark', mark: 'boten', value: ' ' })).toBe(false)
      expect(mdiEditCommand({ type: 'insertBreak' })(view.state, view.dispatch)).toBe(true)
      expect(mdiEditCommand({ type: 'insertBlank' })(view.state, view.dispatch)).toBe(true)
      expect(canApplyMdiEdit(view.state, { type: 'insertPagebreak' })).toBe(true)
    })

    const multi = await createEditor('one\n\ntwo')
    multi.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, view.state.doc.content.size - 1)))
      expect(canApplyMdiEdit(view.state, { type: 'setRuby', reading: 'reading' })).toBe(false)
    })

    const noSegmenter = await createEditor('二字')
    noSegmenter.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 3)))
      const segmenter = Object.getOwnPropertyDescriptor(Intl, 'Segmenter')
      Object.defineProperty(Intl, 'Segmenter', { configurable: true, value: undefined })
      try {
        expect(canApplyMdiEdit(view.state, { type: 'setRuby', reading: ['に', 'じ'] })).toBe(true)
        expect(canApplyMdiEdit(view.state, { type: 'setInlineMark', mark: 'boten', value: '●' })).toBe(true)
      } finally {
        if (segmenter) Object.defineProperty(Intl, 'Segmenter', segmenter)
      }
    })

    const stored = await createEditor('cursor')
    stored.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      expect(mdiEditCommand({ type: 'setInlineMark', mark: 'boten' })(view.state, view.dispatch)).toBe(true)
      expect(mdiEditCommand({ type: 'removeInlineMark', mark: 'boten' })(view.state, view.dispatch)).toBe(true)
      expect(mdiEditCommand({ type: 'setInlineMark', mark: 'kern' })(view.state, view.dispatch)).toBe(true)
      expect(mdiEditCommand({ type: 'removeInlineMark', mark: 'kern' })(view.state, view.dispatch)).toBe(true)
    })

    const layout = await createEditor('layout')
    layout.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      expect(mdiEditCommand({ type: 'setParagraphLayout', layout: 'bottom' })(view.state)).toBe(true)
      expect(mdiEditCommand({ type: 'setParagraphLayout', layout: 'bottom' })(view.state, view.dispatch)).toBe(true)
      expect(inspectMdiSelection(view.state).paragraphLayout).toEqual({ layout: 'bottom', value: 0 })
      expect(mdiEditCommand({ type: 'clearParagraphLayout' })(view.state)).toBe(true)
      expect(mdiEditCommand({ type: 'clearParagraphLayout' })(view.state, view.dispatch)).toBe(true)
      expect(mdiEditCommand({ type: 'clearParagraphLayout' })(view.state)).toBe(false)
      expect(mdiEditCommand({ type: 'setParagraphLayout', layout: 'indent', value: 1 })(view.state, view.dispatch)).toBe(true)
      expect(inspectMdiSelection(view.state).paragraphLayout).toEqual({ layout: 'indent', value: 1 })
    })

    const leaf = await createEditor('[[pagebreak]]')
    leaf.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 0)))
      expect(canApplyMdiEdit(view.state, { type: 'setParagraphLayout', layout: 'indent', value: 1 })).toBe(false)
    })
  })
})

describe('opt-in input and clipboard primitives', () => {
  it('round-trips semantic slices through canonical MDI', async () => {
    const editor = await createEditor('{東京|とうきょう}と^12^')
    editor.action((ctx) => {
      const state = ctx.get(editorStateCtx)
      const source = serializeMdiClipboard(state.doc.slice(0, state.doc.content.size))(ctx)
      expect(source).toContain('{東京|とうきょう}')
      const slice = parseMdiClipboard(source!)(ctx)
      expect(JSON.stringify(slice?.content.toJSON())).toContain('mdiRuby')
      expect(parseMdiClipboard('ordinary text')(ctx)).toBeNull()
      expect(parseMdiClipboard('ordinary text', { explicit: true })(ctx)).not.toBeNull()
    })
  })

  it('converts valid typed MDI only when input rules are enabled', async () => {
    const editor = await createEditor('', [mdiInputRules()])
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const handled = view.someProp('handleTextInput', (handler) => handler(view, 1, 1, '^12^', () => view.state.tr))
      expect(handled).toBe(true)
      expect(JSON.stringify(view.state.doc.toJSON())).toContain('mdiTcy')
    })
  })

  it.each(['[[pagebreak:right]]', '[[blank]]'])(
    'converts a valid typed block: %s',
    async (source) => {
      const editor = await createEditor('', [mdiInputRules()])
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        const handled = view.someProp('handleTextInput', (handler) => handler(view, 1, 1, source, () => view.state.tr))
        expect(handled).toBe(true)
        expect(JSON.stringify(view.state.doc.toJSON())).toMatch(/mdi(?:Pagebreak|Blank)|"mdiBlank":true/)
      })
    },
  )

  it.each(['{東京|とうきょう}', '《《傍点》》', '[[no-break:禁則]]'])(
    'converts another valid inline input family: %s',
    async (source) => {
      const editor = await createEditor('', [mdiInputRules()])
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        const handled = view.someProp('handleTextInput', (handler) => handler(view, 1, 1, source, () => view.state.tr))
        expect(handled).toBe(true)
        expect(JSON.stringify(view.state.doc.toJSON())).toContain('mdi')
      })
    },
  )

  it('handles opt-in clipboard copy, explicit paste, and ordinary fallback', async () => {
    const copied = new Map<string, string>()
    const clipboard = {
      setData: (type: string, value: string) => { copied.set(type, value) },
      getData: (type: string) => copied.get(type) ?? '',
    }
    const sourceEditor = await createEditor('{東京|とうきょう}', [mdiClipboard()])
    sourceEditor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 2)))
      const event = new Event('copy', { cancelable: true }) as ClipboardEvent
      Object.defineProperty(event, 'clipboardData', { value: clipboard })
      const handled = view.someProp('handleDOMEvents', (handlers) => handlers.copy?.(view, event))
      expect(handled).toBe(true)
      expect(copied.get(MDI_CLIPBOARD_MIME)).toContain('{東京|とうきょう}')
      expect(copied.get('text/plain')).toContain('{東京|とうきょう}')
      const text = view.someProp('clipboardTextSerializer', (serialize) => serialize(view.state.selection.content(), view))
      expect(text).toContain('{東京|とうきょう}')

      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)))
      const emptyCopy = new Event('copy') as ClipboardEvent
      Object.defineProperty(emptyCopy, 'clipboardData', { value: clipboard })
      expect(view.someProp('handleDOMEvents', (handlers) => handlers.copy?.(view, emptyCopy))).toBeUndefined()
      expect(view.someProp('handleDOMEvents', (handlers) => handlers.copy?.(view, new Event('copy') as ClipboardEvent))).toBeUndefined()
    })

    const target = await createEditor('', [mdiClipboard()])
    target.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const event = new Event('paste', { cancelable: true }) as ClipboardEvent
      Object.defineProperty(event, 'clipboardData', { value: clipboard })
      expect(view.someProp('handlePaste', (handler) => handler(view, event, view.state.selection.content()))).toBe(true)
      expect(JSON.stringify(view.state.doc.toJSON())).toContain('mdiRuby')

      const ordinary = new Map([['text/plain', 'ordinary']])
      const fallback = new Event('paste') as ClipboardEvent
      Object.defineProperty(fallback, 'clipboardData', {
        value: { getData: (type: string) => ordinary.get(type) ?? '' },
      })
      expect(view.someProp('handlePaste', (handler) => handler(view, fallback, view.state.selection.content()))).toBeUndefined()

      const emptyPaste = new Event('paste') as ClipboardEvent
      Object.defineProperty(emptyPaste, 'clipboardData', { value: { getData: () => '' } })
      expect(view.someProp('handlePaste', (handler) => handler(view, emptyPaste, view.state.selection.content()))).toBeUndefined()
      expect(view.someProp('handlePaste', (handler) => handler(view, new Event('paste') as ClipboardEvent, view.state.selection.content()))).toBeUndefined()
    })
  })

  it('uses direct document slices and safely returns null when parser/serializer rejects', async () => {
    const editor = await createEditor('{字|じ}')
    editor.action((ctx) => {
      const state = ctx.get(editorStateCtx)
      expect(serializeMdiClipboard(new Slice(state.doc.content, 0, 0))(ctx)).toContain('{字|じ}')

      const parser = ctx.get(parserCtx)
      ctx.set(parserCtx, () => { throw new Error('parser failure') })
      expect(parseMdiClipboard('{字|じ}')(ctx)).toBeNull()
      ctx.set(parserCtx, parser)

      const serializer = ctx.get(serializerCtx)
      ctx.set(serializerCtx, () => { throw new Error('serializer failure') })
      expect(serializeMdiClipboard(new Slice(state.doc.content, 0, 0))(ctx)).toBeNull()
      ctx.set(serializerCtx, serializer)
    })
  })

  it('keeps input-rule parser failures and non-MDI parse results lossless', async () => {
    const editor = await createEditor('', [mdiInputRules()])
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const parser = ctx.get(parserCtx)
      ctx.set(parserCtx, () => { throw new Error('input parser failure') })
      expect(view.someProp('handleTextInput', (handler) => handler(
        view, 1, 1, '[[pagebreak]]', () => view.state.tr,
      ))).toBeUndefined()
      expect(view.someProp('handleTextInput', (handler) => handler(
        view, 1, 1, '{字|じ}', () => view.state.tr,
      ))).toBeUndefined()

      ctx.set(parserCtx, () => parser('ordinary'))
      expect(view.someProp('handleTextInput', (handler) => handler(
        view, 1, 1, '[[blank]]', () => view.state.tr,
      ))).toBeUndefined()
      ctx.set(parserCtx, parser)
    })
  })
})
