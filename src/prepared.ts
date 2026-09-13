import { MDI_COMMENT_IR_VERSION, type MdiDiagnostic } from '@illusions-lab/mdi'
import {
  MDI_MDAST_PROVENANCE_VERSION,
  parseForMdast,
  type MdiMdastDocument,
  type MdiMdastNode,
} from '@illusions-lab/mdi/internal/mdast'
import { canonicalizeMdiPreservingLiteralText } from './literal-text.js'

export const PREPARED_MDI_DOCUMENT_VERSION = 2 as const

/** Check the wire contract before consuming a prepared tree from another runtime. */
export const hasCompatiblePreparedMdiDocumentVersions = (value: {
  version?: unknown
  mdiIrVersion?: unknown
  provenanceVersion?: unknown
}): boolean => value.version === PREPARED_MDI_DOCUMENT_VERSION
  && value.mdiIrVersion === MDI_COMMENT_IR_VERSION
  && value.provenanceVersion === MDI_MDAST_PROVENANCE_VERSION

export interface StructuredCloneSafeMdast {
  type: string
  value?: string
  children?: StructuredCloneSafeMdast[]
  data?: Record<string, unknown>
  position?: {
    start: { line: number; column: number; offset: number }
    end: { line: number; column: number; offset: number }
  }
  [key: string]: unknown
}

export interface PreparedMdiDocument {
  version: typeof PREPARED_MDI_DOCUMENT_VERSION
  mdiIrVersion: string
  provenanceVersion: string
  canonicalSource: string
  document: StructuredCloneSafeMdast
  frontmatter?: string
  diagnostics: readonly MdiDiagnostic[]
  stats: {
    sourceUtf16Length: number
    sourceBytes: number
    blockCount: number
  }
}

export class IncompatiblePreparedMdiDocumentError extends Error {
  constructor(field: string, expected: string | number, received: unknown) {
    super(
      `Incompatible prepared MDI document: ${field} must be ${String(expected)}, received ${String(received)}`,
    )
    this.name = 'IncompatiblePreparedMdiDocumentError'
  }
}

export const assertCompatiblePreparedMdiDocument = (
  prepared: PreparedMdiDocument,
): PreparedMdiDocument => {
  if (prepared.version !== PREPARED_MDI_DOCUMENT_VERSION) {
    throw new IncompatiblePreparedMdiDocumentError(
      'version',
      PREPARED_MDI_DOCUMENT_VERSION,
      prepared.version,
    )
  }
  if (prepared.mdiIrVersion !== MDI_COMMENT_IR_VERSION) {
    throw new IncompatiblePreparedMdiDocumentError(
      'mdiIrVersion',
      MDI_COMMENT_IR_VERSION,
      prepared.mdiIrVersion,
    )
  }
  if (prepared.provenanceVersion !== MDI_MDAST_PROVENANCE_VERSION) {
    throw new IncompatiblePreparedMdiDocumentError(
      'provenanceVersion',
      MDI_MDAST_PROVENANCE_VERSION,
      prepared.provenanceVersion,
    )
  }
  if (!prepared.document || prepared.document.type !== 'root') {
    throw new TypeError('Incompatible prepared MDI document: document must be an mdast root')
  }
  return prepared
}

interface SourceOffsets {
  slice: (fromByte: number, toByte: number) => string
  utf16At: (byte: number) => number
}

const provenanceOf = (node: StructuredCloneSafeMdast) =>
  node.data?.mdiProvenance as
    | {
        span?: { startByte: number; endByte: number } | null
        role?: string
        status?: string
        targets?: unknown[]
      }
    | undefined

const sourceOffsets = (tree: StructuredCloneSafeMdast, source: string): SourceOffsets => {
  const requested = new Set([0])
  const collect = (node: StructuredCloneSafeMdast) => {
    const span = provenanceOf(node)?.span
    if (span) {
      requested.add(span.startByte)
      requested.add(span.endByte)
    }
    node.children?.forEach(collect)
  }
  collect(tree)
  const resolved = new Map<number, number>([[0, 0]])
  let byte = 0
  let utf16 = 0
  for (const character of source) {
    const codePoint = character.codePointAt(0)!
    byte += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4
    utf16 += character.length
    if (requested.has(byte)) resolved.set(byte, utf16)
  }
  const utf16At = (offset: number) => {
    const result = resolved.get(offset)
    if (result === undefined)
      throw new RangeError(`Invalid Rust UTF-8 provenance boundary: ${offset}`)
    return result
  }
  return {
    utf16At,
    slice: (fromByte, toByte) => source.slice(utf16At(fromByte), utf16At(toByte)),
  }
}

