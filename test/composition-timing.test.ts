import { editorViewCtx } from '@milkdown/core'
import { splitBlock } from '@milkdown/prose/commands'
import { TextSelection } from '@milkdown/prose/state'
import { expect, it } from 'vitest'
import { getMdi } from '../src/index'
import { createEditor } from './harness'

// Synthetic composition event/transaction scheduling, not real Japanese IME acceptance.
for (const source of ['前\n\n後', '前', '通常本文']) {
  for (const timing of ['before', 'same-turn', 'next-task'] as const) {
    for (const metadata of [false, true]) {
      it(`synthetic IME ${JSON.stringify(source)} ${timing} metadata=${metadata}`, async () => {
        const editor = await createEditor(source)
        const view = editor.action(ctx => ctx.get(editorViewCtx))
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)))
        expect(splitBlock(view.state, view.dispatch)).toBe(true)
        const parentPosition = view.state.selection.$from.before()
        for (let cycle = 0; cycle < 2; cycle++) {
          view.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
          const paragraph = view.nodeDOM(parentPosition)!
          const start = view.state.selection.from
          const provisional = view.state.tr.insertText('t')
          view.dispatch(metadata ? provisional.setMeta('composition', cycle + 1) : provisional)
          expect(paragraph.isConnected).toBe(true)
          expect(view.nodeDOM(parentPosition)).toBe(paragraph)
          const finalize = () => {
            const tr = view.state.tr.insertText('ち', start, start + 1)
            view.dispatch(metadata ? tr.setMeta('composition', cycle + 1) : tr)
          }
          if (timing === 'before') finalize()
          view.dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'ち' }))
          if (timing === 'same-turn') finalize()
          if (timing === 'next-task') await new Promise<void>(resolve => setTimeout(() => { finalize(); resolve() }, 0))
          await expect.poll(() => view.state.doc.nodeAt(parentPosition)?.attrs.mdiBlank).toBe(false)
          expect(view.state.doc.textContent).toContain('ち'.repeat(cycle + 1))
        }
        const saved = editor.action(getMdi())
        expect((await createEditor(saved)).action(getMdi())).toBe(saved)
      })
    }
  }
}
