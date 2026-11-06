import { editorViewCtx } from '@milkdown/core'
import { splitBlock } from '@milkdown/prose/commands'
import { closeHistory, history, redo, undo } from '@milkdown/prose/history'
import { TextSelection } from '@milkdown/prose/state'
import { $prose } from '@milkdown/utils'
import { expect, it } from 'vitest'
import { getMdi } from '../src/index'
import { createEditor } from './harness'

const setup = async (source = '前\n\n後') => {
  const editor = await createEditor(source, [$prose(() => history())])
  const view = editor.action(ctx => ctx.get(editorViewCtx))
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)))
  expect(splitBlock(view.state, view.dispatch)).toBe(true)
  view.dispatch(closeHistory(view.state.tr))
  expect(view.state.doc.child(1).attrs.mdiBlank).toBe(true)
  return { editor, view }
}

it.each([true, false])('preserves the composing paragraph and text node (composition metadata: %s)', async (metadata) => {
  const { editor, view } = await setup()
  view.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
  const paragraph = view.nodeDOM(3)!
  const insert = view.state.tr.insertText('t')
  view.dispatch(metadata ? insert.setMeta('composition', 1) : insert)
  const text = paragraph.firstChild
  view.dispatch(view.state.tr.insertText('i'))
  expect(view.nodeDOM(3)).toBe(paragraph)
  expect(paragraph.firstChild).toBe(text)
  expect(view.state.doc.child(1).attrs.mdiBlank).toBe(true)
  expect(editor.action(getMdi())).toContain('ti')
  view.dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'ち' }))
  // Some browsers flush the final composition transaction after compositionend.
  view.dispatch(view.state.tr.insertText('ち', 4, 6).setMeta('composition', 1))
  expect(view.state.doc.child(1).attrs.mdiBlank).toBe(true)
  await expect.poll(() => view.state.doc.child(1).attrs.mdiBlank).toBe(false)
  const saved = editor.action(getMdi())
  const reloaded = await createEditor(saved)
  expect(reloaded.action(getMdi())).toBe(saved)
  expect(undo(view.state, view.dispatch)).toBe(true)
  expect(view.state.doc.child(1).content.size).toBe(0)
  expect(view.state.doc.child(1).attrs.mdiBlank).toBe(true)
  expect(redo(view.state, view.dispatch)).toBe(true)
  expect(view.state.doc.child(1).textContent).toBe('ち')
  expect(view.state.doc.child(1).attrs.mdiBlank).toBe(false)
})

it('normalizes metadata-only composition input without another edit or DOM event', async () => {
  const { view } = await setup()
  view.dispatch(view.state.tr.insertText('ち').setMeta('composition', 0))
  expect(view.state.doc.child(1).attrs.mdiBlank).toBe(true)
  await expect.poll(() => view.state.doc.child(1).attrs.mdiBlank).toBe(false)
})

it('restores the blank marker after composition is cancelled', async () => {
  const { editor, view } = await setup()
  const saved = editor.action(getMdi())
  view.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
  view.dispatch(view.state.tr.insertText('t').setMeta('composition', 1))
  view.dispatch(view.state.tr.delete(4, 5).setMeta('composition', 1))
  view.dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
  await new Promise(resolve => setTimeout(resolve, 60))
  expect(view.state.doc.child(1).attrs.mdiBlank).toBe(true)
  expect(editor.action(getMdi())).toBe(saved)
})

it('cleans up pending normalization when the editor is destroyed', async () => {
  const { editor, view } = await setup()
  view.dispatch(view.state.tr.insertText('ち').setMeta('composition', 1))
  await editor.destroy()
  await new Promise(resolve => setTimeout(resolve, 60))
  expect(view.isDestroyed).toBe(true)
})

it.each([
  ['前\n\n後', 2, 'paragraph', ''],
  ['前後\n\n次', 2, 'paragraph', '後'],
  ['前', 2, 'paragraph', ''],
  ['# 見出し', 4, 'paragraph', ''],
  ['# 見出し', 2, 'heading', '出し'],
] as const)('uses the expected block when splitting %j at %s', async (source, position, type, text) => {
  const editor = await createEditor(source)
  const view = editor.action(ctx => ctx.get(editorViewCtx))
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, position)))
  expect(splitBlock(view.state, view.dispatch)).toBe(true)
  expect(view.state.selection.$from.parent.type.name).toBe(type)
  expect(view.state.selection.$from.parent.textContent).toBe(text)
})

it('creates an empty document with a paragraph by default', async () => {
  const editor = await createEditor('')
  const view = editor.action(ctx => ctx.get(editorViewCtx))
  expect(view.state.schema.topNodeType.createAndFill()?.firstChild?.type.name).toBe('paragraph')
})
