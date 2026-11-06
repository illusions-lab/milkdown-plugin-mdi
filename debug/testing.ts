import { Editor, defaultValueCtx, editorViewCtx, rootCtx } from '@milkdown/core'
import { commonmark } from '@milkdown/preset-commonmark'
import { history, undo, redo } from '@milkdown/prose/history'
import { Plugin, TextSelection } from '@milkdown/prose/state'
import { $prose, getMarkdown } from '@milkdown/utils'
import { verticalWriting } from '@illusions-lab/milkdown-plugin-vertical-writing'
import { getMdi, initializeMdi, mdi, mdiClipboard, mdiInputRules } from '../src/index'
import { prepareMdiDocument } from '../src/prepared'

type Config = { source: string; mode?: 'commonmark' | 'mdi' | 'input' | 'vertical'; prepared?: boolean }
const instances = new Map<string, { editor: Editor; root: HTMLElement; count: () => number; config: Config }>()
const errors: string[] = []
window.addEventListener('error', e => errors.push(String(e.error ?? e.message)))
window.addEventListener('unhandledrejection', e => errors.push(String(e.reason)))
const entry = (id: string) => {
  const value = instances.get(id)
  if (!value) throw new Error(`Unknown editor: ${id}`)
  return value
}
const api = {
  errors,
  ids: () => [...instances.keys()],
  async create(id: string, config: Config) {
    if (instances.has(id)) throw new Error(`Duplicate editor: ${id}`)
    await initializeMdi()
    const root = document.createElement('div')
    root.id = id
    root.className = 'instance'
    document.body.append(root)
    let count = 0
    const editor = Editor.make().config(ctx => {
      ctx.set(rootCtx, root)
      ctx.set(defaultValueCtx, config.source)
    }).use(commonmark).use($prose(() => history())).use($prose(() => new Plugin({
      appendTransaction(trs) { count += trs.length; return null },
    })))
    if (config.mode !== 'commonmark') editor.use(mdi(config.prepared
      ? { initialDocument: await prepareMdiDocument(config.source) } : {}))
    if (config.mode === 'input' || config.mode === 'vertical') editor.use([mdiInputRules(), mdiClipboard()])
    if (config.mode === 'vertical') editor.use(verticalWriting({ mode: 'vertical-rl' }))
    await editor.create()
    instances.set(id, { editor, root, count: () => count, config })
  },
  async destroy(id: string) {
    const { editor, root } = entry(id)
    await editor.destroy()
    root.remove()
    instances.delete(id)
  },
  async rebuild(id: string, source: string) {
    const { config } = entry(id)
    await api.destroy(id)
    await api.create(id, { ...config, source })
  },
  select(id: string, from: number, to = from) {
    entry(id).editor.action(ctx => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)))
      view.focus()
    })
  },
  snapshot(id: string) {
    const { editor, config, count } = entry(id)
    return editor.action(ctx => {
      const { doc, selection } = ctx.get(editorViewCtx).state
      return { source: (config.mode === 'commonmark' ? getMarkdown() : getMdi())(ctx),
        doc: doc.toJSON(), selection: selection.toJSON(), transactions: count() }
    })
  },
  history(id: string, direction: 'undo' | 'redo') {
    return entry(id).editor.action(ctx => {
      const view = ctx.get(editorViewCtx)
      return (direction === 'undo' ? undo : redo)(view.state, view.dispatch)
    })
  },
}
window.__EDITING__ = api
declare global { interface Window { __EDITING__: typeof api } }
