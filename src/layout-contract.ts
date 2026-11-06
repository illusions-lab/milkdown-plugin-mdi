import type { Node } from '@milkdown/prose/model'
import { type Command, type Transaction } from '@milkdown/prose/state'

export type MdiDocumentIssueCode = 'layout-context' | 'layout-conflict' | 'layout-value' | 'layout-empty'
export interface MdiDocumentIssue { code: MdiDocumentIssueCode; pos: number }
export const validMdiLayoutValue = (layout: 'indent' | 'bottom', value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= (layout === 'indent' ? 1 : 0) && value <= 4294967295

// Immutable ProseMirror subtrees can be shared across transactions. Cache relative
// positions separately for root children and nested nodes (context is significant).
const caches = [new WeakMap<Node, readonly MdiDocumentIssue[]>(), new WeakMap<Node, readonly MdiDocumentIssue[]>()]
const inspect = (node: Node, nested: boolean): readonly MdiDocumentIssue[] => {
  const cache = caches[Number(nested)]!
  const cached = cache.get(node)
  if (cached) return cached
  const issues: MdiDocumentIssue[] = []
  if (node.type.name === 'paragraph') {
    const { mdiIndent: indent, mdiBottom: bottom } = node.attrs
    if (indent != null || bottom != null) {
      if (nested) issues.push({ code: 'layout-context', pos: 0 })
      if (indent != null && bottom != null) issues.push({ code: 'layout-conflict', pos: 0 })
      if ((indent != null && !validMdiLayoutValue('indent', indent)) || (bottom != null && !validMdiLayoutValue('bottom', bottom))) issues.push({ code: 'layout-value', pos: 0 })
      if (!node.content.size) issues.push({ code: 'layout-empty', pos: 0 })
    }
  }
  node.forEach((child, offset) => {
    for (const issue of inspect(child, true)) issues.push({ ...issue, pos: offset + 1 + issue.pos })
  })
  cache.set(node, issues)
  return issues
}
export const inspectMdiDocument = (doc: Node): MdiDocumentIssue[] => {
  const issues: MdiDocumentIssue[] = []
  doc.forEach((child, offset) => {
    for (const issue of inspect(child, false)) issues.push({ ...issue, pos: offset + issue.pos })
  })
  return issues
}
export class MdiDocumentValidationError extends Error {
  readonly issues: readonly MdiDocumentIssue[]
  constructor(issues: readonly MdiDocumentIssue[]) {
    super('Document contains paragraph layout that MDI cannot represent')
    this.name = 'MdiDocumentValidationError'
    this.issues = issues
  }
}
export const assertMdiDocument = (doc: Node) => {
  const issues = inspectMdiDocument(doc)
  if (issues.length) throw new MdiDocumentValidationError(issues)
}
const layoutNotWorse = (before: Node, after: Node) =>
  (['indent', 'bottom'] as const).every(layout => {
    const key = layout === 'indent' ? 'mdiIndent' : 'mdiBottom'
    const a: unknown = before.attrs[key], b: unknown = after.attrs[key]
    return b == null || (a != null && (a === b || (!validMdiLayoutValue(layout, a) && validMdiLayoutValue(layout, b))))
  })

export const allowsMdiTransaction = (tr: Transaction, before: Node): boolean => {
  if (!tr.docChanged) return true
  const old = inspectMdiDocument(before)
  return inspectMdiDocument(tr.doc).every(issue => {
    // Deleting the content of an already laid-out paragraph remains editable.
    if (issue.code === 'layout-empty') {
      const previous = tr.mapping.invert().map(issue.pos, 1)
      const node = before.nodeAt(previous)
      const next = tr.doc.nodeAt(issue.pos)
      if (tr.mapping.map(previous, 1) === issue.pos && node?.type.name === 'paragraph' && next && node.attrs.mdiIndent === next.attrs.mdiIndent
        && node.attrs.mdiBottom === next.attrs.mdiBottom) return true
    }
    return old.some(prior => {
      if (prior.code !== issue.code || tr.mapping.map(prior.pos, 1) !== issue.pos) return false
      if (issue.code === 'layout-context' && tr.doc.resolve(issue.pos).depth > before.resolve(prior.pos).depth) return false
      const a = before.nodeAt(prior.pos), b = tr.doc.nodeAt(issue.pos)
      return a && b && layoutNotWorse(a, b)
    })
  })
}
/** Commands must follow the standard single-dispatch ProseMirror command contract. */
export const guardMdiCommand = (command: Command): Command => (state, dispatch, view) => {
  let candidate: Transaction | undefined
  const result = command(state, tr => { candidate = tr }, view)
  if (!result || (candidate && !allowsMdiTransaction(candidate, state.doc))) return false
  if (candidate && dispatch) dispatch(candidate)
  return result
}