const graphemeLength = (value: string) =>
  typeof Intl.Segmenter === 'function'
    ? [...new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(value)].length
    : Array.from(value).length

const SUPPORTED_MDAST_TYPES = new Set([
  'root',
  'blockquote',
  'break',
  'code',
  'delete',
  'emphasis',
  'heading',
  'html',
  'image',
  'inlineCode',
  'link',
  'list',
  'listItem',
  'mdiBlank',
  'mdiComment',
  'mdiCommentBlock',
  'mdiBreak',
  'mdiEm',
  'mdiKern',
  'mdiLiteralText',
  'mdiNoBreak',
  'mdiPagebreak',
  'mdiRuby',
  'mdiTcy',
  'mdiWarichu',
  'paragraph',
  'strong',
  'text',
  'thematicBreak',
])
const BLOCK_CONTAINERS = new Set(['root', 'blockquote', 'listItem'])

const collectSourceBackedSegments = (
  node: StructuredCloneSafeMdast,
  offsets: SourceOffsets,
  baseByte: number,
): Array<Record<string, unknown>> => {
  const provenance = provenanceOf(node)
  const targets = provenance?.targets
  const result: Array<Record<string, unknown>> =
    provenance?.role === 'textBearing' &&
    provenance.status === 'sourceBacked' &&
    provenance.span &&
    targets?.length
      ? [
          {
            provenance,
            from: offsets.utf16At(provenance.span.startByte) - offsets.utf16At(baseByte),
            to: offsets.utf16At(provenance.span.endByte) - offsets.utf16At(baseByte),
          },
        ]
      : []
  return result.concat(
    node.children?.flatMap((child) => collectSourceBackedSegments(child, offsets, baseByte)) ?? [],
  )
}

type SerializeUnsupportedNode = (node: StructuredCloneSafeMdast) => string

const fallbackUnsupportedValue: SerializeUnsupportedNode = (node) => (
  typeof node.value === 'string' ? node.value : ''
)

const normalizeUnsupportedNodes = (
  parent: StructuredCloneSafeMdast,
  offsets: SourceOffsets,
  serializeUnsupported: SerializeUnsupportedNode,
) => {
  if (!parent.children) return
  parent.children = parent.children.flatMap((node) => {
    if (node.type === 'mdiComment' && BLOCK_CONTAINERS.has(parent.type)) {
      return { ...node, type: 'mdiCommentBlock' }
    }
    if (!SUPPORTED_MDAST_TYPES.has(node.type)) {
      const provenance = provenanceOf(node)
      let value: string
      if (provenance?.span) {
        value = offsets.slice(provenance.span.startByte, provenance.span.endByte)
      } else {
        try {
          value = serializeUnsupported(node)
        } catch {
          value = fallbackUnsupportedValue(node)
        }
      }
      const mdiBridgeSegments = provenance?.span
        ? collectSourceBackedSegments(node, offsets, provenance.span.startByte)
        : []
      const data = mdiBridgeSegments.length ? { mdiBridgeSegments } : undefined
      const comments: StructuredCloneSafeMdast[] = []
      const collectComments = (child: StructuredCloneSafeMdast) => {
        if (child.type === 'mdiComment') comments.push(child)
        child.children?.forEach(collectComments)
      }
      collectComments(node)
      if (comments.length && provenance?.span) {
        const base = offsets.utf16At(provenance.span.startByte)
        const pieces: StructuredCloneSafeMdast[] = []
        let cursor = provenance.span.startByte
        const addText = (end: number) => {
          if (end <= cursor) return
          const from = offsets.utf16At(cursor) - base
          const to = offsets.utf16At(end) - base
          const segments = mdiBridgeSegments.filter((segment) => Number(segment.from) >= from && Number(segment.to) <= to)
            .map((segment) => ({ ...segment, from: Number(segment.from) - from, to: Number(segment.to) - from }))
          pieces.push({ type: 'text', value: offsets.slice(cursor, end), ...(segments.length ? { data: { mdiBridgeSegments: segments } } : {}) })
        }
        for (const comment of comments) {
          const span = provenanceOf(comment)!.span!
          addText(span.startByte)
          pieces.push(comment)
          cursor = span.endByte
        }
        addText(provenance.span.endByte)
        return BLOCK_CONTAINERS.has(parent.type) ? { type: 'paragraph', children: pieces } : pieces
      }
      return BLOCK_CONTAINERS.has(parent.type)
        ? { type: 'paragraph', children: [{ type: 'text', value, data }] }
        : { type: 'text', value, data }
    }
    normalizeUnsupportedNodes(node, offsets, serializeUnsupported)
    return node
  })
}

