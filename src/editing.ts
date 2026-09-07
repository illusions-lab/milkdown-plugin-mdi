import { Fragment, type Node as ProseNode } from '@milkdown/prose/model'
import { NodeSelection, TextSelection, type Command, type EditorState } from '@milkdown/prose/state'

export type MdiRubyReading = string | readonly string[]
export type MdiPagebreakVariant = 'right' | 'left' | null
export type MdiInlineMark = 'tcy' | 'boten' | 'noBreak' | 'warichu' | 'kern'

export type MdiEditOperation =
  | { type: 'setRuby'; reading: MdiRubyReading }
  | { type: 'removeRuby' }
  | { type: 'setWarichu' }
  | { type: 'removeWarichu' }
  | { type: 'setInlineMark'; mark: MdiInlineMark; value?: string }
  | { type: 'removeInlineMark'; mark: MdiInlineMark }
  | { type: 'insertBreak' }
  | { type: 'insertBlank' }
  | { type: 'insertPagebreak'; variant?: MdiPagebreakVariant }
  | { type: 'setParagraphLayout'; layout: 'indent' | 'bottom'; value?: number }
  | { type: 'clearParagraphLayout' }

export interface MdiSelectionState {
  ruby: { base: string; reading: string | string[] } | null
  marks: Partial<Record<MdiInlineMark, string | true>>
  paragraphLayout: { layout: 'indent' | 'bottom'; value: number } | null
}

const markName = (mark: MdiInlineMark) => ({
  tcy: 'mdiTcy',
  boten: 'mdiBoten',
  noBreak: 'mdiNoBreak',
  warichu: 'mdiWarichu',
  kern: 'mdiKern',
})[mark]

const markAttrs = (mark: MdiInlineMark, value?: string) => {
  if (mark === 'boten') return { mark: value ?? '﹅' }
  if (mark === 'kern') return { amount: value ?? '0em' }
  return undefined
}

const paragraphPosition = (state: EditorState) => {
  const { $from, $to } = state.selection
  if (!$from.sameParent($to)) return null
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name === 'paragraph') {
      return { node: $from.node(depth), pos: $from.before(depth) }
    }
  }
  return null
}

const selectedRuby = (state: EditorState) => {
  const { selection } = state
  return selection instanceof NodeSelection && selection.node.type.name === 'mdiRuby'
    ? selection.node
    : null
}

const selectedPlainText = (state: EditorState) => {
  const { from, to, empty, $from, $to } = state.selection
  if (empty || !$from.sameParent($to) || !$from.parent.inlineContent) return null
  const slice = state.doc.slice(from, to)
  let onlyText = true
  slice.content.descendants((node) => {
    if (!node.isText) onlyText = false
  })
  if (!onlyText) return null
  const text = state.doc.textBetween(from, to, '', '')
  return text || null
}

const setRuby = (reading: MdiRubyReading): Command => (state, dispatch) => {
  const type = state.schema.nodes.mdiRuby
  if (!type) return false
  const current = selectedRuby(state)
  const base = current ? String(current.attrs.base) : selectedPlainText(state)
  if (!base) return false
  if (typeof reading === 'string') {
    if (!reading) return false
  } else {
    const count = typeof Intl.Segmenter === 'function'
      ? [...new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(base)].length
      : Array.from(base).length
    if (reading.length !== count || reading.some((part) => !part)) return false
  }
  const attrs = { base, ruby: Array.isArray(reading) ? [...reading] : reading }
  let node: ProseNode
  try {
    node = type.create(attrs)
  } catch {
    return false
  }
  const { from, to } = state.selection
  let tr
  try {
    tr = state.tr.replaceWith(from, to, node)
  } catch {
    return false
  }
  if (!tr.docChanged) return false
  if (!dispatch) return true
  tr.setSelection(NodeSelection.create(tr.doc, from))
  dispatch(tr.scrollIntoView())
  return true
}

const removeRuby: Command = (state, dispatch) => {
  const node = selectedRuby(state)
  if (!node) return false
  if (!dispatch) return true
  const { from, to } = state.selection
  const tr = state.tr.replaceWith(from, to, state.schema.text(String(node.attrs.base)))
  tr.setSelection(TextSelection.create(tr.doc, from, from + String(node.attrs.base).length))
  dispatch(tr.scrollIntoView())
  return true
}

const warichuAncestor = (state: EditorState) => {
  const { $from } = state.selection
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name === 'mdiWarichu') {
      return { node: $from.node(depth), pos: $from.before(depth) }
    }
  }
  return null
}

