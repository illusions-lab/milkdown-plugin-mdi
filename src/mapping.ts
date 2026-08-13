import {
  getMdiTextBlocks,
  formatMdiTextPosition,
  parseMdiTextPosition,
  resolveMdiSourceSpan,
  sourceSpansForTextRange,
  type MdiSourceSpan,
  type MdiSourceSpanCoverage,
  type MdiTextBlock,
  type MdiTextRange,
} from '@illusions-lab/mdi'
import type { Ctx } from '@milkdown/ctx'
import { editorStateCtx } from '@milkdown/core'
import type { Node as ProseNode } from '@milkdown/prose/model'
import { getMdi } from './index.js'

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

interface EditorBlock {
  text: string
  boundaries: Array<number | undefined>
}

/** An immutable association between one canonical MDI source and one PM doc. */
export interface MdiEditorMappingSnapshot {
  readonly source: string
  readonly doc: ProseNode
  readonly projectionVersion: '1.0'
}

const snapshotProjection = new WeakMap<MdiEditorMappingSnapshot, MdiTextBlock[]>()
const snapshotEditorBlocks = new WeakMap<MdiEditorMappingSnapshot, ReadonlyMap<number, EditorBlock>>()

const graphemeSegments = (value: string) => {
  if (typeof Intl.Segmenter === 'function') {
    return [...new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(value)]
  }
  let index = 0
  return Array.from(value, (segment) => {
    const result = { segment, index }
    index += segment.length
    return result
  })
}

const appendText = (target: EditorBlock, value: string, from: number, atomTo?: number) => {
  for (const { segment, index } of graphemeSegments(value)) {
    target.text += segment
    target.boundaries.push(atomTo ?? from + index + segment.length)
  }
}

const inlineProjection = (node: ProseNode, start: number): EditorBlock => {
  const result: EditorBlock = { text: '', boundaries: [start] }
  node.descendants((child, pos) => {
    const absolute = start + pos
    if (child.isText) {
      appendText(result, child.text ?? '', absolute)
      return false
    }
    if (child.type.name === 'mdiRuby') {
      appendText(result, String(child.attrs.base), absolute, absolute + child.nodeSize)
      return false
    }
    if (child.type.name === 'mdiBreak' || child.type.name === 'hardbreak') {
      appendText(result, '\n', absolute, absolute + child.nodeSize)
      return false
    }
    if (child.type.name === 'image') {
      appendText(result, String(child.attrs.alt ?? ''), absolute, absolute + child.nodeSize)
      return false
    }
    return true
  })
  return result
}

const appendBlock = (target: EditorBlock, block: EditorBlock) => {
  if (!block.text) return
  if (target.text) {
    target.text += '\n'
    target.boundaries.push(block.boundaries[0] ?? target.boundaries.at(-1) ?? 0)
  }
  target.text += block.text
  target.boundaries.push(...block.boundaries.slice(1))
}

const containerProjection = (node: ProseNode, start: number, skipNestedLists = false) => {
  const result: EditorBlock = { text: '', boundaries: [start] }
  node.forEach((child, offset) => {
    if (skipNestedLists && (child.type.name === 'bullet_list' || child.type.name === 'ordered_list')) return
    if (child.type.name === 'paragraph' || child.type.name === 'heading' || child.type.name === 'code_block') {
      appendBlock(result, inlineProjection(child, start + offset + 1))
    } else if (!child.isLeaf) {
      appendBlock(result, containerProjection(child, start + offset + 1, skipNestedLists))
    }
  })
  return result
}

const editorBlocks = (doc: ProseNode): EditorBlock[] => {
  const blocks: EditorBlock[] = []
  const visit = (node: ProseNode, start: number, insideOwnedContainer = false) => {
    node.forEach((child, offset) => {
      const pos = start + offset
      const name = child.type.name
      if (name === 'blockquote') {
        blocks.push(containerProjection(child, pos + 1))
        visit(child, pos + 1, true)
        return
      }
      if (name === 'list_item') {
        blocks.push(containerProjection(child, pos + 1, true))
        visit(child, pos + 1, true)
        return
      }
      if (!insideOwnedContainer && (name === 'heading' || name === 'paragraph' || name === 'code_block')) {
        blocks.push(inlineProjection(child, pos + 1))
      }
      if (!child.isLeaf) visit(child, pos + 1, insideOwnedContainer)
    })
  }
  visit(doc, 0)
  return blocks
}

const utf8Slice = (source: string, from: number, to: number) => new TextDecoder().decode(
  new TextEncoder().encode(source).subarray(from, to),
)

