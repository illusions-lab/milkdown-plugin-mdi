import { type MilkdownPlugin } from '@milkdown/ctx'
import { defaultValueCtx, Editor, rootCtx } from '@milkdown/core'
import { commonmark } from '@milkdown/preset-commonmark'
import { afterEach, beforeAll, expect } from 'vitest'
import { initializeMdi, mdi } from '../src/index'

const editors: Array<{ editor: Editor; root: HTMLElement }> = []
let errors: unknown[] = []

beforeAll(async () => {
  await initializeMdi()
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
})

afterEach(async () => {
  await Promise.all(editors.splice(0).map(async ({ editor, root }) => {
    await editor.destroy()
    root.remove()
  }))
  expect(errors).toEqual([])
  errors = []
})

export const createEditor = async (source: string, plugins: MilkdownPlugin[] = []) => {
  const root = document.createElement('div')
  document.body.append(root)
  const editor = Editor.make().config((ctx) => {
    ctx.set(rootCtx, root)
    ctx.set(defaultValueCtx, source)
  }).use(commonmark).use(mdi()).use(plugins)
  await editor.create()
  editors.push({ editor, root })
  return editor
}

const onError = (event: ErrorEvent) => errors.push(event.error ?? event.message)
const onRejection = (event: PromiseRejectionEvent) => errors.push(event.reason)