const setWarichu: Command = (state, dispatch) => {
  const type = state.schema.nodes.mdiWarichu
  const { from, to, $from, $to } = state.selection
  if (!type || state.selection instanceof NodeSelection || warichuAncestor(state)) return false
  const ranges: Array<{ from: number; to: number }> = []
  if ($from.sameParent($to) && $from.parent.inlineContent) ranges.push({ from, to })
  else state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return
    const start = Math.max(from, pos + 1)
    const end = Math.min(to, pos + node.nodeSize - 1)
    if (start < end) ranges.push({ from: start, to: end })
    return false
  })
  if (!ranges.length || ranges.some(range => !type.validContent(state.doc.slice(range.from, range.to).content))) return false
  if (!dispatch) return true
  const tr = state.tr
  for (const range of [...ranges].reverse()) {
    tr.replaceWith(range.from, range.to, type.create(null, state.doc.slice(range.from, range.to).content))
  }
  tr.setSelection(TextSelection.create(tr.doc, ranges[0]!.from + 1, ranges.at(-1)!.to + ranges.length * 2 - 1))
  dispatch(tr.scrollIntoView())
  return true
}

const removeWarichu: Command = (state, dispatch) => {
  const targets: Array<{ node: ProseNode; pos: number }> = []
  const ancestor = warichuAncestor(state)
  if (ancestor) targets.push(ancestor)
  if (!state.selection.empty) state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
    if (node.type.name !== 'mdiWarichu') return
    if (ancestor && pos >= ancestor.pos && pos < ancestor.pos + ancestor.node.nodeSize) return false
    targets.push({ node, pos })
    return false
  })
  if (!targets.length) return false
  if (!dispatch) return true
  const tr = state.tr
  for (const { node, pos } of targets.reverse()) {
    const from = tr.mapping.map(pos)
    tr.replaceWith(from, from + node.nodeSize, node.content)
  }
  if (ancestor && targets.length === 1) {
    const endpoint = (position: number) => position > ancestor.pos && position < ancestor.pos + ancestor.node.nodeSize
      ? position - 1 : tr.mapping.map(position)
    tr.setSelection(TextSelection.create(tr.doc, endpoint(state.selection.anchor), endpoint(state.selection.head)))
  }
  dispatch(tr.scrollIntoView())
  return true
}

const setInlineMark = (mark: MdiInlineMark, value?: string): Command => (state, dispatch) => {
  if (mark === 'warichu') return setWarichu(state, dispatch)
  const type = state.schema.marks[markName(mark)]
  if (!type) return false
  if (mark === 'boten' && value !== undefined) {
    const units = typeof Intl.Segmenter === 'function'
      ? [...new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(value)]
      : Array.from(value)
    if (units.length !== 1 || /[\s\p{Cc}\p{Cf}]/u.test(value)) return false
  }
  if (mark === 'kern' && value !== undefined && !/^[+-]?\d+(?:\.\d+)?em$/.test(value)) return false
  let instance
  try {
    instance = type.create(markAttrs(mark, value))
  } catch {
    return false
  }
  const { from, to, empty } = state.selection
  if (state.selection instanceof NodeSelection) return false
  const text = empty ? '' : state.doc.textBetween(from, to, '', '')
  if (mark === 'tcy' && (!text || !/^[0-9A-Za-z!?]{1,6}$/.test(text))) return false
  if (empty && !state.selection.$from.parent.type.allowsMarkType(type)) return false
  if (!empty) {
    let hasText = false
    let allowed = true
    state.doc.nodesBetween(from, to, (node, _pos, parent) => {
      if (!node.isText) return
      hasText = true
      if (!parent?.type.allowsMarkType(type)) allowed = false
    })
    if (!hasText || !allowed) return false
  }
  if (!dispatch) return true
  const tr = empty ? state.tr.addStoredMark(instance) : state.tr.addMark(from, to, instance)
  dispatch(tr.scrollIntoView())
  return true
}

const removeInlineMark = (mark: MdiInlineMark): Command => (state, dispatch) => {
  if (mark === 'warichu') return removeWarichu(state, dispatch)
  const type = state.schema.marks[markName(mark)]
  if (!type) return false
  const { from, to, empty } = state.selection
  const active = empty
    ? Boolean(type.isInSet(state.storedMarks ?? state.selection.$from.marks()))
    : state.doc.rangeHasMark(from, to, type)
  if (!active) return false
  if (!dispatch) return true
  const tr = empty ? state.tr.removeStoredMark(type) : state.tr.removeMark(from, to, type)
  dispatch(tr.scrollIntoView())
  return true
}

const insertNode = (name: string, attrs?: Record<string, unknown>): Command => (state, dispatch) => {
  const type = state.schema.nodes[name]
  if (!type) return false
  const { $from, $to } = state.selection
  if (name === 'mdiBreak') {
    if (!$from.sameParent($to) || !$from.parent.inlineContent
      || !$from.parent.canReplaceWith($from.index(), $to.index(), type)) return false
  } else if ($from.parent.type.name !== 'paragraph' || state.selection instanceof NodeSelection) {
    return false
  }
  let node
  try {
    node = type.create(attrs)
  } catch {
    return false
  }
  let tr
  try {
    tr = state.tr.replaceSelectionWith(node)
  } catch {
    return false
  }
  if (!tr.docChanged) return false
  if (!dispatch) return true
  dispatch(tr.scrollIntoView())
  return true
}

