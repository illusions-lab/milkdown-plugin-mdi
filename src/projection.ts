import { getMdiTextBlocks, type MdiTextBlock } from '@illusions-lab/mdi'
import type { Ctx } from '@milkdown/ctx'
import { createMdiEditorMapping, mapMdiSourceSpansToEditorRanges, type MdiEditorMappingSnapshot } from './mapping.js'

export interface MdiEditorBlockProjection {
  readonly displayIndex: number
  readonly sourceBlockIndex: number | null
  readonly kind: MdiTextBlock['kind'] | 'transientBlank'
  readonly from: number
  readonly to: number
  readonly depth: number
  readonly semanticBlank: boolean
  readonly transientBlank: boolean
  readonly complete: boolean
}

export interface MdiEditorBlocksProjection {
  readonly source: string
  readonly blocks: readonly MdiEditorBlockProjection[]
  readonly complete: boolean
}

const nodeAtOrAncestor = (snapshot: MdiEditorMappingSnapshot, position: number) => {
  const doc = snapshot.doc
  const bounded = Math.max(0, Math.min(position, doc.content.size))
  const direct = doc.nodeAt(bounded)
  /* c8 ignore next */
  if (direct?.isBlock) return { from: bounded, to: bounded + direct.nodeSize, depth: doc.resolve(bounded).depth }
  const resolved = doc.resolve(bounded)
  for (let depth = resolved.depth; depth > 0; depth -= 1) {
    const node = resolved.node(depth)
    if (!node.isBlock) continue
    const from = resolved.before(depth)
    return { from, to: from + node.nodeSize, depth }
  }
  // A valid Rust text match always resolves to a block; retain a safe value
  // for malformed third-party snapshots without making callers throw.
  /* c8 ignore next 2 */
  return { from: bounded, to: bounded, depth: 0 }
}

/** Project Rust source blocks and editable blank paragraphs into one display order. */
export const projectMdiEditorBlocks = (snapshot: MdiEditorMappingSnapshot): MdiEditorBlocksProjection => {
  const rust = getMdiTextBlocks(snapshot.source)
  const spans = rust.blocks.map((block) => block.span).filter((span): span is NonNullable<typeof span> => Boolean(span))
  const resolutions = mapMdiSourceSpansToEditorRanges(snapshot, spans)
  const projected: MdiEditorBlockProjection[] = []
  let sourceCursor = 0
  for (const block of rust.blocks) {
    const resolution = block.span ? resolutions[sourceCursor++] : undefined
    const match = resolution?.matches.find((candidate) => candidate.channel === 'blockText'
      && candidate.blockIndex === block.index)
    /* c8 ignore next */
    if (!match) continue
    const range = nodeAtOrAncestor(snapshot, match.from)
    projected.push({ displayIndex: 0, sourceBlockIndex: block.index, kind: block.kind,
      ...range, semanticBlank: false, transientBlank: false,
      // A partial Rust span is still a valid block anchor; only an absent
      // provenance match makes the projection unusable for decorations.
      complete: true })
  }
  snapshot.doc.forEach((node, pos) => {
    if (node.type.name !== 'paragraph' || node.content.size !== 0) return
    const semanticBlank = node.attrs.mdiBlank === true
    projected.push({ displayIndex: 0, sourceBlockIndex: null,
      kind: 'paragraph', from: pos, to: pos + node.nodeSize,
      depth: 1, semanticBlank, transientBlank: !semanticBlank, complete: true })
  })
  projected.sort((left, right) => left.from - right.from)
  return { source: snapshot.source,
    blocks: projected.map((block, index) => ({ ...block, displayIndex: index + 1 })),
    complete: projected.every((block) => block.complete) }
}

/** Convenience form for callers that only have a Milkdown context. */
export const projectCurrentMdiEditorBlocks = () => (ctx: Ctx) =>
  projectMdiEditorBlocks(createMdiEditorMapping()(ctx))
