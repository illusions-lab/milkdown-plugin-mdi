import { editorViewCtx } from '@milkdown/core'
import { closeHistory, history, undo, redo } from '@milkdown/prose/history'
import { TextSelection } from '@milkdown/prose/state'
import { $prose } from '@milkdown/utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getMdi, mdiEditCommand } from '../src/index'
import { createEditor } from './harness'
import { shrinkFailure } from './scenarios/shrink'
import { comparable } from './scenarios/editing'

// Milkdown Timer leaves resolved deadline callbacks scheduled. Own this suite's
// clock so thousands of short-lived instances cannot fire after jsdom teardown.
beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }))
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

const extended = process.env.MDI_EXTENDED === '1'
const seeds = process.env.MDI_SEED ? [Number(process.env.MDI_SEED)] : Array.from({ length: extended ? 128 : 16 }, (_, i) => i + 1)
const steps = extended ? 200 : 50
// Integer-only PRNG makes replay independent of browser/runtime randomness.
const random = (seed: number) => () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
  return seed / 0x100000000
}
type Operation = { kind: number; index: number; offset: number; text: string }
class InvalidReplay extends Error {}
async function run(seed: number, replay?: Operation[]) {
  const rng = random(seed)
  let editor = await createEditor('初期', [$prose(() => history())])
  let model = ['初期']
  let past: string[][] = []
  let future: string[][] = []
  const operations: Operation[] = []
  for (let step = 0; step < (replay?.length ?? steps); step++) {
    const view = editor.action(ctx => ctx.get(editorViewCtx))
    const index = replay?.[step].index ?? Math.floor(rng() * model.length)
    if (index >= model.length) throw new InvalidReplay()
    const offset = replay?.[step].offset ?? Math.floor(rng() * (model[index].length + 1))
    if (offset > model[index].length) throw new InvalidReplay()
    const position = model.slice(0, index).reduce((n, text) => n + text.length + 2, 1) + offset
    const kind = replay?.[step].kind ?? Math.floor(rng() * 10)
    const text = replay?.[step].text ?? (kind === 0 ? '日a語'[Math.floor(rng() * 3)] : '')
    operations.push({ kind, index, offset, text })
    const beforeState = view.state.toJSON()
    try {
      view.dispatch(closeHistory(view.state.tr.setSelection(TextSelection.create(view.state.doc, position))))
      if (kind <= 3) {
        past.push([...model]); future = []
        if (kind === 0) {
          view.dispatch(view.state.tr.insertText(text))
          model[index] = model[index].slice(0, offset) + text + model[index].slice(offset)
        } else if (kind === 1) {
          view.dispatch(view.state.tr.split(position))
          model.splice(index, 1, model[index].slice(0, offset), model[index].slice(offset))
        } else if (kind === 2 && offset > 0) {
          view.dispatch(view.state.tr.delete(position - 1, position))
          model[index] = model[index].slice(0, offset - 1) + model[index].slice(offset)
        } else {
          view.dispatch(view.state.tr.insertText('替', position, position + model[index].length - offset))
          model[index] = model[index].slice(0, offset) + '替'
        }
      } else if (kind === 4 && past.length) {
        expect(undo(view.state, view.dispatch)).toBe(true)
        future.push([...model]); model = past.pop()!
      } else if (kind === 5 && future.length) {
        expect(redo(view.state, view.dispatch)).toBe(true)
        past.push([...model]); model = future.pop()!
      } else if (kind === 6) {
        const source = editor.action(getMdi())
        const semantic = comparable(view.state.doc.toJSON())
        await editor.destroy()
        editor = await createEditor(source, [$prose(() => history())])
        expect(editor.action(getMdi())).toBe(source)
        expect(comparable(editor.action(ctx => ctx.get(editorViewCtx).state.doc.toJSON()))).toEqual(semantic)
        past = []; future = []
      } else if (kind === 8 && model[index].length > 0) {
        const start = position - offset
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, start, start + model[index].length)))
        const beforeMark = view.state.doc
        expect(mdiEditCommand({ type: 'setInlineMark', mark: 'noBreak' })(view.state, view.dispatch)).toBe(true)
        if (!view.state.doc.eq(beforeMark)) { past.push([...model]); future = [] }
        expect(view.state.doc.child(index).firstChild?.marks.some(mark => mark.type.name === 'mdiNoBreak')).toBe(true)
      } else if (kind === 9 && index > 0) {
        past.push([...model]); future = []
        view.dispatch(view.state.tr.join(position - offset - 1))
        model.splice(index - 1, 2, model[index - 1] + model[index])
      } else if (kind === 7) {
        const before = view.state.doc
        expect(mdiEditCommand({ type: 'setRuby', reading: 'よみ' })(view.state, view.dispatch)).toBe(false)
        expect(view.state.doc).toBe(before)
      }
      const current = editor.action(ctx => ctx.get(editorViewCtx).state)
      current.doc.check()
      const actual: string[] = []
      current.doc.forEach(node => { expect(node.type.name).toBe('paragraph'); actual.push(node.textContent) })
      expect(actual).toEqual(model)
      expect(current.selection.from).toBeGreaterThanOrEqual(0)
      expect(current.selection.to).toBeLessThanOrEqual(current.doc.content.size)
    } catch (error) {
      await editor.destroy()
      throw Object.assign(new Error('stateful failure', { cause: error }), { operations, model, beforeState, state: view.state.toJSON() })
    }
  }
  await editor.destroy()
}

const signature = (error: unknown) => {
  if (error instanceof InvalidReplay) return null
  const cause = (error as Error).cause as Error | undefined
  return `${cause?.name ?? (error as Error).name}:${cause?.message.split('\n')[0] ?? (error as Error).message}`
}
for (const seed of seeds) it(`stateful paragraph model seed=${seed}`, async () => {
  try { await run(seed, process.env.MDI_OPERATIONS ? JSON.parse(process.env.MDI_OPERATIONS) as Operation[] : undefined) } catch (error) {
    const failed = error as Error & { operations: Operation[]; model: string[]; beforeState: unknown; state: unknown }
    const identity = signature(error)!
    const minimized = await shrinkFailure(failed.operations, identity, async candidate => {
      try { await run(seed, candidate); return null } catch (failure) { return signature(failure) }
    })
    throw new Error(JSON.stringify({ seed, initial: '初期', operations: failed.operations, minimized, model: failed.model, beforeState: failed.beforeState, state: failed.state }), { cause: error })
  }
})
