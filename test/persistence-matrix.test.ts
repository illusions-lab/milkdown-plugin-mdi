import { editorViewCtx } from '@milkdown/core'
import { history, closeHistory, undo, redo } from '@milkdown/prose/history'
import { TextSelection } from '@milkdown/prose/state'
import { $prose } from '@milkdown/utils'
import { expect, it } from 'vitest'
import { getMdi, mdiClipboard, mdiInputRules } from '../src/index'
import { createEditor } from './harness'
import { comparable } from './scenarios/editing'

it.each([
  '前\n\n\\\n\n\\\n\n後', '前<!-- secret -->後', '{東京|とうきょう}',
  '[[warichu:注記]]', '[[indent:2]]\n本文', '[[bottom:2]]\n本文',
  '\\{literal|reading\\}', '👩🏽‍💻e\u0301日本語',
])('edit, history, and stable persistence: %j', async source => {
  const editor = await createEditor(source, [$prose(() => history())])
  const view = editor.action(ctx => ctx.get(editorViewCtx))
  const position = view.state.selection.from
  view.dispatch(closeHistory(view.state.tr.setSelection(TextSelection.create(view.state.doc, position))))
  const before = view.state.doc
  const selection = view.state.selection
  view.dispatch(view.state.tr.insertText('追記'))
  const edited = view.state.doc
  const afterSelection = view.state.selection
  expect(undo(view.state, view.dispatch)).toBe(true)
  expect(view.state.doc.eq(before)).toBe(true)
  expect(view.state.selection.eq(selection)).toBe(true)
  expect(redo(view.state, view.dispatch)).toBe(true)
  expect(view.state.doc.eq(edited)).toBe(true)
  expect(view.state.selection.eq(afterSelection)).toBe(true)
  const saved = editor.action(getMdi())
  const reloaded = await createEditor(saved)
  expect(comparable(reloaded.action(ctx => ctx.get(editorViewCtx).state.doc.toJSON()))).toEqual(comparable(edited.toJSON()))
  expect(reloaded.action(getMdi())).toBe(saved)
})

it('deduplicated input/clipboard registrations do not share history or frontmatter', async () => {
  const plugins = () => [mdiInputRules(), mdiInputRules(), mdiClipboard(), mdiClipboard(), $prose(() => history())]
  const a = await createEditor('---\ntitle: A\n---\n\n甲', plugins())
  const b = await createEditor('---\ntitle: B\n---\n\n乙', plugins())
  const original = b.action(getMdi())
  const bv = b.action(ctx => ctx.get(editorViewCtx))
  a.action(ctx => {
    const view = ctx.get(editorViewCtx)
    view.dispatch(view.state.tr.insertText('変更'))
    expect(undo(view.state, view.dispatch)).toBe(true)
    expect(redo(view.state, view.dispatch)).toBe(true)
  })
  expect(b.action(getMdi())).toBe(original)
  expect(undo(bv.state, bv.dispatch)).toBe(false)
  await a.destroy()
  bv.dispatch(bv.state.tr.insertText('続行'))
  expect(b.action(getMdi())).toContain('title: B')
})
