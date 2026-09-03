import { editorStateCtx, editorViewCtx, inputRulesCtx, prosePluginsCtx } from '@milkdown/core'
import { history, redo, undo } from '@milkdown/prose/history'
import { AllSelection, NodeSelection, TextSelection } from '@milkdown/prose/state'
import { Fragment, Slice } from '@milkdown/prose/model'
import { $prose } from '@milkdown/utils'
import { describe, expect, it } from 'vitest'
import {
  canonicalizeMdiClipboardSlice,
  createMdiEditorMapping,
  getMdi,
  MDI_CLIPBOARD_MIME,
  mdiClipboard,
  mdiInputRules,
  mapMdiSourceSpanToEditorRanges,
  parseMdiClipboard,
  serializeMdiClipboard,
} from '../src/index'
import { createEditor } from './harness'

const withHistory = () => $prose(() => history({ newGroupDelay: -1 }))

const clipboardEvent = (type: 'copy' | 'paste', data: {
  getData?: (type: string) => string
  setData?: (type: string, value: string) => void
}) => {
  const event = new Event(type, { cancelable: true }) as ClipboardEvent
  Object.defineProperty(event, 'clipboardData', { value: data })
  return event
}

const handleText = (source: string, plugins = [mdiInputRules()]) => createEditor('', plugins).then((editor) => {
  const handled = editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    return view.someProp('handleTextInput', (handler) => handler(view, 1, 1, source, () => view.state.tr))
  })
  return { editor, handled }
})

