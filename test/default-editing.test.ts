import { editorViewCtx } from '@milkdown/core'
import { baseKeymap, chainCommands, exitCode } from '@milkdown/prose/commands'
import { TextSelection } from '@milkdown/prose/state'
import { expect, it } from 'vitest'
import { createCommonMarkEditor, createEditor } from './harness'
import { comparable, editingScenarios } from './scenarios/editing'

it.each(editingScenarios.filter(s => 'key' in s && s.key !== 'Shift+Enter'))('default command: $name', async scenario => {
  const states = []
  for (const create of [createCommonMarkEditor, createEditor]) {
    const editor = await create(scenario.source)
    const view = editor.action(ctx => ctx.get(editorViewCtx))
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, scenario.from)))
    if ('key' in scenario) {
      const command = scenario.key === 'Enter' ? chainCommands(exitCode, baseKeymap.Enter) : baseKeymap[scenario.key]
      command(view.state, view.dispatch, view)
    }
    states.push({ doc: comparable(view.state.doc.toJSON()), selection: view.state.selection.toJSON() })
  }
  if (states[0].doc.content.length > 1) {
    for (const node of states[0].doc.content) {
      if (node.type === 'paragraph' && !node.content?.length) node.attrs = { ...node.attrs, mdiBlank: true }
    }
  }
  expect(states[1]).toEqual(states[0])
})