const splitProvenanceLineBreaks = (tree: StructuredCloneSafeMdast) => {
  const visit = (parent: StructuredCloneSafeMdast) => {
    if (!parent.children) return
    parent.children = parent.children.flatMap((node) => {
      visit(node)
      const provenance = provenanceOf(node)
      const bridgeSegments = node.data?.mdiBridgeSegments as
        | Array<{
            provenance: unknown
            from: number
            to: number
            startCharacter?: number
            endCharacter?: number
          }>
        | undefined
      if (
        node.type !== 'text' ||
        typeof node.value !== 'string' ||
        (!provenance && !bridgeSegments?.length)
      )
        return [node]
      const expression = /[\t ]*(?:\r?\n|\r)/g
      const result: StructuredCloneSafeMdast[] = []
      let start = 0
      let startCharacter = 0
      const segmentData = (from: number, to: number): Record<string, unknown> => {
        if (provenance) {
          const length = graphemeLength(node.value!.slice(from, to))
          return {
            mdiProvenance: provenance,
            mdiBridgeSegment: {
              startCharacter,
              endCharacter: startCharacter + length,
            },
          }
        }
        return {
          mdiBridgeSegments: bridgeSegments!.flatMap((segment) => {
            const segmentFrom = Math.max(from, segment.from)
            const segmentTo = Math.min(to, segment.to)
            if (segmentFrom >= segmentTo) return []
            const offset = graphemeLength(node.value!.slice(segment.from, segmentFrom))
            const length = graphemeLength(node.value!.slice(segmentFrom, segmentTo))
            const base = segment.startCharacter ?? 0
            return [
              {
                ...segment,
                from: segmentFrom - from,
                to: segmentTo - from,
                startCharacter: base + offset,
                endCharacter: base + offset + length,
              },
            ]
          }),
        }
      }
      for (const match of node.value.matchAll(expression)) {
        const position = match.index
        if (start !== position) {
          const value = node.value.slice(start, position)
          result.push({
            type: 'text',
            value,
            data: segmentData(start, position),
          })
          startCharacter += graphemeLength(value)
        }
        result.push({
          type: 'break',
          data: {
            ...segmentData(position, position + match[0].length),
            isInline: true,
          },
        })
        startCharacter += graphemeLength(match[0])
        start = position + match[0].length
      }
      if (!result.length) return [node]
      if (start < node.value.length) {
        result.push({
          type: 'text',
          value: node.value.slice(start),
          data: segmentData(start, node.value.length),
        })
      }
      return result
    })
  }
  visit(tree)
}

const addCommonmarkMarkerPositions = (tree: StructuredCloneSafeMdast, offsets: SourceOffsets) => {
  const visit = (node: StructuredCloneSafeMdast) => {
    if (!node.position && (node.type === 'strong' || node.type === 'emphasis')) {
      const startByte = provenanceOf(node)?.span?.startByte ?? 0
      const offset = offsets.utf16At(startByte)
      node.position = {
        start: { line: 1, column: offset + 1, offset },
        end: { line: 1, column: offset + 1, offset },
      }
    }
    node.children?.forEach(visit)
  }
  visit(tree)
}

/** Internal bridge shared by synchronous Remark parsing and Worker preparation. */
export const normalizeMdiMdastTree = (
  tree: StructuredCloneSafeMdast,
  source: string,
  serializeUnsupported: SerializeUnsupportedNode = fallbackUnsupportedValue,
): string | undefined => {
  const yamlIndex = tree.children?.findIndex((node) => node.type === 'yaml') ?? -1
  let frontmatter: string | undefined
  if (yamlIndex >= 0 && tree.children) {
    const [yaml] = tree.children.splice(yamlIndex, 1)
    frontmatter = typeof yaml?.value === 'string' ? yaml.value : ''
  }
  const offsets = sourceOffsets(tree, source)
  const promote = (node: StructuredCloneSafeMdast) => {
    if (node.type === 'text' && node.mdiLiteral === true) node.type = 'mdiLiteralText'
    node.children?.forEach(promote)
  }
  promote(tree)
  normalizeUnsupportedNodes(tree, offsets, serializeUnsupported)
  splitProvenanceLineBreaks(tree)
  addCommonmarkMarkerPositions(tree, offsets)
  return frontmatter
}

