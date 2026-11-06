import { editorViewCtx, serializerCtx } from '@milkdown/core'
import { getMarkdown } from '@milkdown/utils'
import { history, undo, redo, undoDepth, redoDepth } from '@milkdown/prose/history'
import { DOMParser, Slice, Fragment } from '@milkdown/prose/model'
import { $prose } from '@milkdown/utils'
import { wrapIn } from '@milkdown/prose/commands'
import { wrapInList, sinkListItem, liftListItem } from '@milkdown/prose/schema-list'
import { EditorState, TextSelection } from '@milkdown/prose/state'
import { describe, expect, it, vi } from 'vitest'
import { serializeMdiClipboard, getMdi, guardMdiCommand, inspectMdiDocument, mdiEditCommand, MdiDocumentValidationError } from '../src/index'
import { allowsMdiTransaction, validMdiLayoutValue } from '../src/layout-contract'
import { createEditor } from './harness'

describe('MDI paragraph persistence contract', () => {
  for (const layout of ['indent', 'bottom'] as const) for (const value of [layout === 'indent' ? 1 : 0, 4294967295]) {
    it(`round trips ${layout}:${value}`, async () => {
      const editor = await createEditor('text')
      let source = ''
      let json: unknown
      editor.action(ctx => {
        const view = ctx.get(editorViewCtx)
        expect(mdiEditCommand({ type: 'setParagraphLayout', layout, value })(view.state, view.dispatch)).toBe(true)
        source = getMdi()(ctx)
        json = view.state.doc.toJSON()
      })
      const reloaded = await createEditor(source)
      reloaded.action(ctx => expect(ctx.get(editorViewCtx).state.doc.toJSON()).toEqual(json))
    })
  }
  for (const source of ['> text', '- text', '1. text', '> - text']) it(`rejects nested layout in ${source}`, async () => {
    const editor = await createEditor(source)
    editor.action(ctx => {
      const view = ctx.get(editorViewCtx)
      let pos = 0
      view.state.doc.descendants((node, at) => { if (node.type.name === 'paragraph') pos = at })
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos + 1)))
      const before = view.state
      const command = mdiEditCommand({ type: 'setParagraphLayout', layout: 'indent', value: 2 })
      expect(command(before)).toBe(false)
      expect(command(before, () => { throw new Error('dispatched') })).toBe(false)
      view.dispatch(before.tr.setNodeMarkup(pos, undefined, { ...before.doc.nodeAt(pos)!.attrs, mdiIndent: 2 }))
      expect(view.state).toBe(before)
    })
  })
  it('preserves update, switch, clear and history semantics across saves', async () => {
    const editor = await createEditor('text', [$prose(() => history({ newGroupDelay: -1 }))])
    for (const operation of [
      { type: 'setParagraphLayout', layout: 'indent', value: 2 },
      { type: 'setParagraphLayout', layout: 'indent', value: 4 },
      { type: 'setParagraphLayout', layout: 'bottom', value: 0 },
      { type: 'clearParagraphLayout' },
    ] as const) {
      let source = '', expected: unknown
      editor.action(ctx => {
        const view = ctx.get(editorViewCtx)
        const before = view.state.doc
        expect(mdiEditCommand(operation)(view.state, view.dispatch)).toBe(true)
        expected = view.state.doc.toJSON()
        source = getMdi()(ctx)
        expect(undo(view.state, view.dispatch)).toBe(true)
        expect(view.state.doc.eq(before)).toBe(true)
        expect(redo(view.state, view.dispatch)).toBe(true)
        expect(view.state.doc.toJSON()).toEqual(expected)
      })
      const loaded = await createEditor(source)
      loaded.action(ctx => expect(ctx.get(editorViewCtx).state.doc.toJSON()).toEqual(expected))
    }
  })
  it('blocks structured paste into a container and preserves syntax-looking text', async () => {
    const editor = await createEditor('> ordinary [[indent:2]] text')
    editor.action(ctx => {
      const view = ctx.get(editorViewCtx)
      const before = view.state
      const html = document.createElement('div')
      html.innerHTML = '<p data-mdi-indent="2">paste</p>'
      const parsed = DOMParser.fromSchema(before.schema).parseSlice(html)
      view.dispatch(before.tr.replaceRange(1, before.doc.content.size - 1, parsed))
      expect(view.state).toBe(before)
      const paragraph = before.schema.nodes.paragraph!.create({ mdiIndent: 2 }, before.schema.text('paste'))
      const slice = new Slice(Fragment.from(paragraph), 0, 0)
      view.dispatch(before.tr.replaceRange(1, before.doc.content.size - 1, slice))
      expect(view.state).toBe(before)
      expect(inspectMdiDocument(before.doc)).toEqual([])
      expect(getMdi()(ctx)).toContain('[[indent:2]]')
    })
  })
  for (const source of ['> [[indent:2]]\n> text', '- [[bottom]]\n  text', '1. [[bottom:2]]\n   text']) {
    it(`keeps container directive-looking text literal: ${source}`, async () => {
      const editor = await createEditor(source)
      let serialized = '', expected: unknown
      editor.action(ctx => {
        const doc = ctx.get(editorViewCtx).state.doc
        expect(inspectMdiDocument(doc)).toEqual([])
        expected = doc.toJSON()
        serialized = getMdi()(ctx)
      })
      const reloaded = await createEditor(serialized)
      reloaded.action(ctx => {
        expect(ctx.get(editorViewCtx).state.doc.toJSON()).toEqual(expected)
        expect(getMdi()(ctx)).toBe(serialized)
      })
    })
  }
  it('guards wrapping and refuses direct wrapping transactions', async () => {
    const editor = await createEditor('text')
    editor.action(ctx => {
      const view = ctx.get(editorViewCtx)
      mdiEditCommand({ type: 'setParagraphLayout', layout: 'indent', value: 2 })(view.state, view.dispatch)
      const command = wrapIn(view.state.schema.nodes.blockquote!)
      const before = view.state
      expect(guardMdiCommand(command)(before)).toBe(false)
      expect(guardMdiCommand(command)(before, view.dispatch)).toBe(false)
      command(before, view.dispatch)
      expect(view.state).toBe(before)
    })
  })
  it('diagnoses legacy state, permits editing and clearing, and rejects export', async () => {
    const editor = await createEditor('> text', [$prose(() => history({ newGroupDelay: -1 }))])
    editor.action(ctx => {
      const view = ctx.get(editorViewCtx)
      const json = view.state.doc.toJSON()
      json.content[0].content[0].attrs.mdiIndent = 2
      const doc = uncheckedNode(view.state.schema, json)
      view.updateState(EditorState.create({ schema: view.state.schema, doc, plugins: view.state.plugins, selection: TextSelection.create(doc, 2) }))
      expect(inspectMdiDocument(doc)).toEqual([{ code: 'layout-context', pos: 1 }])
      expect(guardMdiCommand(wrapIn(view.state.schema.nodes.blockquote!))(view.state)).toBe(false)
      expect(() => getMdi()(ctx)).toThrow(MdiDocumentValidationError)
      expect(() => getMarkdown()(ctx)).toThrow(MdiDocumentValidationError)
      view.dispatch(view.state.tr.insertText('more'))
      expect(view.state.doc.textContent).toContain('more')
      expect(mdiEditCommand({ type: 'clearParagraphLayout' })(view.state, view.dispatch)).toBe(true)
      expect(() => getMdi()(ctx)).not.toThrow()
      const repaired = view.state.doc
      undo(view.state, view.dispatch)
      expect(view.state.doc.eq(repaired)).toBe(true)
    })
  })
  it('rejects conflicting, malformed and newly empty attributes without blocking repairs', async () => {
    const editor = await createEditor('text\n\nother')
    editor.action(ctx => {
      const view = ctx.get(editorViewCtx)
      const { state } = view
      expect(validMdiLayoutValue('indent', '2')).toBe(false)
      for (const attrs of [{ mdiIndent: 2, mdiBottom: 0 }, { mdiIndent: -1 }, { mdiBottom: 4294967296 }]) {
        const tr = state.tr.setNodeMarkup(0, undefined, attrs)
        expect(allowsMdiTransaction(tr, state.doc)).toBe(false)
      }
      const invalid = state.doc.copy(state.doc.content.replaceChild(0, state.schema.nodes.paragraph!.create({ mdiIndent: -1, mdiBottom: 0 }, state.doc.firstChild!.content)))
      expect(inspectMdiDocument(invalid).map(i => i.code)).toEqual(['layout-conflict', 'layout-value'])
      const legacy = EditorState.create({ schema: state.schema, doc: invalid })
      expect(allowsMdiTransaction(legacy.tr.insertText('x', 2), invalid)).toBe(true)
      expect(allowsMdiTransaction(legacy.tr.setNodeMarkup(0, undefined, { mdiIndent: -2, mdiBottom: 0 }), invalid)).toBe(false)
      expect(allowsMdiTransaction(legacy.tr.setNodeMarkup(0, undefined, { mdiIndent: -1 }), invalid)).toBe(true)
      expect(allowsMdiTransaction(legacy.tr.setNodeMarkup(0, undefined, { mdiIndent: 2, mdiBottom: 0 }), invalid)).toBe(true)
      const laidOut = EditorState.create({ schema: state.schema, doc: state.doc.copy(state.doc.content.replaceChild(0, state.schema.nodes.paragraph!.create({ mdiIndent: 2 }, state.doc.firstChild!.content))) })
      const empty = state.schema.nodes.paragraph!.create({ mdiIndent: 2 })
      expect(allowsMdiTransaction(laidOut.tr.insert(0, empty), laidOut.doc)).toBe(false)
      expect(allowsMdiTransaction(state.tr.replaceWith(0, 6, empty), state.doc)).toBe(false)
      expect(guardMdiCommand(() => false)(state)).toBe(false)
      expect(guardMdiCommand(() => true)(state)).toBe(true)
      expect(guardMdiCommand((s, dispatch) => { dispatch?.(s.tr); return true })(state)).toBe(true)
    })
  })
  it('reuses unchanged subtrees during ordinary long-document input', async () => {
    const editor = await createEditor('seed')
    editor.action(ctx => {
      const schema = ctx.get(editorViewCtx).state.schema
      const blocks = Array.from({ length: 10000 }, () => schema.nodes.paragraph!.create(null, schema.text('body '.repeat(20))))
      const doc = schema.nodes.doc!.create(null, blocks)
      expect(inspectMdiDocument(doc)).toEqual([])
      const sharedTraversal = vi.spyOn(blocks[5000]!, 'forEach')
      const state = EditorState.create({ schema, doc })
      const started = performance.now()
      for (let index = 0; index < 20; index++) expect(allowsMdiTransaction(state.tr.insertText('x', 2), doc)).toBe(true)
      expect(sharedTraversal).not.toHaveBeenCalled()
      expect(performance.now() - started).toBeLessThan(2000)
      sharedTraversal.mockRestore()
    })
  })
  it('allows deleting laid-out text but requires clearing before export', async () => {
    const editor = await createEditor('text')
    editor.action(ctx => {
      const view = ctx.get(editorViewCtx)
      for (const value of [0, -1, 4294967296, NaN, Infinity, 1.5]) expect(mdiEditCommand({ type: 'setParagraphLayout', layout: 'indent', value })(view.state)).toBe(false)
      mdiEditCommand({ type: 'setParagraphLayout', layout: 'bottom' })(view.state, view.dispatch)
      view.dispatch(view.state.tr.delete(1, 5))
      expect(inspectMdiDocument(view.state.doc)).toEqual([{ code: 'layout-empty', pos: 0 }])
      expect(() => getMdi()(ctx)).toThrow(MdiDocumentValidationError)
      expect(mdiEditCommand({ type: 'setParagraphLayout', layout: 'indent', value: 1 })(view.state)).toBe(false)
      mdiEditCommand({ type: 'clearParagraphLayout' })(view.state, view.dispatch)
      expect(() => getMdi()(ctx)).not.toThrow()
    })
  })
})

