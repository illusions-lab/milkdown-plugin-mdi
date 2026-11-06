import { type MilkdownPlugin } from '@milkdown/ctx'
import { defaultValueCtx, Editor, rootCtx } from '@milkdown/core'
import { commonmark } from '@milkdown/preset-commonmark'
import { afterAll, afterEach, beforeAll, expect } from 'vitest'
import { initializeMdi, mdi } from '../src/index'

const editors: Array<{ editor: Editor; root: HTMLElement }> = []
let errors: unknown[] = []

beforeAll(async () => {
  await initializeMdi()
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
})

afterAll(() => {
  window.removeEventListener('error', onError)
  window.removeEventListener('unhandledrejection', onRejection)
})

afterEach(async () => {
  await Promise.all(editors.splice(0).map(async ({ editor, root }) => {
    await editor.destroy()
    root.remove()
  }))
  expect(errors).toEqual([])
  errors = []
})

export const createEditor = async (
  source: string,
  plugins: MilkdownPlugin[] = [],
  mdiOptions: NonNullable<Parameters<typeof mdi>[0]> = {},
  baseline = false,
) => {
  const root = document.createElement('div')
  document.body.append(root)
  const editor = Editor.make().config((ctx) => {
    ctx.set(rootCtx, root)
    ctx.set(defaultValueCtx, source)
  }).use(commonmark)
  if (!baseline) editor.use(mdi(mdiOptions))
  editor.use(plugins)
  await editor.create()
  editors.push({ editor, root })
  return editor
}

const onError = (event: ErrorEvent) => errors.push(event.error ?? event.message)
const onRejection = (event: PromiseRejectionEvent) => errors.push(event.reason)

export const createCommonMarkEditor = (source: string, plugins: MilkdownPlugin[] = []) =>
  createEditor(source, plugins, {}, true)
