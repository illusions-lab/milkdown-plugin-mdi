import { editorViewCtx } from '@milkdown/core'
import { history, redo, undo } from '@milkdown/prose/history'
import { $prose } from '@milkdown/utils'
import { DOMParser } from '@milkdown/prose/model'
import { parse } from '@illusions-lab/mdi'
import { describe, expect, it } from 'vitest'
import { getMdi, parseMdiClipboard, prepareMdiDocument, projectCurrentMdiEditorBlocks } from '../src/index'
import { assertCompatiblePreparedMdiDocument, hasCompatiblePreparedMdiDocumentVersions } from '../src/prepared'
import { createEditor } from './harness'

const commentValues = (source: string) => {
  const values: string[] = []
  const visit = (node: any) => {
    if (node.type === 'comment') values.push(node.value)
    node.children?.forEach(visit)
  }
  parse(source, {includeComments:true}).document.children.forEach(visit)
  return values
}

describe('preserved editorial comments', () => {
  for (const source of [
    '<!--first-->body<!--last-->', '<!--one-->\n\n<!--two-->',
    '| <!--first-->body<!--last--> |\n| --- |',
    '[^a]: <!--first-->body<!--last-->\n\nreference[^a]',
    '> 前<!--\n秘密\n-->後', '- 前<!--\n秘密\n-->後',
    '| 前<!--secret-->後 |\n| --- |', '[^a]: 前<!--secret-->後\n\n本文[^a]', '<!---->',
    '前<!--secret-->後', '<!--secret-->\n\n本文', '前<!--\n雪☃\n-->後',
    '[[em:前<!-- ]] [[x]] -->後]]', '- 前<!--secret-->後', '> 前<!--secret-->後',
  ]) it(`saves and prepares ${JSON.stringify(source)}`, async () => {
    const expected = commentValues(source)
    const prepared = await prepareMdiDocument(source)
    expect(prepared.version).toBe(2)
    expect(prepared.mdiIrVersion).toBe('1.1')
    for (const initialDocument of [undefined, prepared]) {
      const editor = await createEditor(source, [], {initialDocument})
      expect(commentValues(editor.action(getMdi()))).toEqual(expected)
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        expect(view.state.doc.textContent).not.toContain('secret')
        const comments = view.dom.querySelectorAll('[data-mdi-comment]')
        expect(comments.length).toBe(expected.length)
        comments.forEach((node) => expect(node.hasAttribute('hidden')).toBe(true))
        expect(parseMdiClipboard(source, {explicit:true})(ctx)).not.toBeNull()
      })
    }
  })

  it('retains comments through adjacent edits, paragraph splitting, undo and redo', async () => {
    const editor = await createEditor('前<!--secret-->後', [$prose(() => history({newGroupDelay:-1}))])
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const original = getMdi()(ctx)
      view.dispatch(view.state.tr.insertText('新', 1))
      expect(commentValues(getMdi()(ctx))).toEqual(['secret'])
      expect(undo(view.state, view.dispatch)).toBe(true)
      expect(getMdi()(ctx)).toBe(original)
      expect(redo(view.state, view.dispatch)).toBe(true)
      view.dispatch(view.state.tr.split(2))
      expect(commentValues(getMdi()(ctx))).toEqual(['secret'])
      expect(projectCurrentMdiEditorBlocks()(ctx).blocks.length).toBe(2)
    })
  })

  it('preserves both atom forms through DOM clipboard parsing', async () => {
    const editor = await createEditor('<!--block-->\n\n前<!--inline-->後')
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const parsed = DOMParser.fromSchema(view.state.schema).parse(view.dom.cloneNode(true) as HTMLElement)
      const values: string[] = []
      parsed.descendants((node) => {
        if (node.type.name === 'mdiComment' || node.type.name === 'mdiCommentBlock') values.push(node.attrs.value)
      })
      expect(values).toEqual(['block', 'inline'])
    })
  })

  it('rejects old prepared caches explicitly', async () => {
    const prepared = await prepareMdiDocument('前<!--secret-->後')
    expect(hasCompatiblePreparedMdiDocumentVersions(prepared)).toBe(true)
    expect(hasCompatiblePreparedMdiDocumentVersions({...prepared, version:1})).toBe(false)
    expect(hasCompatiblePreparedMdiDocumentVersions({...prepared, mdiIrVersion:'1.0'})).toBe(false)
    expect(hasCompatiblePreparedMdiDocumentVersions({...prepared, provenanceVersion:'future'})).toBe(false)
    expect(() => assertCompatiblePreparedMdiDocument({...prepared, version:1} as never)).toThrow('version')
    expect(() => assertCompatiblePreparedMdiDocument({...prepared, mdiIrVersion:'1.0'})).toThrow('mdiIrVersion')
  })
})