const layouts = [
  { type: 'setParagraphLayout', layout: 'indent', value: 2 },
  { type: 'setParagraphLayout', layout: 'bottom' },
  { type: 'setParagraphLayout', layout: 'bottom', value: 3 },
] as const
const semantic = (value: any): any => Array.isArray(value) ? value.map(semantic) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'span').map(([key, child]) => [key, semantic(child)])) : value
const snapshot = (state: EditorState) => ({ doc: state.doc, selection: state.selection.toJSON(), marks: state.storedMarks,
  history: state.plugins.map(plugin => plugin.getState(state)), undo: undoDepth(state), redo: redoDepth(state) })
const seedHistory = (view: import('@milkdown/prose/view').EditorView) => {
  view.dispatch(view.state.tr.insertText('a'))
  view.dispatch(view.state.tr.insertText('b'))
  expect(undo(view.state, view.dispatch)).toBe(true)
  view.dispatch(view.state.tr.setStoredMarks([view.state.schema.marks.strong!.create()]))
  expect(undoDepth(view.state)).toBeGreaterThan(0)
  expect(redoDepth(view.state)).toBeGreaterThan(0)
}
describe('#24 complete entry and refusal matrix', () => {
  for (const source of ['text', '> text', '1. text', '- text', '> - text', '- > text', '- outer\n  1. inner']) {
    for (const operation of layouts) it(`support matrix ${source} ${JSON.stringify(operation)}`, async () => {
      const editor = await createEditor(source, [$prose(() => history({ newGroupDelay: -1 }))])
      editor.action(ctx => {
        const view = ctx.get(editorViewCtx)
        seedHistory(view)
        let pos = 0
        view.state.doc.descendants((node, at) => { if (node.type.name === 'paragraph') pos = at })
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos + 1)).setStoredMarks([view.state.schema.marks.strong!.create()]))
        const before = view.state, saved = snapshot(before), dispatch = vi.fn(view.dispatch)
        const command = mdiEditCommand(operation), allowed = source === 'text'
        expect(command(before)).toBe(allowed)
        expect(command(before, dispatch)).toBe(allowed)
        expect(dispatch).toHaveBeenCalledTimes(allowed ? 1 : 0)
        if (!allowed) { expect(view.state).toBe(before); expect(snapshot(view.state)).toEqual(saved) }
      })
    })
  }
  for (const layout of ['indent', 'bottom'] as const) for (const value of [-1, 1.5, NaN, Infinity, 4294967296, ...(layout === 'indent' ? [0] : [])]) {
    it(`invalid ${layout} ${value} preserves populated state`, async () => {
      const editor = await createEditor('text', [$prose(() => history({ newGroupDelay: -1 }))])
      editor.action(ctx => {
        const view = ctx.get(editorViewCtx); seedHistory(view)
        const before = view.state, saved = snapshot(before), dispatch = vi.fn()
        const command = mdiEditCommand({ type: 'setParagraphLayout', layout, value })
        expect(command(before)).toBe(false); expect(command(before, dispatch)).toBe(false)
        expect(dispatch).not.toHaveBeenCalled(); expect(snapshot(view.state)).toEqual(saved)
      })
    })
  }
  for (const operation of layouts) it(`empty refusal ${JSON.stringify(operation)}`, async () => {
    const editor = await createEditor('text\n\nother', [$prose(() => history({ newGroupDelay: -1 }))])
    editor.action(ctx => {
      const view = ctx.get(editorViewCtx); seedHistory(view)
      view.dispatch(view.state.tr.insert(view.state.doc.content.size, view.state.schema.nodes.paragraph!.create()).setMeta('addToHistory', false))
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.doc.content.size - 1)).setStoredMarks([view.state.schema.marks.strong!.create()]))
      const before = view.state, saved = snapshot(before), dispatch = vi.fn()
      const command = mdiEditCommand(operation)
      expect(command(before)).toBe(false); expect(command(before, dispatch)).toBe(false)
      expect(dispatch).not.toHaveBeenCalled(); expect(snapshot(view.state)).toEqual(saved)
    })
  })
  for (const operation of layouts) it(`three reloads after lifecycle ${JSON.stringify(operation)}`, async () => {
    let editor = await createEditor('**marked** text\n\n> quote\n\n- list', [$prose(() => history({ newGroupDelay: -1 }))])
    for (const action of [operation, { ...operation, value: 4 }, ...layouts, { type: 'clearParagraphLayout' }] as const) {
      let source = '', expected: any
      editor.action(ctx => {
        const view = ctx.get(editorViewCtx), before = view.state.doc
        expect(mdiEditCommand(action)(view.state, view.dispatch)).toBe(true)
        expected = semantic(view.state.doc.toJSON()); source = getMdi()(ctx)
        expect(undo(view.state, view.dispatch)).toBe(true); expect(view.state.doc.eq(before)).toBe(true)
        expect(redo(view.state, view.dispatch)).toBe(true); expect(semantic(view.state.doc.toJSON())).toEqual(expected)
      })
      for (let round = 0; round < 3; round++) {
        editor = await createEditor(source, [$prose(() => history({ newGroupDelay: -1 }))])
        editor.action(ctx => { expect(semantic(ctx.get(editorViewCtx).state.doc.toJSON())).toEqual(expected); source = getMdi()(ctx) })
      }
    }
  })
  for (const container of ['blockquote', 'bullet_list', 'ordered_list']) it(`wrap refusal ${container}`, async () => {
    const editor = await createEditor('text', [$prose(() => history({ newGroupDelay: -1 }))])
    editor.action(ctx => {
      const view = ctx.get(editorViewCtx)
      mdiEditCommand(layouts[0])(view.state, view.dispatch)
      seedHistory(view)
      const before = view.state, saved = snapshot(before)
      const command = container === 'blockquote' ? wrapIn(before.schema.nodes[container]!) : wrapInList(before.schema.nodes[container]!)
      const dispatch = vi.fn(view.dispatch)
      expect(guardMdiCommand(command)(before)).toBe(false)
      expect(guardMdiCommand(command)(before, dispatch)).toBe(false); expect(dispatch).not.toHaveBeenCalled()
      expect(command(before, dispatch)).toBe(true); expect(dispatch).toHaveBeenCalledTimes(1)
      expect(view.state).toBe(before); expect(snapshot(view.state)).toEqual(saved)
    })
  })
  it('legacy diagnostics migrate and sequential repairs permit save but cannot be undone', async () => {
    const editor = await createEditor('lead\n\n> quote\n\n- one\n- two', [$prose(() => history({ newGroupDelay: -1 }))])
    let source = '', expected: unknown
    editor.action(ctx => {
      const view = ctx.get(editorViewCtx), original = view.state
      const json = original.doc.toJSON()
      json.content[1].content[0].attrs.mdiIndent = 2
      json.content[2].content[0].content[0].attrs.mdiBottom = 0
      const doc = uncheckedNode(original.schema, json)
      view.updateState(EditorState.create({ schema: original.schema, doc, plugins: original.plugins }))
      const issues = inspectMdiDocument(doc)
      expect(issues).toHaveLength(2)
      view.dispatch(view.state.tr.insertText('prefix', 1))
      expect(inspectMdiDocument(view.state.doc)).toEqual(issues.map(issue => ({ ...issue, pos: issue.pos + 6 })))
      const before = view.state
      for (const serialize of [() => ctx.get(serializerCtx)(view.state.doc), () => getMdi()(ctx), () => getMarkdown()(ctx)]) {
        try { serialize(); throw new Error('expected validation') } catch (error) { expect(error).toBeInstanceOf(MdiDocumentValidationError); expect((error as MdiDocumentValidationError).issues).toEqual(inspectMdiDocument(view.state.doc)) }
      }
      expect(serializeMdiClipboard(new Slice(view.state.doc.content, 0, 0))(ctx)).toBeNull()
      expect(view.state).toBe(before)
      let issue = inspectMdiDocument(view.state.doc)[0]!
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, issue.pos + 1)))
      mdiEditCommand({ type: 'clearParagraphLayout' })(view.state, view.dispatch)
      expect(() => getMdi()(ctx)).toThrow(MdiDocumentValidationError)
      issue = inspectMdiDocument(view.state.doc)[0]!
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, issue.pos + 1)))
      expect(liftListItem(view.state.schema.nodes.list_item!)(view.state, view.dispatch)).toBe(true)
      expect(inspectMdiDocument(view.state.doc)).toEqual([])
      const repaired = view.state.doc
      undo(view.state, view.dispatch); expect(view.state.doc.eq(repaired)).toBe(true)
      source = getMdi()(ctx); expected = semantic(view.state.doc.toJSON())
    })
    const loaded = await createEditor(source)
    loaded.action(ctx => expect(semantic(ctx.get(editorViewCtx).state.doc.toJSON())).toEqual(expected))
  })
  it('ordinary list sink works while deeper legacy layout is refused and neighbours remain editable', async () => {
    const editor = await createEditor('- first\n- second\n- third')
    editor.action(ctx => {
      const view = ctx.get(editorViewCtx)
      const positions: number[] = []; view.state.doc.descendants((node, pos) => { if (node.type.name === 'paragraph') positions.push(pos) })
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, positions[1]! + 1)))
      const sink = sinkListItem(view.state.schema.nodes.list_item!)
      expect(sink(view.state, view.dispatch)).toBe(true)
      const json = view.state.doc.toJSON()
      json.content[0].content[1].content[0].attrs.mdiIndent = 2
      const doc = uncheckedNode(view.state.schema, json)
      let target = 0; doc.descendants((node, pos) => { if (node.attrs.mdiIndent === 2) target = pos })
      view.updateState(EditorState.create({ schema: view.state.schema, plugins: view.state.plugins, doc, selection: TextSelection.create(doc, target + 1) }))
      const before = view.state
      expect(sink(before, view.dispatch)).toBe(true); expect(view.state).toBe(before)
      view.dispatch(view.state.tr.insertText('editable', 3)); expect(view.state.doc.textContent).toContain('editable')
    })
  })
})

// Rebuild a legacy tree without JSON attribute validation: CommonMark list
// parsing can retain string spread attributes on existing list items.
const uncheckedNode = (schema: import('@milkdown/prose/model').Schema, json: any): import('@milkdown/prose/model').Node => json.type === 'text' ? schema.text(json.text, json.marks?.map((mark: any) => schema.markFromJSON(mark))) : schema.nodes[json.type]!.create(json.attrs, json.content?.map((child: any) => uncheckedNode(schema, child)))