const literalProjection = (source: string, block: MdiTextBlock, candidate: EditorBlock): EditorBlock | null => {
  if (!block.span) return null
  const literal = utf8Slice(source, block.span.startByte, block.span.endByte)
  const exactLiteral = literal === candidate.text || literal.trimEnd() === candidate.text
  if (!exactLiteral && !['table', 'footnote', 'html', 'other'].includes(block.kind)) return null
  const start = candidate.boundaries[0]
  if (start === undefined) return null
  const boundaries: Array<number | undefined> = Array(graphemeSegments(block.text).length + 1)
  let candidateCursor = 0
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const spans = sourceSpansForTextRange(block, {
      start: formatMdiTextPosition({ block: block.index, character: index + 1 }),
      end: formatMdiTextPosition({ block: block.index, character: index + 2 }),
    })
    if (spans.length !== 1) continue
    const [span] = spans
    if (exactLiteral) {
      boundaries[index] = start + utf8Slice(source, block.span.startByte, span!.startByte).length
      boundaries[index + 1] = start + utf8Slice(source, block.span.startByte, span!.endByte).length
      continue
    }
    const segment = graphemeSegments(block.text)[index]?.segment
    if (!segment) continue
    const found = candidate.text.indexOf(segment, candidateCursor)
    if (found < 0) return null
    boundaries[index] = start + found
    boundaries[index + 1] = start + found + segment.length
    candidateCursor = found + segment.length
  }
  return { text: block.text, boundaries }
}

const associateBlocks = (source: string, sourceBlocks: MdiTextBlock[], candidates: EditorBlock[]) => {
  const result = new Map<number, EditorBlock>()
  let cursor = 0
  for (const block of sourceBlocks) {
    for (let index = cursor; index < candidates.length; index += 1) {
      const candidate = candidates[index]
      if (!candidate) continue
      const associated = candidate.text === block.text ? candidate : literalProjection(source, block, candidate)
      if (!associated) continue
      result.set(block.index, associated)
      cursor = index + 1
      break
    }
  }
  return result
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
  snapshotProjection.set(snapshot, projection.blocks)
  snapshotEditorBlocks.set(snapshot, associateBlocks(source, projection.blocks, editorBlocks(state.doc)))
  return snapshot
}

export const isCurrentMdiEditorMapping = (snapshot: MdiEditorMappingSnapshot) =>
  (ctx: Ctx) => snapshot.doc.eq(ctx.get(editorStateCtx).doc) && snapshot.source === getMdi()(ctx)

const mapTextRange = (block: EditorBlock | undefined, range: MdiTextRange): MdiEditorRange | null => {
  if (!block) return null
  const start = parseMdiTextPosition(range.start).character - 1
  const end = parseMdiTextPosition(range.end).character - 1
  const from = block.boundaries[start]
  const to = block.boundaries[end]
  return from === undefined || to === undefined ? null : { from, to }
}

export const mapMdiSourceSpanToEditorRanges = (
  snapshot: MdiEditorMappingSnapshot,
  span: MdiSourceSpan,
  current?: { source: string; doc: ProseNode },
): MdiEditorRangeResolution => {
  if (current && (current.source !== snapshot.source || !current.doc.eq(snapshot.doc))) {
    return { coverage: 'none', matches: [], reason: 'stale' }
  }
  const resolution = resolveMdiSourceSpan(snapshot.source, span)
  const matches = resolution.matches.flatMap((match): MdiEditorRangeMatch[] => {
    const range = mapTextRange(snapshotEditorBlocks.get(snapshot)?.get(match.blockIndex), match.kind === 'annotation'
      ? snapshotProjection.get(snapshot)?.[match.blockIndex - 1]?.annotations[match.annotationIndex]?.anchor ?? match.range
      : match.range)
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
}

/** Map only when the snapshot still belongs to the editor's exact current state. */
export const mapMdiSourceSpanToCurrentEditorRanges = (
  snapshot: MdiEditorMappingSnapshot,
  span: MdiSourceSpan,
) => (ctx: Ctx): MdiEditorRangeResolution => mapMdiSourceSpanToEditorRanges(snapshot, span, {
  source: getMdi()(ctx),
  doc: ctx.get(editorStateCtx).doc,
})

export const mapMdiSourceSpanToEditorRange = (
  snapshot: MdiEditorMappingSnapshot,
  span: MdiSourceSpan,
): MdiEditorRange | null => {
  const matches = mapMdiSourceSpanToEditorRanges(snapshot, span).matches
  return matches.length === 1 ? { from: matches[0]!.from, to: matches[0]!.to } : null
}
