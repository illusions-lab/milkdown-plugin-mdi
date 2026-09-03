import {
  getMdiTextBlocks,
  parseMdiTextPosition,
  resolveMdiSourceSpans,
  type MdiSourceSpan,
  type MdiSourceSpanCoverage,
  type MdiTextRange,
} from '@illusions-lab/mdi'
import type { Ctx } from '@milkdown/ctx'
import { editorStateCtx, parserCtx } from '@milkdown/core'
import type { Node as ProseNode } from '@milkdown/prose/model'
import type { EditorState } from '@milkdown/prose/state'
import { getMdi } from './index.js'
import { getMdiDocumentProvenance, type MdiProvenanceRange } from './provenance.js'

export interface MdiEditorRange {
  from: number
  to: number
}

export interface MdiEditorRangeMatch extends MdiEditorRange {
  blockIndex: number
  channel: 'blockText' | 'annotation'
  annotationIndex?: number
  relation: 'exact' | 'overlap'
}

export interface MdiEditorRangeResolution {
  coverage: MdiSourceSpanCoverage
  matches: MdiEditorRangeMatch[]
  reason?: 'stale' | 'unmapped'
}

/** An immutable association between one canonical MDI source and one PM doc. */
export interface MdiEditorMappingSnapshot {
  readonly source: string
  readonly doc: ProseNode
  readonly projectionVersion: '1.0'
}

const snapshotRanges = new WeakMap<MdiEditorMappingSnapshot, readonly MdiProvenanceRange[]>()
const snapshotStates = new WeakMap<MdiEditorMappingSnapshot, EditorState>()

const sameEditorShape = (left: ProseNode, right: ProseNode): boolean => {
  if (left.type !== right.type || left.nodeSize !== right.nodeSize || left.childCount !== right.childCount) return false
  for (let index = 0; index < left.childCount; index += 1) {
    const leftChild = left.child(index)
    const rightChild = right.child(index)
    if (!sameEditorShape(leftChild, rightChild)) return false
  }
  return true
}

const isTransientEmptyParagraph = (node: ProseNode) =>
  node.type.name === 'paragraph' && node.childCount === 0

/**
 * Milkdown can retain an empty paragraph at the end of a block paste even
 * though its serializer emits only a trailing newline and the canonical parser
 * drops that paragraph again.
 *
 * Source-backed children must remain an exact canonical prefix. Only additional
 * empty paragraphs at the live document tail are accepted, and no provenance
 * is assigned to them.
 */
const hasCanonicalEditorShape = (
  canonicalDoc: ProseNode,
  editorDoc: ProseNode,
): boolean => {
  if (canonicalDoc.type !== editorDoc.type
    || canonicalDoc.childCount > editorDoc.childCount) return false
  for (let index = 0; index < canonicalDoc.childCount; index += 1) {
    if (!sameEditorShape(canonicalDoc.child(index), editorDoc.child(index))) return false
  }
  for (let index = canonicalDoc.childCount; index < editorDoc.childCount; index += 1) {
    if (!isTransientEmptyParagraph(editorDoc.child(index))) return false
  }
  return true
}

const mappedRanges = (
  ranges: readonly MdiProvenanceRange[],
  match: { blockIndex: number; kind: 'blockText' | 'annotation'; annotationIndex?: number; range: MdiTextRange },
) => {
  const targetStart = parseMdiTextPosition(match.range.start).character
  const targetEnd = parseMdiTextPosition(match.range.end).character
  const candidates = ranges.filter(({ target, targetOffsetStart, targetOffsetEnd }) => {
    if (target.blockIndex !== match.blockIndex
      || target.channel !== match.kind
      || match.kind === 'annotation' && (target.channel !== 'annotation'
        || target.annotationIndex !== match.annotationIndex)) return false
    const base = parseMdiTextPosition(target.range.start).character
    const start = base + targetOffsetStart
    const end = base + targetOffsetEnd
    return targetStart === targetEnd
      ? start <= targetStart && targetStart <= end
      : start < targetEnd && targetStart < end
  })
  const precise = candidates.filter(({ graphemeOffsets }) => graphemeOffsets)
  return (precise.length ? precise : candidates)
    .sort((left, right) => {
      const leftStart = parseMdiTextPosition(left.target.range.start).character + left.targetOffsetStart
      const rightStart = parseMdiTextPosition(right.target.range.start).character + right.targetOffsetStart
      return leftStart - rightStart
    })
}

