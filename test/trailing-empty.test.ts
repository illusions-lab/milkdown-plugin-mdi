import { editorViewCtx } from '@milkdown/core'
import { splitBlock } from '@milkdown/prose/commands'
import { closeHistory, history, redo, undo } from '@milkdown/prose/history'
import { TextSelection } from '@milkdown/prose/state'
import { $prose } from '@milkdown/utils'
import { expect, it } from 'vitest'
import { getMdi, prepareMdiDocument } from '../src/index'
import { createEditor } from './harness'

for (const prepared of [false, true]) {
  const create = async (source: string) => createEditor(source, [$prose(() => history())],
    prepared ? { initialDocument: await prepareMdiDocument(source) } : {})
  for (const count of [1, 3]) {
    it(`preserves ${count} terminal Enter blocks through history and three reopens prepared=${prepared}`, async () => {
      let editor = await create('字')
      const view = editor.action(ctx => ctx.get(editorViewCtx))
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)))
      for (let i = 0; i < count; i++) {
        view.dispatch(closeHistory(view.state.tr))
        expect(splitBlock(view.state, view.dispatch)).toBe(true)
      }
      const expected = view.state.doc.toJSON()
      expect(view.state.doc.childCount).toBe(count + 1)
      expect(undo(view.state, view.dispatch)).toBe(true)
      expect(view.state.doc.childCount).toBe(count)
      expect(redo(view.state, view.dispatch)).toBe(true)
      expect(view.state.doc.toJSON()).toEqual(expected)
      for (let i = 0; i < 3; i++) {
        const saved = editor.action(getMdi())
        await editor.destroy()
        editor = await create(saved)
        expect(editor.action(ctx => ctx.get(editorViewCtx).state.doc.toJSON())).toEqual(expected)
        expect(editor.action(getMdi())).toBe(saved)
      }
    })
  }
  for (const cancel of [false, true]) {
    it(`exports terminal composition before and after normalization without mutation cancel=${cancel} prepared=${prepared}`, async () => {
      const editor = await create('前\n\n後')
      const view = editor.action(ctx => ctx.get(editorViewCtx))
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 4, 5)))
      view.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
      view.dispatch(view.state.tr.deleteSelection().setMeta('composition', 1))
      if (cancel) {
        view.dispatch(view.state.tr.insertText('t').setMeta('composition', 1))
        view.dispatch(view.state.tr.delete(4, 5).setMeta('composition', 1))
      }
      view.dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
      expect(view.state.doc.lastChild?.attrs.mdiBlank).toBe(false)
      const before = view.state
      const saved = editor.action(getMdi())
      expect(view.state).toBe(before)
      const reopened = await create(saved)
      const expected = reopened.action(ctx => ctx.get(editorViewCtx).state.doc.toJSON())
      expect(expected.content.map((node: any) => [node.type, node.content, node.attrs.mdiBlank])).toEqual([
        ['paragraph', [{ type: 'text', text: '前' }], false], ['paragraph', undefined, true],
      ])
      await expect.poll(() => view.state.doc.lastChild?.attrs.mdiBlank).toBe(true)
      expect(view.state.doc.toJSON()).toEqual(expected)
      expect(editor.action(getMdi())).toBe(saved)
      expect(undo(view.state, view.dispatch)).toBe(true)
      expect(view.state.doc.textContent).toBe('前後')
      expect(redo(view.state, view.dispatch)).toBe(true)
      expect(view.state.doc.toJSON()).toEqual(expected)
    })
  }
}