describe('opt-in MDI input and clipboard acceptance', () => {
  it('keeps literal MDI and Markdown-looking text literal after save and reopen', async () => {
    const literal = '{東京|とうきょう} [[em:強調]] ^12^ **太字** [リンク](https://example.test)'
    const editor = await createEditor('')
    const persisted = editor.action((ctx) => {
      const state = ctx.get(editorStateCtx)
      const paragraph = state.schema.nodes.paragraph!.create(null, state.schema.text(literal))
      const slice = canonicalizeMdiClipboardSlice(
        new Slice(Fragment.from(paragraph), 0, 0),
        { source: 'literal-text' },
      )(ctx)
      expect(slice).not.toBeNull()
      expect(slice!.content.textBetween(0, slice!.content.size, '\n')).toBe(literal)
      expect(JSON.stringify(slice!.content.toJSON())).not.toMatch(/mdiRuby|mdiTcy|mdiBoten|strong|link/)
      expect(JSON.stringify(slice!.content.toJSON())).toContain('mdiLiteral')
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, slice!.content))
      return getMdi()(ctx)
    })

    const reopened = await createEditor(persisted)
    reopened.action((ctx) => {
      const state = ctx.get(editorStateCtx)
      expect(state.doc.textContent).toBe(literal)
      expect(JSON.stringify(state.doc.toJSON())).not.toMatch(/mdiRuby|mdiTcy|mdiBoten|strong|link/)
      expect(JSON.stringify(state.doc.toJSON())).toContain('mdiLiteral')
      expect(getMdi()(ctx)).toBe(persisted)
    })
  })

  it('canonicalizes rich slices without dropping supported document semantics', async () => {
    const editor = await createEditor('# 見出し\n\n**強調**\n\n> 引用\n\n- 一\n- 二')
    editor.action((ctx) => {
      const state = ctx.get(editorStateCtx)
      const canonical = canonicalizeMdiClipboardSlice(
        state.doc.slice(0, state.doc.content.size),
        { source: 'rich' },
      )(ctx)
      expect(canonical).not.toBeNull()
      const json = JSON.stringify(canonical!.content.toJSON())
      expect(json).toContain('heading')
      expect(json).toContain('strong')
      expect(json).toContain('blockquote')
      expect(json).toContain('bullet_list')
      expect(serializeMdiClipboard(canonical!)(ctx)).toBe(getMdi()(ctx))
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, canonical!.content))
      const mapping = createMdiEditorMapping()(ctx)
      const start = mapping.source.indexOf('強調')
      const startByte = new TextEncoder().encode(mapping.source.slice(0, start)).length
      const endByte = startByte + new TextEncoder().encode('強調').length
      expect(mapMdiSourceSpanToEditorRanges(mapping, { startByte, endByte }).coverage).toBe('complete')
    })
  })

  it('does not infer MDI semantics from ordinary text inside a rich slice', async () => {
    const editor = await createEditor('')
    editor.action((ctx) => {
      const schema = ctx.get(editorStateCtx).schema
      const paragraph = schema.nodes.paragraph!.create(null, [
        schema.text('{東京|とうきょう} '),
        schema.text('強調', [schema.marks.strong!.create()]),
        schema.text(' 連結', [schema.marks.link!.create({ href: 'https://example.test' })]),
      ])
      const canonical = canonicalizeMdiClipboardSlice(
        new Slice(Fragment.from(paragraph), 0, 0),
        { source: 'rich' },
      )(ctx)
      expect(canonical).not.toBeNull()
      const json = JSON.stringify(canonical!.content.toJSON())
      expect(json).not.toContain('mdiRuby')
      expect(json).toContain('strong')
      expect(json).toContain('link')
      expect(canonical!.content.textBetween(0, canonical!.content.size, '\n')).toBe(
        '{東京|とうきょう} 強調 連結',
      )
    })
  })

  it.each([
    ['{東京|とうきょう}', 'mdiRuby'],
    ['{雪女|ゆき.おんな}', 'mdiRuby'],
    ['^12^', 'mdiTcy'],
    ['[[em:●:傍点]]', 'mdiBoten'],
    ['[[no-break:禁則]]', 'mdiNoBreak'],
    ['[[warichu:注記]]', 'mdiWarichu'],
    ['[[kern:-0.1em:字間]]', 'mdiKern'],
    ['[[br]]', 'mdiBreak'],
  ])('accepts typed inline family %s', async (source, schemaType) => {
    const { editor, handled } = await handleText(source, [withHistory(), mdiInputRules()])
    expect(handled).toBe(true)
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      expect(JSON.stringify(view.state.doc.toJSON())).toContain(schemaType)
      expect(getMdi()(ctx)).toContain(source)
      expect(view.state.selection).toBeInstanceOf(TextSelection)
      expect(undo(view.state, view.dispatch)).toBe(true)
      expect(JSON.stringify(view.state.doc.toJSON())).not.toContain(schemaType)
      expect(redo(view.state, view.dispatch)).toBe(true)
      expect(JSON.stringify(view.state.doc.toJSON())).toContain(schemaType)
    })
  })

  it.each([
    ['[[blank]]', 'paragraph'],
    ['\\', 'paragraph'],
    ['[[pagebreak]]', 'mdiPagebreak'],
    ['[[pagebreak:right]]', 'mdiPagebreak'],
    ['[[pagebreak:left]]', 'mdiPagebreak'],
  ])('accepts typed block family %s with undo/redo and selection', async (source, schemaType) => {
    const { editor, handled } = await handleText(source, [withHistory(), mdiInputRules()])
    expect(handled).toBe(true)
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      expect(JSON.stringify(view.state.doc.toJSON())).toContain(schemaType)
      if (schemaType === 'paragraph') {
        expect(view.state.selection).toBeInstanceOf(TextSelection)
        expect(view.state.selection.empty).toBe(true)
      } else {
        expect(view.state.selection).toBeInstanceOf(NodeSelection)
        expect({ from: view.state.selection.from, to: view.state.selection.to }).toEqual({ from: 0, to: 1 })
      }
      expect(undo(view.state, view.dispatch)).toBe(true)
      expect(JSON.stringify(view.state.doc.toJSON())).not.toContain(schemaType)
      expect(redo(view.state, view.dispatch)).toBe(true)
      expect(JSON.stringify(view.state.doc.toJSON())).toContain(schemaType)
    })
  })

  it('keeps disabled, invalid, ordinary Markdown, HTML, and plain text on native fallback paths', async () => {
    const disabled = await handleText('{字|じ}', [])
    expect(disabled.handled).toBeUndefined()
    expect(disabled.editor.action(getMdi())).not.toContain('{字|じ}')

    for (const source of ['{broken|reading', '[[kern:bad:value]]']) {
      const { editor, handled } = await handleText(source)
      expect(handled, source).toBeUndefined()
      expect(editor.action((ctx) => ctx.get(editorStateCtx).doc.textContent), source).toBe('')
    }

    for (const source of ['**bold**', '<b>HTML</b>', 'plain text']) {
      const before = source.slice(0, -1)
      const input = source.slice(-1)
      const outcomes = await Promise.all([[], [mdiInputRules()]].map(async (plugins) => {
        const editor = await createEditor(before, plugins)
        return editor.action((ctx) => {
          const view = ctx.get(editorViewCtx)
          view.dispatch(view.state.tr.setSelection(TextSelection.create(
            view.state.doc,
            view.state.doc.content.size - 1,
          )))
          const pos = view.state.selection.to
          const handled = view.someProp('handleTextInput', (handler) =>
            handler(view, pos, pos, input, () => view.state.tr))
          return { handled, doc: view.state.doc.toJSON() }
        })
      }))
      expect(outcomes[1], source).toEqual(outcomes[0])
    }

    const clipboardDisabled = await createEditor('{字|じ}')
    clipboardDisabled.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)))
      const before = view.state.doc
      const copied = new Map<string, string>()
      const copy = clipboardEvent('copy', { setData: (type, value) => copied.set(type, value) })
      const paste = clipboardEvent('paste', {
        getData: (type) => type === MDI_CLIPBOARD_MIME ? '{東京|とうきょう}' : '',
      })
      expect(view.someProp('handleDOMEvents', (handlers) => handlers.copy?.(view, copy))).toBeUndefined()
      expect(view.someProp('handlePaste', (handler) => handler(view, paste, Slice.empty))).toBeUndefined()
      expect(copied.has(MDI_CLIPBOARD_MIME)).toBe(false)
      expect(view.state.doc).toBe(before)
    })
  })

  it('round-trips every inline/block family with nesting, repeated Unicode, and layout metadata', async () => {
    const source = [
      '> - **{東京|とうきょう}** ^12^ [[em:●:傍点]] [[no-break:禁則]] [[warichu:注記]] [[kern:-0.1em:字間]] 前[[br]]後 e\u0301 👩‍👩‍👧‍👦 同じ 同じ',
      '',
      '[[indent:2]]',
      'Indented',
      '',
      '[[bottom:3]]',
      'Bottom',
      '',
      '[[pagebreak]]',
      '',
      '[[pagebreak:right]]',
      '',
      '[[pagebreak:left]]',
      '',
      '[[blank]]',
    ].join('\n')
    const editor = await createEditor(source)
    editor.action((ctx) => {
      const state = ctx.get(editorStateCtx)
      const serialized = serializeMdiClipboard(state.doc.slice(0, state.doc.content.size))(ctx)
      expect(serialized).toContain('{東京|とうきょう}')
      expect(serialized).toContain('^12^')
      expect(serialized).toContain('[[em:●:傍点]]')
      expect(serialized).toContain('[[no-break:禁則]]')
      expect(serialized).toContain('[[warichu:注記]]')
      expect(serialized).toContain('[[kern:-0.1em:字間]]')
      expect(serialized).toContain('[[br]]')
      expect(serialized).toContain('[[indent:2]]')
      expect(serialized).toContain('[[bottom:3]]')
      expect(serialized).toContain('[[pagebreak]]')
      expect(serialized).toContain('[[pagebreak:right]]')
      expect(serialized).toContain('[[pagebreak:left]]')
      expect(serialized).toContain('e\u0301 👩‍👩‍👧‍👦 同じ 同じ')
      const parsed = parseMdiClipboard(serialized!, { explicit: true })(ctx)
      expect(parsed).not.toBeNull()
      expect(serializeMdiClipboard(parsed!)(ctx)).toBe(serialized)
    })
  })

  it('copies and pastes across editors through custom MIME and ordinary history', async () => {
    const copied = new Map<string, string>()
    const sourceText = [
      '> - **{東京|とうきょう}** {雪女|ゆき.おんな} ^12^ [[em:●:傍点]] [[no-break:禁則]] [[warichu:注記]] [[kern:-0.1em:字間]] 前[[br]]後 e\u0301 👩‍👩‍👧‍👦 同じ 同じ',
      '', '[[indent:2]]', 'Indented', '', '[[bottom:3]]', 'Bottom', '',
      '[[pagebreak]]', '', '[[pagebreak:right]]', '', '[[pagebreak:left]]', '', '[[blank]]',
    ].join('\n')
    const source = await createEditor(sourceText, [mdiClipboard()])
    source.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)))
      const event = clipboardEvent('copy', { setData: (type, value) => copied.set(type, value) })
      expect(view.someProp('handleDOMEvents', (handlers) => handlers.copy?.(view, event))).toBe(true)
      for (const expected of [
        '{東京|とうきょう}', '{雪女|ゆき.おんな}', '^12^', '[[em:●:傍点]]',
        '[[no-break:禁則]]', '[[warichu:注記]]', '[[kern:-0.1em:字間]]', '[[br]]',
        '[[indent:2]]', '[[bottom:3]]', '[[pagebreak]]', '[[pagebreak:right]]',
        '[[pagebreak:left]]', '\\\n', 'e\u0301 👩‍👩‍👧‍👦 同じ 同じ',
      ]) expect(copied.get(MDI_CLIPBOARD_MIME), expected).toContain(expected)
      expect(copied.get('text/plain')).toBe(copied.get(MDI_CLIPBOARD_MIME))
    })

    const target = await createEditor('', [withHistory(), mdiClipboard()])
    target.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const event = clipboardEvent('paste', { getData: (type) => copied.get(type) ?? '' })
      expect(view.someProp('handlePaste', (handler) => handler(view, event, Slice.empty))).toBe(true)
      expect(getMdi()(ctx)).toBe(copied.get(MDI_CLIPBOARD_MIME))
      expect(undo(view.state, view.dispatch)).toBe(true)
      expect(getMdi()(ctx)).not.toContain('{東京|とうきょう}')
      expect(redo(view.state, view.dispatch)).toBe(true)
      expect(getMdi()(ctx)).toContain('{東京|とうきょう}')
    })
  })

  it('supports same-editor copy/paste and text/plain when custom MIME is unavailable', async () => {
    const copied = new Map<string, string>()
    const editor = await createEditor('{字|じ}', [mdiClipboard()])
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 2)))
      const copy = clipboardEvent('copy', {
        setData: (type, value) => {
          if (type === MDI_CLIPBOARD_MIME) throw new Error('custom MIME unavailable')
          copied.set(type, value)
        },
      })
      expect(view.someProp('handleDOMEvents', (handlers) => handlers.copy?.(view, copy))).toBe(true)
      expect(copied.get('text/plain')).toContain('{字|じ}')
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)))
      const paste = clipboardEvent('paste', { getData: (type) => copied.get(type) ?? '' })
      expect(view.someProp('handlePaste', (handler) => handler(view, paste, Slice.empty))).toBe(true)
      expect(getMdi()(ctx).match(/\{字\|じ\}/g)).toHaveLength(2)
    })
  })

  it('leaves copy to the native handler when every clipboard representation is rejected', async () => {
    const editor = await createEditor('{字|じ}', [mdiClipboard()])
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 2)))
      const event = clipboardEvent('copy', {
        setData: () => { throw new Error('clipboard is read-only') },
      })
      expect(view.someProp('handleDOMEvents', (handlers) => handlers.copy?.(view, event))).toBeUndefined()
      expect(event.defaultPrevented).toBe(false)
    })
  })

  it('falls through missing/malformed/unknown MIME and rejects unsupported source versions', async () => {
    const editor = await createEditor('', [mdiClipboard()])
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const before = view.state.doc
      const fallbacks = [
        clipboardEvent('paste', { getData: () => '' }),
        clipboardEvent('paste', { getData: (type) => type === 'text/html' ? '<b>HTML</b>' : '' }),
        clipboardEvent('paste', { getData: (type) => type === 'text/plain' ? 'ordinary text' : '' }),
        clipboardEvent('paste', {
          getData: (type) => type === 'application/x-illusion-markdown;version=9.0' ? '{字|じ}' : '',
        }),
        clipboardEvent('paste', { getData: () => { throw new Error('malformed clipboard') } }),
        clipboardEvent('paste', {
          getData: (type) => type === MDI_CLIPBOARD_MIME
            ? '---\nmdi: "3.0"\n---\n\n{字|じ}'
            : '',
        }),
      ]
      for (const event of fallbacks) {
        expect(view.someProp('handlePaste', (handler) => handler(view, event, Slice.empty))).toBeUndefined()
        expect(view.state.doc).toBe(before)
      }
    })
  })

  it('deduplicates repeated registration and cleans up per editor context', async () => {
    const base = await createEditor('')
    const input = await createEditor('', [mdiInputRules()])
    const doubleInput = await createEditor('', [mdiInputRules(), mdiInputRules()])
    const clipboard = await createEditor('', [mdiClipboard()])
    const doubleClipboard = await createEditor('', [mdiClipboard(), mdiClipboard()])

    const baseRules = base.action((ctx) => ctx.get(inputRulesCtx).length)
    const singleRules = input.action((ctx) => ctx.get(inputRulesCtx).length)
    expect(doubleInput.action((ctx) => ctx.get(inputRulesCtx).length)).toBe(singleRules)
    expect(singleRules).toBeGreaterThan(baseRules)
    const basePlugins = base.action((ctx) => ctx.get(prosePluginsCtx).length)
    const singlePlugins = clipboard.action((ctx) => ctx.get(prosePluginsCtx).length)
    expect(doubleClipboard.action((ctx) => ctx.get(prosePluginsCtx).length)).toBe(singlePlugins)
    expect(singlePlugins).toBeGreaterThan(basePlugins)

    base.action((ctx) => {
      const rulesBefore = ctx.get(inputRulesCtx).length
      const pluginsBefore = ctx.get(prosePluginsCtx).length
      const releaseRules = mdiInputRules()(ctx)()
      const releaseClipboard = mdiClipboard()(ctx)()
      expect(ctx.get(inputRulesCtx).length).toBeGreaterThan(rulesBefore)
      expect(ctx.get(prosePluginsCtx).length).toBeGreaterThan(pluginsBefore)
      if (typeof releaseRules === 'function') releaseRules()
      if (typeof releaseClipboard === 'function') releaseClipboard()
      expect(ctx.get(inputRulesCtx)).toHaveLength(rulesBefore)
      expect(ctx.get(prosePluginsCtx)).toHaveLength(pluginsBefore)
    })
  })
})
