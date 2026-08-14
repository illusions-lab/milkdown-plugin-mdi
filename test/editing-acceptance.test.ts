import { editorViewCtx } from '@milkdown/core'
import { history, redo, undo } from '@milkdown/prose/history'
import { NodeSelection, TextSelection } from '@milkdown/prose/state'
import { $prose } from '@milkdown/utils'
import { describe, expect, it } from 'vitest'
import {
  canApplyMdiEdit,
  getMdi,
  inspectMdiSelection,
  mdiEditCommand,
  type MdiEditOperation,
  type MdiInlineMark,
} from '../src/index'
import { createEditor } from './harness'

const withHistory = () => $prose(() => history({ newGroupDelay: -1 }))

const applyUndoRedo = async (
  source: string,
  from: number,
  to: number,
  operation: MdiEditOperation,
  expected: string,
) => {
  const editor = await createEditor(source, [withHistory()])
  const before = editor.action(getMdi())
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)))
    const doc = view.state.doc
    const selection = view.state.selection
    expect(canApplyMdiEdit(view.state, operation)).toBe(true)
    expect(view.state.doc).toBe(doc)
    expect(view.state.selection.eq(selection)).toBe(true)
    expect(mdiEditCommand(operation)(view.state, view.dispatch)).toBe(true)
    expect(getMdi()(ctx)).toContain(expected)
    expect(undo(view.state, view.dispatch)).toBe(true)
    expect(getMdi()(ctx)).toBe(before)
    expect(redo(view.state, view.dispatch)).toBe(true)
    expect(getMdi()(ctx)).toContain(expected)
  })
  return editor
}

