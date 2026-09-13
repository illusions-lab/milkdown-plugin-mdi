import { editorViewCtx } from '@milkdown/core'
import { DOMSerializer } from '@milkdown/prose/model'
import { NodeSelection, TextSelection } from '@milkdown/prose/state'
import { expect, it } from 'vitest'
import { getMdi } from '../src/index'
import { createEditor } from './harness'

it('isolates native Ruby layout inside a selectable editor-only atom', async () => {
  const editor = await createEditor('文{東|ひがし}')
  editor.action(ctx => {
    const view = ctx.get(editorViewCtx)
    const atom = view.nodeDOM(2) as HTMLElement
    expect(atom.className).toBe('mdi-ruby-atom')
    expect(atom.contentEditable).toBe('false')
    expect(atom.querySelector('ruby rt')?.textContent).toBe('ひがし')
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 2)))
    expect(atom.classList.contains('ProseMirror-selectednode')).toBe(true)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)).insertText('末'))
    expect(getMdi()(ctx)).toBe('文{東|ひがし}末\n')
    view.dispatch(view.state.tr.setNodeMarkup(2, undefined, { base: '西', ruby: 'にし' }))
    expect(view.dom.querySelector('ruby rt')?.textContent).toBe('にし')
    const exported = document.createElement('div')
    exported.append(DOMSerializer.fromSchema(view.state.schema).serializeFragment(view.state.doc.content))
    expect(exported.querySelector('ruby')).not.toBeNull()
    expect(exported.querySelector('.mdi-ruby-atom')).toBeNull()
    expect(getMdi()(ctx)).toBe('文{西|にし}末\n')
  })
})