const editorRangeForMatch = (ranges: readonly MdiProvenanceRange[], matchRange: MdiTextRange): MdiEditorRange | null => {
  const first = ranges[0]
  const last = ranges.at(-1)
  if (!first || !last) return null
  const firstStart = parseMdiTextPosition(first.target.range.start).character + first.targetOffsetStart
  const lastStart = parseMdiTextPosition(last.target.range.start).character + last.targetOffsetStart
  const matchStart = parseMdiTextPosition(matchRange.start).character
  const matchEnd = parseMdiTextPosition(matchRange.end).character
  const startOffset = first.graphemeOffsets?.[Math.max(0, matchStart - firstStart)]
  const endOffset = last.graphemeOffsets?.[
    Math.min(last.targetOffsetEnd - last.targetOffsetStart, matchEnd - lastStart)
  ]
  return {
    from: startOffset === undefined ? first.from : first.from + startOffset,
    to: endOffset === undefined ? last.to : last.from + endOffset,
  }
}

export const createMdiEditorMapping = () => (ctx: Ctx): MdiEditorMappingSnapshot => {
  const state = ctx.get(editorStateCtx)
  const source = getMdi()(ctx)
  const projection = getMdiTextBlocks(source)
  const snapshot: MdiEditorMappingSnapshot = Object.freeze({
    source,
    doc: state.doc,
    projectionVersion: projection.projectionVersion,
  })
  // The initial Milkdown value may be non-canonical. Rebuild only the bridge
  // document from the snapshot's canonical source so Rust block indices and
  // provenance targets belong to the exact source exposed by this API.
  const canonicalDoc = ctx.get(parserCtx)(source)
  snapshotRanges.set(snapshot, hasCanonicalEditorShape(canonicalDoc, state.doc)
    ? getMdiDocumentProvenance(canonicalDoc) ?? []
    : [])
  snapshotStates.set(snapshot, state)
  return snapshot
}

export const isCurrentMdiEditorMapping = (snapshot: MdiEditorMappingSnapshot) =>
  (ctx: Ctx) => snapshotStates.get(snapshot) === ctx.get(editorStateCtx)
    && snapshot.source === getMdi()(ctx)

/**
 * Resolve all spans in one Rust parse/projection, then join results only to
 * ranges captured from matching Rust mdast provenance during document build.
 */
export const mapMdiSourceSpansToEditorRanges = (
  snapshot: MdiEditorMappingSnapshot,
  spans: readonly MdiSourceSpan[],
  current?: { source: string; doc: ProseNode },
): MdiEditorRangeResolution[] => {
  if (current && (current.source !== snapshot.source || !current.doc.eq(snapshot.doc))) {
    return spans.map(() => ({ coverage: 'none', matches: [], reason: 'stale' as const }))
  }
  const ranges = snapshotRanges.get(snapshot) ?? []
  return resolveMdiSourceSpans(snapshot.source, spans).map((resolution) => {
    const matches = resolution.matches.flatMap((match): MdiEditorRangeMatch[] => {
      const provenanceRanges = mappedRanges(ranges, match)
      const range = editorRangeForMatch(provenanceRanges, match.range)
      return range ? [{
        ...range,
        blockIndex: match.blockIndex,
        channel: match.kind,
        ...(match.kind === 'annotation' ? { annotationIndex: match.annotationIndex } : {}),
        relation: match.relation,
      }] : []
    })
    return {
      coverage: resolution.coverage,
      matches,
      ...(matches.length ? {} : { reason: 'unmapped' as const }),
    }
  })
}

export const mapMdiSourceSpanToEditorRanges = (
  snapshot: MdiEditorMappingSnapshot,
  span: MdiSourceSpan,
  current?: { source: string; doc: ProseNode },
): MdiEditorRangeResolution => mapMdiSourceSpansToEditorRanges(snapshot, [span], current)[0]!

/** Map only when the snapshot still belongs to the editor's exact current state. */
export const mapMdiSourceSpanToCurrentEditorRanges = (
  snapshot: MdiEditorMappingSnapshot,
  span: MdiSourceSpan,
) => (ctx: Ctx): MdiEditorRangeResolution => isCurrentMdiEditorMapping(snapshot)(ctx)
  ? mapMdiSourceSpanToEditorRanges(snapshot, span)
  : { coverage: 'none', matches: [], reason: 'stale' }

export const mapMdiSourceSpanToEditorRange = (
  snapshot: MdiEditorMappingSnapshot,
  span: MdiSourceSpan,
): MdiEditorRange | null => {
  const matches = mapMdiSourceSpanToEditorRanges(snapshot, span).matches
  return matches.length === 1 ? { from: matches[0]!.from, to: matches[0]!.to } : null
}