const insertBlank: Command = (state, dispatch) => {
  const target = paragraphPosition(state)
  const type = state.schema.nodes.paragraph
  if (!target || !type || state.selection instanceof NodeSelection) return false
  const { $from, $to } = state.selection
  if (!$from.sameParent($to)) return false
  const start = $from.parentOffset
  const end = $to.parentOffset
  const contentSize = target.node.content.size
  const parts: ProseNode[] = []
  let tr
  try {
    if (start > 0) parts.push(target.node.copy(target.node.content.cut(0, start)))
    parts.push(type.create({ mdiBlank: true }))
    if (end < contentSize) parts.push(target.node.copy(target.node.content.cut(end)))
    const $parent = state.doc.resolve(target.pos)
    const index = $parent.indexAfter($parent.depth)
    if (!$parent.parent.canReplace(index, index + 1, Fragment.fromArray(parts))) return false
    tr = state.tr.replaceWith(target.pos, target.pos + target.node.nodeSize, Fragment.fromArray(parts))
  } catch {
    return false
  }
  if (!tr.docChanged) return false
  if (!dispatch) return true
  const blankIndex = start > 0 ? 1 : 0
  let blankPos = target.pos
  for (let index = 0; index < blankIndex; index += 1) blankPos += parts[index]!.nodeSize
  dispatch(tr.setSelection(TextSelection.create(tr.doc, blankPos + 1)).scrollIntoView())
  return true
}

const setParagraphLayout = (layout: 'indent' | 'bottom', value?: number): Command =>
  (state, dispatch) => {
    const target = paragraphPosition(state)
    if (!target) return false
    const normalized = layout === 'bottom' && value === undefined ? 0 : value
    if (!Number.isInteger(normalized) || normalized! < (layout === 'bottom' ? 0 : 1)) return false
    const attrs = {
      ...target.node.attrs,
      mdiIndent: layout === 'indent' ? normalized : null,
      mdiBottom: layout === 'bottom' ? normalized : null,
    }
    if (target.node.attrs.mdiIndent === attrs.mdiIndent
      && target.node.attrs.mdiBottom === attrs.mdiBottom) return false
    if (!dispatch) return true
    dispatch(state.tr.setNodeMarkup(target.pos, undefined, attrs).scrollIntoView())
    return true
  }

const clearParagraphLayout: Command = (state, dispatch) => {
  const target = paragraphPosition(state)
  if (!target || (target.node.attrs.mdiIndent === null && target.node.attrs.mdiBottom === null)) return false
  if (!dispatch) return true
  dispatch(state.tr.setNodeMarkup(target.pos, undefined, {
    ...target.node.attrs,
    mdiIndent: null,
    mdiBottom: null,
  }).scrollIntoView())
  return true
}

/** Build a ProseMirror command without exposing private schema names or attrs. */
export const mdiEditCommand = (operation: MdiEditOperation): Command => {
  switch (operation.type) {
    case 'setRuby': return setRuby(operation.reading)
    case 'removeRuby': return removeRuby
    case 'setWarichu': return setWarichu
    case 'removeWarichu': return removeWarichu
    case 'setInlineMark': return setInlineMark(operation.mark, operation.value)
    case 'removeInlineMark': return removeInlineMark(operation.mark)
    case 'insertBreak': return insertNode('mdiBreak')
    case 'insertBlank': return insertBlank
    case 'insertPagebreak': return insertNode('mdiPagebreak', { variant: operation.variant ?? null })
    case 'setParagraphLayout': return setParagraphLayout(operation.layout, operation.value)
    case 'clearParagraphLayout': return clearParagraphLayout
  }
}

export const canApplyMdiEdit = (state: EditorState, operation: MdiEditOperation) =>
  mdiEditCommand(operation)(state)

export const inspectMdiSelection = (state: EditorState): MdiSelectionState => {
  const ruby = selectedRuby(state)
  const marks = state.storedMarks ?? state.selection.$from.marks()
  const active: MdiSelectionState['marks'] = {}
  for (const mark of ['tcy', 'boten', 'noBreak', 'warichu', 'kern'] as const) {
    const instance = state.schema.marks[markName(mark)]?.isInSet(marks)
    if (instance) active[mark] = mark === 'boten'
      ? String(instance.attrs.mark)
      : mark === 'kern' ? String(instance.attrs.amount) : true
  }
  if (warichuAncestor(state)) active.warichu = true
  const paragraph = paragraphPosition(state)?.node
  const paragraphLayout = typeof paragraph?.attrs.mdiIndent === 'number'
    ? { layout: 'indent' as const, value: paragraph.attrs.mdiIndent as number }
    : typeof paragraph?.attrs.mdiBottom === 'number'
      ? { layout: 'bottom' as const, value: paragraph.attrs.mdiBottom as number }
      : null
  return {
    ruby: ruby ? { base: String(ruby.attrs.base), reading: ruby.attrs.ruby as string | string[] } : null,
    marks: active,
    paragraphLayout,
  }
}
