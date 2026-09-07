import { editorViewCtx } from '@milkdown/core'
import { TextSelection } from '@milkdown/prose/state'
import { expect, it, vi } from 'vitest'
import { DecorationSet } from '@milkdown/prose/view'
import { getMdi, inspectMdiSelection, mdiEditCommand } from '../src/index'
import { createEditor } from './harness'

it('keeps editable warichu children and removes the wrapper at an interior cursor', async () => {
  const editor = await createEditor('前[[warichu:注記]]後')
  editor.action(ctx => {
    const view = ctx.get(editorViewCtx)
    const node = view.state.doc.nodeAt(2)!
    expect(node.type.name).toBe('mdiWarichu')
    expect(node.isAtom).toBe(false)
    expect(node.textContent).toBe('注記')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 4)))
    expect(inspectMdiSelection(view.state).marks.warichu).toBe(true)
    expect(mdiEditCommand({ type: 'removeInlineMark', mark: 'warichu' })(view.state, view.dispatch)).toBe(true)
    expect(getMdi()(ctx).trim()).toBe('前注記後')
    expect(view.state.selection.from).toBe(3)
  })
})

it('creates an empty editable wrapper through both operation names and unwraps selected siblings', async () => {
  const editor = await createEditor('一[[warichu:二]]三[[warichu:四]]五')
  editor.action(ctx => {
    const view = ctx.get(editorViewCtx)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, view.state.doc.content.size - 1)))
    expect(mdiEditCommand({ type: 'removeWarichu' })(view.state, view.dispatch)).toBe(true)
    expect(getMdi()(ctx).trim()).toBe('一二三四五')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)))
    expect(mdiEditCommand({ type: 'setWarichu' })(view.state, view.dispatch)).toBe(true)
    expect(inspectMdiSelection(view.state).marks.warichu).toBe(true)
    view.dispatch(view.state.tr.insertText('注'))
    expect(getMdi()(ctx)).toContain('[[warichu:注]]')
  })
})

it('preserves ruby and formatting inside warichu while deleting its final character', async () => {
  const editor = await createEditor('[[warichu:**注**{東京|とうきょう}]]')
  editor.action(ctx => {
    const view = ctx.get(editorViewCtx)
    expect(getMdi()(ctx)).toContain('[[warichu:**注**{東京|とうきょう}]]')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)))
    expect(mdiEditCommand({ type: 'removeWarichu' })(view.state, view.dispatch)).toBe(true)
    expect(getMdi()(ctx)).toContain('**注**{東京|とうきょう}')
  })
})

it('wraps and unwraps selected content across paragraphs in one transaction', async () => {
  const editor = await createEditor('一二\n\n三四')
  editor.action(ctx => {
    const view = ctx.get(editorViewCtx)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 7)))
    expect(mdiEditCommand({ type: 'setWarichu' })(view.state, view.dispatch)).toBe(true)
    expect(getMdi()(ctx).trim()).toBe('[[warichu:一二]]\n\n[[warichu:三四]]')
    expect(mdiEditCommand({ type: 'removeWarichu' })(view.state, view.dispatch)).toBe(true)
    expect(getMdi()(ctx).trim()).toBe('一二\n\n三四')
  })
})

it('does no presentation observation, geometry or transactions for ordinary paragraphs', async () => {
  const observe = vi.fn()
  vi.stubGlobal('ResizeObserver', class { observe = observe; disconnect() {} })
  const editor = await createEditor('ordinary text')
  editor.action(ctx => {
    const view = ctx.get(editorViewCtx)
    const create = vi.spyOn(DecorationSet, 'create')
    const query = vi.spyOn(view.dom, 'querySelectorAll')
    const geometry = vi.spyOn(view.dom, 'getBoundingClientRect')
    for (let count = 0; count < 5; count += 1) view.dispatch(view.state.tr.insertText('x', 2))
    expect(observe).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    expect(query).not.toHaveBeenCalled()
    expect(geometry).not.toHaveBeenCalled()
    create.mockRestore(); query.mockRestore(); geometry.mockRestore()
  })
  vi.unstubAllGlobals()
})

it('removes an empty annotation when a selection-only transaction leaves it', async () => {
  const editor = await createEditor('前後')
  editor.action(ctx => {
    const view = ctx.get(editorViewCtx)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)))
    expect(mdiEditCommand({ type: 'setWarichu' })(view.state, view.dispatch)).toBe(true)
    expect(view.state.doc.nodeAt(2)?.type.name).toBe('mdiWarichu')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)))
    expect(view.state.doc.textContent).toBe('前後')
    expect(getMdi()(ctx).trim()).toBe('前後')
    expect(mdiEditCommand({ type: 'removeWarichu' })(view.state, view.dispatch)).toBe(false)
  })
})

it.each([false, true])('preserves selection beyond a removed wrapper (backward=%s)', async backward => {
  const editor = await createEditor('前[[warichu:注記]]後')
  editor.action(ctx => {
    const view = ctx.get(editorViewCtx)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, backward ? 7 : 4, backward ? 4 : 7)))
    expect(mdiEditCommand({ type: 'removeWarichu' })(view.state, view.dispatch)).toBe(true)
    expect(view.state.selection.anchor).toBe(backward ? 5 : 3)
    expect(view.state.selection.head).toBe(backward ? 3 : 5)
  })
})