const toMdastNode = (node: MdiMdastNode): StructuredCloneSafeMdast => {
  const { span: _span, mdiProvenance, children, ...rest } = node
  const mapped: StructuredCloneSafeMdast = { ...rest, type: String(rest.type) }
  if (children) mapped.children = children.map(toMdastNode)
  if (mdiProvenance) mapped.data = { mdiProvenance }
  switch (node.type) {
    case 'ruby':
      return {
        ...mapped,
        type: 'mdiRuby',
        ruby: (node.ruby as { value?: unknown })?.value ?? '',
      }
    case 'comment':
      return { ...mapped, type: 'mdiComment', span: _span }
    case 'tcy':
      return { ...mapped, type: 'mdiTcy' }
    case 'break':
      return { ...mapped, type: 'mdiBreak' }
    case 'em':
      return { ...mapped, type: 'mdiEm' }
    case 'noBreak':
      return { ...mapped, type: 'mdiNoBreak' }
    case 'warichu':
      return { ...mapped, type: 'mdiWarichu' }
    case 'kern':
      return { ...mapped, type: 'mdiKern' }
    case 'blank':
      return { ...mapped, type: 'mdiBlank' }
    case 'pagebreak':
      if (mapped.variant === null) delete mapped.variant
      return { ...mapped, type: 'mdiPagebreak' }
    case 'paragraph': {
      const data: Record<string, unknown> = { ...mapped.data }
      if (typeof mapped.indent === 'number') data.mdiIndent = mapped.indent
      if (typeof mapped.bottom === 'number') data.mdiBottom = mapped.bottom
      delete mapped.indent
      delete mapped.bottom
      if (Object.keys(data).length) mapped.data = data
      return mapped
    }
    default:
      return mapped
  }
}

const toPreparedTree = (
  document: MdiMdastDocument,
  canonicalSource: string,
): { document: StructuredCloneSafeMdast; frontmatter?: string } => {
  const tree: StructuredCloneSafeMdast = {
    type: 'root',
    children: document.children.map(toMdastNode),
  }
  normalizeMdiMdastTree(tree, canonicalSource)
  return {
    document: tree,
    ...(document.frontmatter ? { frontmatter: document.frontmatter.raw } : {}),
  }
}

const BLOCK_TYPES = new Set([
  'blockquote',
  'code',
  'heading',
  'html',
  'listItem',
  'mdiBlank',
  'mdiPagebreak',
  'paragraph',
  'thematicBreak',
])
const countBlocks = (node: StructuredCloneSafeMdast): number =>
  (BLOCK_TYPES.has(node.type) ? 1 : 0) +
  (node.children?.reduce((total, child) => total + countBlocks(child), 0) ?? 0)

/**
 * Complete the Rust parse, canonicalization and Milkdown mdast preparation in
 * the caller's execution context. Browser consumers should invoke this from a
 * module Worker and pass the returned plain data to `mdi({ initialDocument })`.
 */
export async function prepareMdiDocument(source: string): Promise<PreparedMdiDocument> {
  const original = parseForMdast(source, { includeComments: true })
  const canonicalSource = canonicalizeMdiPreservingLiteralText(source)
  const canonical = parseForMdast(canonicalSource, { includeComments: true })
  const preparedTree = toPreparedTree(canonical.document, canonicalSource)
  const prepared: PreparedMdiDocument = {
    version: PREPARED_MDI_DOCUMENT_VERSION,
    mdiIrVersion: canonical.irVersion,
    provenanceVersion: MDI_MDAST_PROVENANCE_VERSION,
    canonicalSource,
    document: preparedTree.document,
    ...('frontmatter' in preparedTree ? { frontmatter: preparedTree.frontmatter } : {}),
    diagnostics: original.diagnostics,
    stats: {
      sourceUtf16Length: source.length,
      sourceBytes: new TextEncoder().encode(source).byteLength,
      blockCount: countBlocks(preparedTree.document),
    },
  }
  return assertCompatiblePreparedMdiDocument(prepared)
}
