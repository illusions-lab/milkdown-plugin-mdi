import type { Ctx } from '@milkdown/ctx'
import { parserCtx, remarkCtx, schemaCtx } from '@milkdown/core'
import { type Node as ProseNode } from '@milkdown/prose/model'
import { ParserState, type MarkdownNode } from '@milkdown/transformer'
import { parseMdiTextPosition } from '@illusions-lab/mdi'
import type { MdiMdastProvenance, MdiMdastProvenanceTarget } from '@illusions-lab/mdi-remark'

export interface MdiProvenanceRange {
  target: MdiMdastProvenanceTarget
  from: number
  to: number
  /** UTF-16 offsets for direct text emitted by this exact parse operation. */
  graphemeOffsets?: readonly number[]
  targetOffsetStart: number
  targetOffsetEnd: number
}

export interface MdiBridgeSegment {
  provenance: MdiMdastProvenance
  from: number
  to: number
  startCharacter?: number
  endCharacter?: number
}

export interface MdiBridgeData {
  [key: string]: unknown
  mdiProvenance?: MdiMdastProvenance
  mdiBridgeSegment?: Pick<MdiBridgeSegment, 'startCharacter' | 'endCharacter'>
  mdiBridgeSegments?: MdiBridgeSegment[]
}

interface PendingProvenanceRange {
  node: ProseNode
  target: MdiMdastProvenanceTarget
  from: number
  to: number
  graphemeOffsets?: readonly number[]
  targetOffsetStart: number
  targetOffsetEnd: number
}

const documentProvenance = new WeakMap<ProseNode, readonly MdiProvenanceRange[]>()

interface ProvenanceNode extends MarkdownNode {
  data?: MdiBridgeData
}

const provenanceOf = (node: MarkdownNode): MdiMdastProvenance | undefined =>
  (node as ProvenanceNode).data?.mdiProvenance

const bridgeDataOf = (node: MarkdownNode): MdiBridgeData | undefined =>
  (node as ProvenanceNode).data

const currentNode = (state: ParserState) => state.top()?.content.at(-1)

const graphemeOffsets = (text: string) => {
  if (typeof Intl.Segmenter === 'function') {
    return [...new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(text)]
      .map(({ index }) => index).concat(text.length)
  }
  let offset = 0
  return Array.from(text, (value) => {
    const current = offset
    offset += value.length
    return current
  }).concat(text.length)
}

/**
 * Replace Milkdown's parser with the same schema parser plus a transient
 * Rust-provenance recorder. Associations are captured at node construction;
 * no editor text, document order, or source-map reconstruction is involved.
 */
export const installMdiProvenanceParser = (ctx: Ctx) => {
  const schema = ctx.get(schemaCtx)
  const remark = ctx.get(remarkCtx)
  ctx.set(parserCtx, (source: string) => {
    const state = new ParserState(schema)
    const ranges: PendingProvenanceRange[] = []
    const recordedTargetSegments = new WeakMap<MdiMdastProvenanceTarget, Set<string>>()
    let active: MdiMdastProvenance | undefined
    let activeBridgeData: MdiBridgeData | undefined
    const pendingNodes: Array<MdiMdastProvenance | undefined> = []
    const next = state.next.bind(state)
    const openNode = state.openNode.bind(state)
    const closeNode = state.closeNode.bind(state)
    const addNode = state.addNode.bind(state)
    const addText = state.addText.bind(state)

    const recordOne = (
      node: ProseNode,
      provenance: MdiMdastProvenance,
      from: number,
      to: number,
      startCharacter = 0,
      endCharacter?: number,
    ) => {
      if (provenance.role !== 'textBearing' || provenance.status !== 'sourceBacked') return
      for (const target of provenance.targets) {
        const targetStart = parseMdiTextPosition(target.range.start).character
        const targetEnd = parseMdiTextPosition(target.range.end).character
        const length = targetEnd - targetStart
        const targetOffsetEnd = endCharacter ?? length
        const segmentKey = `${startCharacter}:${targetOffsetEnd}`
        const recorded = recordedTargetSegments.get(target) ?? new Set<string>()
        // Some Milkdown runners wrap one leaf construction in a generated
        // paragraph. The same exact Rust target segment is recorded at the
        // first (most direct) construction only; split segments remain distinct.
        if (recorded.has(segmentKey)) continue
        recorded.add(segmentKey)
        recordedTargetSegments.set(target, recorded)
        ranges.push({
          node,
          target,
          from,
          to,
          targetOffsetStart: startCharacter,
          targetOffsetEnd,
          ...(node.isText ? { graphemeOffsets: graphemeOffsets((node.text ?? '').slice(from, to)) } : {}),
        })
      }
    }

    const record = (node: ProseNode | undefined, provenance = active, from = 0, to?: number) => {
      if (!node) return
      const bridgeSegments = activeBridgeData?.mdiBridgeSegments
      if (bridgeSegments?.length) {
        for (const segment of bridgeSegments) {
          recordOne(node, segment.provenance, from + segment.from, from + segment.to,
            segment.startCharacter, segment.endCharacter)
        }
        return
      }
      if (!provenance) return
      const segment = activeBridgeData?.mdiBridgeSegment
      recordOne(node, provenance, from, to ?? node.nodeSize,
        segment?.startCharacter, segment?.endCharacter)
    }

    state.next = (nodes: MarkdownNode | MarkdownNode[] = []) => {
      for (const node of [nodes].flat()) {
        const previous = active
        const previousBridgeData = activeBridgeData
        active = provenanceOf(node)
        activeBridgeData = bridgeDataOf(node)
        next(node)
        active = previous
        activeBridgeData = previousBridgeData
      }
      return state
    }
    state.openNode = (type, attrs) => {
      pendingNodes.push(active)
      return openNode(type, attrs)
    }
    state.closeNode = () => {
      const provenance = pendingNodes.pop()
      closeNode()
      record(currentNode(state), provenance)
      return state
    }
    state.addNode = (type, attrs, content) => {
      addNode(type, attrs, content)
      record(currentNode(state))
      return state
    }
    state.addText = (text) => {
      addText(text)
      const node = currentNode(state)
      // ParserState may merge adjacent text with equal marks. This offset is
      // obtained from the node just constructed, never from source text.
      record(node, active, (node?.text?.length ?? text.length) - text.length, node?.text?.length)
      return state
    }

    const tree = remark.runSync(remark.parse(source), source) as MarkdownNode
    state.next(tree)
    const doc = state.toDoc()
    const positions = new Map<ProseNode, number>()
    // This is an identity lookup over nodes produced by the parse bridge, not
    // an association based on node text, schema names, or source order.
    doc.descendants((node, pos) => { positions.set(node, pos) })
    documentProvenance.set(doc, ranges.flatMap(({
      node, target, from, to, graphemeOffsets, targetOffsetStart, targetOffsetEnd,
    }) => {
      const start = positions.get(node)
      return start === undefined ? [] : [{
        target,
        from: start + from,
        to: start + to,
        graphemeOffsets,
        targetOffsetStart,
        targetOffsetEnd,
      }]
    }))
    return doc
  })
}

export const getMdiDocumentProvenance = (doc: ProseNode) => documentProvenance.get(doc)