describe('typed MDI editing acceptance', () => {
  it('covers ranged Unicode group/split ruby, NodeSelection update/remove, selection, and history', async () => {
    const editor = await applyUndoRedo('東京', 1, 3, { type: 'setRuby', reading: 'とうきょう' }, '{東京|とうきょう}')
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      expect(view.state.selection).toBeInstanceOf(NodeSelection)
      expect(inspectMdiSelection(view.state).ruby).toEqual({ base: '東京', reading: 'とうきょう' })
      expect(mdiEditCommand({ type: 'setRuby', reading: ['とう', 'きょう'] })(view.state, view.dispatch)).toBe(true)
      expect(view.state.selection).toBeInstanceOf(NodeSelection)
      expect(getMdi()(ctx)).toContain('{東京|とう.きょう}')
      expect(undo(view.state, view.dispatch)).toBe(true)
      expect(getMdi()(ctx)).toContain('{東京|とうきょう}')
      expect(view.state.selection).toBeInstanceOf(NodeSelection)
      expect(redo(view.state, view.dispatch)).toBe(true)
      expect(getMdi()(ctx)).toContain('{東京|とう.きょう}')
      expect(mdiEditCommand({ type: 'removeRuby' })(view.state, view.dispatch)).toBe(true)
      expect(view.state.selection).toBeInstanceOf(TextSelection)
      expect(view.state.selection.from).toBe(1)
      expect(view.state.selection.to).toBe(3)
      expect(getMdi()(ctx)).toContain('東京')
      expect(undo(view.state, view.dispatch)).toBe(true)
      expect(getMdi()(ctx)).toContain('{東京|とう.きょう}')
      expect(view.state.selection).toBeInstanceOf(NodeSelection)
      expect(redo(view.state, view.dispatch)).toBe(true)
      expect(getMdi()(ctx)).not.toContain('{東京|とう.きょう}')
    })

    const unicode = await createEditor('e\u0301👩🏽‍💻')
    unicode.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 10)))
      expect(canApplyMdiEdit(view.state, { type: 'setRuby', reading: ['accent', 'coder'] })).toBe(true)
      expect(canApplyMdiEdit(view.state, { type: 'setRuby', reading: ['wrong'] })).toBe(false)
    })
  })

  it('rejects collapsed/structured ruby operations without mutation', async () => {
    const editor = await createEditor('one\n\ntwo')
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const before = view.state.doc
      expect(canApplyMdiEdit(view.state, { type: 'setRuby', reading: 'x' })).toBe(false)
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, view.state.doc.content.size - 1)))
      expect(canApplyMdiEdit(view.state, { type: 'setRuby', reading: 'x' })).toBe(false)
      expect(view.state.doc.eq(before)).toBe(true)
    })
  })

  it.each([
    ['tcy', undefined, '^12^'],
    ['boten', '●', '[[em:●:12]]'],
    ['noBreak', undefined, '[[no-break:12]]'],
    ['warichu', undefined, '[[warichu:12]]'],
    ['kern', '-0.1em', '[[kern:-0.1em:12]]'],
  ] as const)('applies/removes %s over a range with canonical undo/redo', async (mark, value, expected) => {
    const editor = await applyUndoRedo('12', 1, 3, { type: 'setInlineMark', mark, value }, expected)
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      expect(view.state.selection).toBeInstanceOf(TextSelection)
      expect(view.state.selection.from).toBe(1)
      expect(view.state.selection.to).toBe(3)
      expect(inspectMdiSelection(view.state).marks[mark]).toBeTruthy()
      expect(mdiEditCommand({ type: 'removeInlineMark', mark })(view.state, view.dispatch)).toBe(true)
      expect(getMdi()(ctx)).not.toContain(expected)
      expect(undo(view.state, view.dispatch)).toBe(true)
      expect(getMdi()(ctx)).toContain(expected)
      expect(redo(view.state, view.dispatch)).toBe(true)
      expect(getMdi()(ctx)).not.toContain(expected)
    })
  })

  it.each([
    ['boten', '●'], ['noBreak', undefined], ['warichu', undefined], ['kern', '+0.2em'],
  ] as const)('supports collapsed stored %s marks', async (mark, value) => {
    const editor = await createEditor('cursor')
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      expect(mdiEditCommand({ type: 'setInlineMark', mark, value })(view.state, view.dispatch)).toBe(true)
      expect(inspectMdiSelection(view.state).marks[mark]).toBeTruthy()
      expect(mdiEditCommand({ type: 'removeInlineMark', mark })(view.state, view.dispatch)).toBe(true)
      expect(inspectMdiSelection(view.state).marks[mark]).toBeUndefined()
    })
  })

  it('rejects collapsed TCY because its bounded content is selected text, not a stored mark', async () => {
    const editor = await createEditor('cursor')
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const before = view.state.doc
      expect(canApplyMdiEdit(view.state, { type: 'setInlineMark', mark: 'tcy' })).toBe(false)
      expect(mdiEditCommand({ type: 'setInlineMark', mark: 'tcy' })(view.state, view.dispatch)).toBe(false)
      expect(view.state.doc).toBe(before)
    })
  })

  it('keeps nested CommonMark/MDI marks and rejects invalid mark values/NodeSelection', async () => {
    const editor = await createEditor('**12**')
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 3)))
      expect(mdiEditCommand({ type: 'setInlineMark', mark: 'noBreak' })(view.state, view.dispatch)).toBe(true)
      expect(getMdi()(ctx)).toContain('**[[no-break:12]]**')
      expect(canApplyMdiEdit(view.state, { type: 'setInlineMark', mark: 'boten', value: 'ab' })).toBe(false)
      expect(canApplyMdiEdit(view.state, { type: 'setInlineMark', mark: 'kern', value: '1px' })).toBe(false)
      expect(canApplyMdiEdit(view.state, { type: 'setInlineMark', mark: 'tcy' })).toBe(true)
    })

    const ruby = await createEditor('{字|じ}')
    ruby.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 1)))
      for (const mark of ['tcy', 'boten', 'noBreak', 'warichu', 'kern'] as MdiInlineMark[]) {
        const before = view.state.doc
        expect(canApplyMdiEdit(view.state, { type: 'setInlineMark', mark })).toBe(false)
        expect(view.state.doc).toBe(before)
      }
    })
  })

  it('covers explicit break and all blank/pagebreak variants through history', async () => {
    await applyUndoRedo('beforeafter', 7, 7, { type: 'insertBreak' }, 'before[[br]]after')
    await applyUndoRedo('beforeafter', 7, 12, { type: 'insertBreak' }, 'before[[br]]')
    await applyUndoRedo('text', 1, 1, { type: 'insertBlank' }, '\\')
    await applyUndoRedo('text', 1, 5, { type: 'insertBlank' }, '\\')
    await applyUndoRedo('text', 1, 1, { type: 'insertPagebreak' }, '[[pagebreak]]')
    await applyUndoRedo('text', 1, 1, { type: 'insertPagebreak', variant: 'right' }, '[[pagebreak:right]]')
    await applyUndoRedo('text', 1, 1, { type: 'insertPagebreak', variant: 'left' }, '[[pagebreak:left]]')
  })

  it('defines inline NodeSelection insertion semantics without partial mutation', async () => {
    const editor = await createEditor('{字|じ}')
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 1)))
      expect(canApplyMdiEdit(view.state, { type: 'insertBreak' })).toBe(true)
      expect(canApplyMdiEdit(view.state, { type: 'insertBlank' })).toBe(false)
      expect(canApplyMdiEdit(view.state, { type: 'insertPagebreak' })).toBe(false)
      expect(mdiEditCommand({ type: 'insertBreak' })(view.state, view.dispatch)).toBe(true)
      expect(getMdi()(ctx)).toContain('[[br]]')
      expect(view.state.selection).toBeInstanceOf(TextSelection)
    })
  })

  it('rejects structurally impossible insertions without changing the document', async () => {
    const editor = await createEditor('```txt\ncode\n```')
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 5)))
      const operations = [
        { type: 'insertBreak' }, { type: 'insertBlank' }, { type: 'insertPagebreak' },
      ] as MdiEditOperation[]
      const accepted = operations.map((operation) => {
        const before = view.state.doc
        const result = canApplyMdiEdit(view.state, operation)
        expect(view.state.doc).toBe(before)
        return result
      })
      expect(accepted).toEqual([false, false, false])
      for (const operation of operations) {
        const before = view.state.doc
        expect(mdiEditCommand(operation)(view.state, view.dispatch)).toBe(false)
        expect(view.state.doc).toBe(before)
      }
    })
  })

  it('sets, updates, switches, and clears indent/bottom with boundaries and history', async () => {
    const editor = await createEditor('layout', [withHistory()])
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      expect(mdiEditCommand({ type: 'setParagraphLayout', layout: 'indent', value: 1 })(view.state, view.dispatch)).toBe(true)
      expect(getMdi()(ctx)).toContain('[[indent:1]]')
      expect(mdiEditCommand({ type: 'setParagraphLayout', layout: 'indent', value: 3 })(view.state, view.dispatch)).toBe(true)
      expect(inspectMdiSelection(view.state).paragraphLayout).toEqual({ layout: 'indent', value: 3 })
      expect(mdiEditCommand({ type: 'setParagraphLayout', layout: 'bottom' })(view.state, view.dispatch)).toBe(true)
      expect(getMdi()(ctx)).toContain('[[bottom]]')
      expect(mdiEditCommand({ type: 'setParagraphLayout', layout: 'bottom', value: 4 })(view.state, view.dispatch)).toBe(true)
      expect(getMdi()(ctx)).toContain('[[bottom:4]]')
      expect(mdiEditCommand({ type: 'clearParagraphLayout' })(view.state, view.dispatch)).toBe(true)
      expect(inspectMdiSelection(view.state).paragraphLayout).toBeNull()
      expect(undo(view.state, view.dispatch)).toBe(true)
      expect(inspectMdiSelection(view.state).paragraphLayout).toEqual({ layout: 'bottom', value: 4 })
      expect(redo(view.state, view.dispatch)).toBe(true)
      expect(inspectMdiSelection(view.state).paragraphLayout).toBeNull()
      expect(canApplyMdiEdit(view.state, { type: 'setParagraphLayout', layout: 'indent', value: 0 })).toBe(false)
      expect(canApplyMdiEdit(view.state, { type: 'setParagraphLayout', layout: 'bottom', value: -1 })).toBe(false)
      expect(canApplyMdiEdit(view.state, { type: 'setParagraphLayout', layout: 'indent', value: 1.5 })).toBe(false)
    })

    const leaf = await createEditor('[[pagebreak]]')
    leaf.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 0)))
      expect(canApplyMdiEdit(view.state, { type: 'setParagraphLayout', layout: 'indent', value: 1 })).toBe(false)
      expect(canApplyMdiEdit(view.state, { type: 'clearParagraphLayout' })).toBe(false)
    })

    const multiple = await createEditor('one\n\ntwo')
    multiple.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 8)))
      const before = view.state.doc
      expect(canApplyMdiEdit(view.state, { type: 'setParagraphLayout', layout: 'indent', value: 1 })).toBe(false)
      expect(mdiEditCommand({ type: 'setParagraphLayout', layout: 'indent', value: 1 })(view.state, view.dispatch)).toBe(false)
      expect(view.state.doc).toBe(before)
    })
  })
})
