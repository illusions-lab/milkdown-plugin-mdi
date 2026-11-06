import { editorViewCtx } from '@milkdown/core'
import { splitBlock } from '@milkdown/prose/commands'
import { Plugin, TextSelection } from '@milkdown/prose/state'
import { $prose } from '@milkdown/utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getMdi } from '../src/index'
import { createEditor } from './harness'

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }))
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

for (const action of ['cancel', 'blur', 'selection', 'destroy'] as const) {
  it(`synthetic IME lifecycle: ${action}`, async () => {
    let transactions = 0
    const editor = await createEditor('前\n\n後', [$prose(() => new Plugin({
      appendTransaction(trs) { transactions += trs.length; return null },
    }))])
    const view = editor.action(ctx => ctx.get(editorViewCtx))
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)))
    splitBlock(view.state, view.dispatch)
    const initial = editor.action(getMdi())
    view.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    const paragraph = view.nodeDOM(3)!
    view.dispatch(view.state.tr.insertText('ち').setMeta('composition', 1))
    expect(paragraph.isConnected).toBe(true)
    if (action === 'cancel') view.dispatch(view.state.tr.delete(4, 5).setMeta('composition', 1))
    if (action === 'blur') view.dom.dispatchEvent(new FocusEvent('blur'))
    if (action === 'selection') view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)))
    view.dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    if (action === 'destroy') {
      await editor.destroy()
      const count = transactions
      await vi.runAllTimersAsync()
      expect(view.isDestroyed).toBe(true)
      expect(transactions).toBe(count)
      return
    }
    await vi.runAllTimersAsync()
    expect(view.state.doc.child(1).attrs.mdiBlank).toBe(action === 'cancel')
    if (action === 'cancel') expect(editor.action(getMdi())).toBe(initial)
    else expect(editor.action(getMdi())).toContain('ち')
  })
}

it('destroying one instance with pending normalization leaves the other usable', async () => {
  let destroyedTransactions = 0
  const first = await createEditor('甲', [$prose(() => new Plugin({
    appendTransaction(trs) { destroyedTransactions += trs.length; return null },
  }))])
  const second = await createEditor('乙')
  const firstView = first.action(ctx => ctx.get(editorViewCtx))
  const secondView = second.action(ctx => ctx.get(editorViewCtx))
  firstView.dispatch(firstView.state.tr.setSelection(TextSelection.create(firstView.state.doc, 2)))
  splitBlock(firstView.state, firstView.dispatch)
  firstView.dispatch(firstView.state.tr.insertText('ち').setMeta('composition', 1))
  await first.destroy()
  const count = destroyedTransactions
  secondView.dispatch(secondView.state.tr.insertText('続行'))
  await vi.runAllTimersAsync()
  expect(destroyedTransactions).toBe(count)
  expect(second.action(getMdi())).toContain('続行乙')
  expect(secondView.isDestroyed).toBe(false)
})
