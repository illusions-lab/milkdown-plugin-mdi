import { Editor, rootCtx, defaultValueCtx, editorViewCtx } from '@milkdown/core'
import { commonmark } from '@milkdown/preset-commonmark'
import { $prose } from '@milkdown/utils'
import { history, undoDepth, redoDepth } from '@milkdown/prose/history'
import { EditorState, TextSelection, NodeSelection } from '@milkdown/prose/state'
import { Plugin } from '@milkdown/prose/state'
import type { EditorView } from '@milkdown/prose/view'
import { allowsMdiTransaction } from '../src/layout-contract'
import { initializeMdi, mdi, mdiClipboard, getMdi, inspectMdiDocument } from '../src/index'

const main = async () => {
  await initializeMdi()
  const editors: Record<string, Editor> = {}
  const attempts: Record<string, number[]> = {}
  const rejected: Record<string, boolean[]> = {}
  const structured = new URLSearchParams(location.search).has('structured')
  const create = async (id: string, source: string) => {
    if (editors[id]) await editors[id]!.destroy()
    document.getElementById(id)!.replaceChildren()
    attempts[id] = []; rejected[id] = []
    const editor = Editor.make().config(ctx => { ctx.set(rootCtx, document.getElementById(id)!); ctx.set(defaultValueCtx, source) })
      .use(commonmark).use($prose(() => history()))
      .use($prose(() => new Plugin({ filterTransaction(tr, state) { if (tr.docChanged) { attempts[id]!.push(inspectMdiDocument(tr.doc).length); rejected[id]!.push(!allowsMdiTransaction(tr, state.doc)) } return true } }))).use(mdi())
    if (structured) editor.use(mdiClipboard())
    await editor.create(); editors[id] = editor
  }
  const act = (id: string, fn: (view: EditorView) => any) => editors[id]!.action(ctx => fn(ctx.get(editorViewCtx)))
  const semantic = (value: any): any => Array.isArray(value) ? value.map(semantic) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'span').map(([key, child]) => [key, semantic(child)])) : value
  await create('source', '[[indent:2]]\nsource')
  await create('target', 'target')
  ;(window as any).layout = {
    ready: true, load: create,
    select(id: string, pos?: number, node = false) { act(id, view => { view.focus(); view.dispatch(view.state.tr.setSelection(node ? NodeSelection.create(view.state.doc, pos ?? 0) : TextSelection.create(view.state.doc, pos ?? 1, pos == null ? view.state.doc.content.size - 1 : pos))) }) },
    paragraph(id: string) { act(id, view => {
      let pos = 0
      view.state.doc.descendants((node, at) => { if (node.type.name === 'paragraph') pos = at })
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos + 1)))
    }) },
    legacy(id: string) { act(id, view => {
      const schema = view.state.schema
      const doc = schema.nodes.doc.create(null, schema.nodes.blockquote.create(null, schema.nodes.paragraph.create({ mdiIndent: 2 }, schema.text('legacy'))))
      view.updateState(EditorState.create({ schema, doc, plugins: view.state.plugins, selection: NodeSelection.create(doc, 0) }))
    }) },
    snapshot(id: string) { return act(id, view => ({ doc: semantic(view.state.doc.toJSON()), selection: view.state.selection.toJSON(), marks: view.state.storedMarks, undo: undoDepth(view.state), redo: redoDepth(view.state) })) },
    source(id: string) { return editors[id]!.action(ctx => getMdi()(ctx)) },
    attempts(id: string) { return attempts[id] },
    rejected(id: string) { return rejected[id] },
    async transfer(from: string, to: string, drag: boolean, copy: boolean, atEnd = false) {
      const data = new DataTransfer()
      const clipboardEvent = (type: string) => {
        const event = new ClipboardEvent(type, { bubbles: true, cancelable: true, clipboardData: data })
        // Firefox constructs a separate, read-only store for synthetic clipboard events.
        Object.defineProperty(event, 'clipboardData', { value: data })
        return event
      }
      act(from, view => {
        view.dom.dispatchEvent(drag ? new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: data, ctrlKey: copy, altKey: copy }) : clipboardEvent('copy'))
      })
      act(to, view => {
        const rect = atEnd ? view.coordsAtPos(view.state.doc.content.size - 1) : view.dom.getBoundingClientRect()
        view.dom.dispatchEvent(drag ? new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data, clientX: rect.left + 8, clientY: rect.top + 2, ctrlKey: copy, altKey: copy }) : clipboardEvent('paste'))
      })
      await new Promise<void>(resolve => {
        let frames = 0
        const stable = () => {
          if (document.querySelector('[style*="-10000px"]')) frames = 0
          else frames++
          if (frames >= 2) resolve(); else requestAnimationFrame(stable)
        }
        requestAnimationFrame(stable)
      })
      return { html: data.getData('text/html'), types: Array.from(data.types) }
    },
  }

}
void main()
