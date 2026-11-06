import { editorViewCtx } from '@milkdown/core'
import { history, undo, redo } from '@milkdown/prose/history'
import { NodeSelection, TextSelection } from '@milkdown/prose/state'
import { $prose } from '@milkdown/utils'
import { expect, it } from 'vitest'
import { getMdi } from '../src/index'
import { createEditor } from './harness'

const cases = [
  { source: '前{東京|とうきょう}後', type: 'mdiRuby' },
  { source: '前[[warichu:注記]]後', type: 'mdiWarichu' },
  { source: '前<!--secret-->後', type: 'mdiComment' },
  { source: '前\n\n[[pagebreak]]\n\n後', type: 'mdiPagebreak' },
]
for (const item of cases) {
  for (const operation of ['before', 'after', 'replace', 'delete'] as const) {
    it(`${item.type}: ${operation}, history and persistence`, async () => {
      const editor = await createEditor(item.source, [$prose(() => history())])
      const view = editor.action(ctx => ctx.get(editorViewCtx))
      let position = -1
      view.state.doc.descendants((node, pos) => { if (node.type.name === item.type) position = pos })
      expect(position).toBeGreaterThanOrEqual(0)
      const node = view.state.doc.nodeAt(position)!
      const before = view.state.doc
      if (operation === 'replace' || operation === 'delete') {
        view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, position)))
        expect(view.state.selection).toBeInstanceOf(NodeSelection)
        view.dispatch(operation === 'replace' ? view.state.tr.insertText('替') : view.state.tr.deleteSelection())
        let remaining = 0
        view.state.doc.descendants(child => { if (child.type.name === item.type) remaining++ })
        expect(remaining).toBe(0)
        expect(view.state.doc.textContent).toContain('前')
        expect(view.state.doc.textContent).toContain('後')
      } else {
        const boundary = node.isInline ? (operation === 'before' ? position : position + node.nodeSize)
          : operation === 'before' ? 2 : view.state.doc.content.size - 1
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, boundary)))
        view.dispatch(view.state.tr.insertText('👩🏽‍💻e\u0301日'))
        expect(view.state.doc.textContent).toContain('👩🏽‍💻e\u0301日')
        let found = false
        view.state.doc.descendants(child => { if (child.eq(node)) found = true })
        expect(found).toBe(true)
      }
      const edited = view.state.doc
      edited.check()
      expect(undo(view.state, view.dispatch)).toBe(true)
      expect(view.state.doc.eq(before)).toBe(true)
      expect(redo(view.state, view.dispatch)).toBe(true)
      expect(view.state.doc.eq(edited)).toBe(true)
      const saved = editor.action(getMdi())
      expect((await createEditor(saved)).action(getMdi())).toBe(saved)
    })
  }
}
