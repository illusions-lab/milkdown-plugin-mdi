import { createSlice, createTimer, type Ctx, type MilkdownPlugin } from '@milkdown/ctx'
import remarkMdi from '@illusions-lab/mdi-remark'
import {
  defaultValueCtx,
  editorStateTimerCtx,
  InitReady,
  ParserReady,
  remarkPluginsCtx,
  remarkStringifyOptionsCtx,
} from '@milkdown/core'
import { paragraphSchema } from '@milkdown/preset-commonmark'
import { getMarkdown, $markSchema, $node } from '@milkdown/utils'
import { $prose } from '@milkdown/utils'
import { Plugin } from '@milkdown/prose/state'
import { mdastToMdiSource } from 'mdast-util-mdi'
import {
  installMdiProvenanceParser,
  type MdiBridgeData,
  type MdiBridgeSegment,
} from './provenance.js'
import {
  canonicalizeMdiPreservingLiteralText,
  canonicalizeMdiSource,
  literalPlaceholder,
} from './literal-text.js'

export { initializeMdi } from '@illusions-lab/mdi'

const KERN_AMOUNT = /^[+-]?\d+(?:\.\d+)?em$/
const mdiFrontmatterCtx = createSlice<string | undefined>(undefined, 'mdiFrontmatter')
const mdiProvenanceReady = createTimer('mdiProvenanceReady')

interface PositionalMdastNode {
  type: string
  value?: string
  mdiLiteral?: boolean
  children?: PositionalMdastNode[]
  data?: Record<string, unknown> & MdiBridgeData
  position?: {
    start: { line: number; column: number; offset: number }
    end: { line: number; column: number; offset: number }
  }
}

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

const promoteLiteralTextNodes = (node: PositionalMdastNode) => {
  if (node.type === 'text' && node.mdiLiteral === true) node.type = 'mdiLiteralText'
  node.children?.forEach(promoteLiteralTextNodes)
}

const BLOCK_CONTAINERS = new Set(['root', 'blockquote', 'listItem'])

const needsLiteralFallback = (node: PositionalMdastNode) => {
  return !SUPPORTED_MDAST_TYPES.has(node.type)
}

const nodeProvenance = (node: PositionalMdastNode) => node.data?.mdiProvenance

interface SourceOffsets {
  slice: (fromByte: number, toByte: number) => string
  utf16At: (byte: number) => number
}

const sourceOffsets = (tree: PositionalMdastNode, source: string): SourceOffsets => {
  const requested = new Set([0])
  const collect = (node: PositionalMdastNode) => {
    const span = nodeProvenance(node)?.span
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
    if (result === undefined) throw new RangeError(`Invalid Rust UTF-8 provenance boundary: ${offset}`)
    return result
  }
  return {
    utf16At,
    slice: (fromByte, toByte) => source.slice(utf16At(fromByte), utf16At(toByte)),
  }
}

const collectSourceBackedSegments = (
  node: PositionalMdastNode,
  offsets: SourceOffsets,
  baseByte: number,
): MdiBridgeSegment[] => {
  const provenance = nodeProvenance(node)
  const result = provenance?.role === 'textBearing'
    && provenance.status === 'sourceBacked'
    && provenance.span
    && provenance.targets.length
    ? [{
        provenance,
        from: offsets.utf16At(provenance.span.startByte) - offsets.utf16At(baseByte),
        to: offsets.utf16At(provenance.span.endByte) - offsets.utf16At(baseByte),
      }]
    : []
  return result.concat(node.children?.flatMap((child) =>
    collectSourceBackedSegments(child, offsets, baseByte)) ?? [])
}

// Preserve genuinely unknown mdast extensions as editable literal text instead
// of allowing one unsupported node to abort parsing of the entire document.
const normalizeUnsupportedNodes = (parent: PositionalMdastNode, offsets: SourceOffsets) => {
  if (!parent.children) return
  parent.children = parent.children.map((node) => {
    if (needsLiteralFallback(node)) {
      const provenance = nodeProvenance(node)
      let value: string
      if (provenance?.span) {
        value = offsets.slice(provenance.span.startByte, provenance.span.endByte)
      } else {
        try {
          value = mdastToMdiSource({ type: 'root', children: [node] } as never).trimEnd()
        } catch {
          value = typeof node.value === 'string' ? node.value : ''
        }
      }
      const mdiBridgeSegments = provenance?.span
        ? collectSourceBackedSegments(node, offsets, provenance.span.startByte)
        : []
      const data = mdiBridgeSegments.length ? { mdiBridgeSegments } : undefined
      if (BLOCK_CONTAINERS.has(parent.type)) {
        return { type: 'paragraph', children: [{ type: 'text', value, data }] }
      }
      return { type: 'text', value, data }
    }
    normalizeUnsupportedNodes(node, offsets)
    return node
  })
}

const splitProvenanceLineBreaks = (tree: PositionalMdastNode) => {
  const visit = (parent: PositionalMdastNode) => {
    if (!parent.children) return
    parent.children = parent.children.flatMap((node) => {
      visit(node)
      const provenance = nodeProvenance(node)
      const bridgeSegments = node.data?.mdiBridgeSegments
      if (node.type !== 'text' || typeof node.value !== 'string'
        || !provenance && !bridgeSegments?.length) return [node]
      const expression = /[\t ]*(?:\r?\n|\r)/g
      const result: PositionalMdastNode[] = []
      let start = 0
      let startCharacter = 0
      const segmentData = (from: number, to: number): MdiBridgeData => {
        if (provenance) {
          const length = graphemes(node.value!.slice(from, to)).length
          return {
            mdiProvenance: provenance,
            mdiBridgeSegment: { startCharacter, endCharacter: startCharacter + length },
          }
        }
        return {
          mdiBridgeSegments: bridgeSegments!.flatMap((segment) => {
            const segmentFrom = Math.max(from, segment.from)
            const segmentTo = Math.min(to, segment.to)
            if (segmentFrom >= segmentTo) return []
            const offset = graphemes(node.value!.slice(segment.from, segmentFrom)).length
            const length = graphemes(node.value!.slice(segmentFrom, segmentTo)).length
            const base = segment.startCharacter ?? 0
            return [{
              ...segment,
              from: segmentFrom - from,
              to: segmentTo - from,
              startCharacter: base + offset,
              endCharacter: base + offset + length,
            }]
          }),
        }
      }
      for (const match of node.value.matchAll(expression)) {
        const position = match.index
        if (start !== position) {
          const value = node.value.slice(start, position)
          const length = graphemes(value).length
          result.push({ type: 'text', value, data: segmentData(start, position) })
          startCharacter += length
        }
        const length = graphemes(match[0]).length
        result.push({ type: 'break', data: {
          ...segmentData(position, position + match[0].length),
          isInline: true,
        } })
        startCharacter += length
        start = position + match[0].length
      }
      if (!result.length) return [node]
      if (start < node.value.length) {
        const value = node.value.slice(start)
        result.push({
          type: 'text', value, data: segmentData(start, node.value.length),
        })
      }
      return result
    })
  }
  visit(tree)
}

const extractFrontmatter = (tree: PositionalMdastNode, ctx: Ctx) => {
  const index = tree.children?.findIndex((node) => node.type === 'yaml') ?? -1
  if (index < 0 || !tree.children) {
    ctx.set(mdiFrontmatterCtx, undefined)
    return
  }

  const [yaml] = tree.children.splice(index, 1)
  ctx.set(mdiFrontmatterCtx, typeof yaml?.value === 'string' ? yaml.value : '')
}

interface VFileLike {
  value?: unknown
}

// Milkdown's CommonMark marker transformer reads source positions to retain
// `*` versus `_`. Convert the exact Rust UTF-8 provenance start to the UTF-16
// offset Milkdown expects; never search the source or infer traversal order.
const addCommonmarkMarkerPositions = (tree: PositionalMdastNode, offsets: SourceOffsets) => {
  const visit = (node: PositionalMdastNode) => {
    if (!node.position && (node.type === 'strong' || node.type === 'emphasis')) {
      const startByte = nodeProvenance(node)?.span?.startByte ?? 0
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

const createRemarkMdiForMilkdown = (ctx: Ctx) => {
  return function remarkMdiForMilkdown(this: ThisParameterType<typeof remarkMdi>) {
    remarkMdi.call(this)
    return (tree: PositionalMdastNode, file: VFileLike) => {
      const source = typeof file.value === 'string' ? file.value : ''
      const offsets = sourceOffsets(tree, source)
      extractFrontmatter(tree, ctx)
      promoteLiteralTextNodes(tree)
      normalizeUnsupportedNodes(tree, offsets)
      splitProvenanceLineBreaks(tree)
      addCommonmarkMarkerPositions(tree, offsets)
    }
  }
}

const stringAttribute = (element: HTMLElement, name: string) =>
  element.getAttribute(name) ?? ''

const rubyReading = (value: unknown): string | string[] => {
  if (typeof value === 'string') return value
  if (Array.isArray(value) && value.every((part) => typeof part === 'string')) {
    return value
  }
  return ''
}

const parseRubyReadingAttribute = (value: string): string | string[] => {
  try {
    return rubyReading(JSON.parse(value))
  } catch {
    return ''
  }
}

const graphemes = (value: string) => {
  if (typeof Intl.Segmenter === 'function') {
    return [...new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(value)]
      .map(({ segment }) => segment)
  }
  return Array.from(value)
}

const isMdiMark = (value: unknown): value is string => typeof value === 'string'
  && graphemes(value).length === 1
  && !/[\s\p{Cc}\p{Cf}]/u.test(value)

const mdiRubySchema = $node('mdiRuby', () => ({
  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,
  attrs: {
    base: { default: '', validate: 'string' },
    ruby: {
      default: '',
      validate: (value) => {
        if (typeof value === 'string') return
        if (Array.isArray(value) && value.every((part) => typeof part === 'string')) return
        throw new RangeError('MDI ruby must be a string or an array of strings')
      },
    },
  },
  parseDOM: [
    {
      tag: 'ruby[data-mdi-ruby]',
      getAttrs: (dom) => {
        const element = dom as HTMLElement
        const base = stringAttribute(element, 'data-mdi-base')
        return {
          base,
          ruby: parseRubyReadingAttribute(stringAttribute(element, 'data-mdi-reading')),
        }
      },
    },
  ],
  toDOM: (node) => {
    const base = String(node.attrs.base)
    const reading = rubyReading(node.attrs.ruby)
    const annotation = Array.isArray(reading)
      ? graphemes(base).flatMap((segment, index) => [
          segment,
          ['rp', '（'],
          ['rt', reading[index] ?? ''],
          ['rp', '）'],
        ])
      : [base, ['rp', '（'], ['rt', reading], ['rp', '）']]
    return [
      'ruby',
      {
        class: `mdi-ruby mdi-ruby--${Array.isArray(reading) ? 'split' : 'group'}`,
        'data-mdi-ruby': Array.isArray(reading) ? 'split' : 'group',
        'data-mdi-base': base,
        'data-mdi-reading': JSON.stringify(reading),
      },
      ...annotation,
    ]
  },
  parseMarkdown: {
    match: (node) => node.type === 'mdiRuby',
    runner: (state, node, type) => {
      state.addNode(type, {
        base: typeof node.base === 'string' ? node.base : '',
        ruby: rubyReading(node.ruby),
      })
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'mdiRuby',
    runner: (state, node) => {
      state.addNode('mdiRuby', undefined, undefined, {
        base: String(node.attrs.base),
        ruby: rubyReading(node.attrs.ruby),
      })
    },
  },
}))

const mdiTcySchema = $markSchema('mdiTcy', () => ({
  parseDOM: [{ tag: 'span.mdi-tcy' }],
  toDOM: () => ['span', { class: 'mdi-tcy', 'data-mdi-tcy': '' }, 0],
  parseMarkdown: {
    match: (node) => node.type === 'mdiTcy',
    runner: (state, node, type) => {
      state.openMark(type)
      state.addText(typeof node.value === 'string' ? node.value : '')
      state.closeMark(type)
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === 'mdiTcy',
    runner: (state, mark, node) => {
      state.withMark(mark, 'mdiTcy', node.text ?? '')
      return true
    },
  },
}))

// A transient, presentation-neutral mark distinguishes explicit literal-text
// paste from unsupported Markdown fallback. It is persisted as escaped source
// and reconstructed from Rust's parse-time literal marker on reopen.
const mdiLiteralSchema = $markSchema('mdiLiteral', () => ({
  parseDOM: [{ tag: 'span[data-mdi-literal]' }],
  toDOM: () => ['span', { 'data-mdi-literal': '' }, 0],
  parseMarkdown: {
    match: (node) => node.type === 'mdiLiteralText',
    runner: (state, node, type) => {
      state.openMark(type)
      state.addText(typeof node.value === 'string' ? node.value : '')
      state.closeMark(type)
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === 'mdiLiteral',
    runner: (state, mark, node) => {
      state.withMark(mark, 'mdiLiteralText', node.text ?? '')
      return true
    },
  },
}))

// The upstream MDI adapter includes GFM parsing, whereas Milkdown's
// `commonmark` preset has no schema for mdast `delete` nodes.
const gfmDeleteSchema = $markSchema('mdiGfmDelete', () => ({
  parseDOM: [{ tag: 'del' }, { tag: 's' }],
  toDOM: () => ['del', 0],
  parseMarkdown: {
    match: (node) => node.type === 'delete',
    runner: (state, node, type) => {
      state.openMark(type)
      state.next(node.children)
      state.closeMark(type)
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === 'mdiGfmDelete',
    runner: (state, mark) => {
      state.withMark(mark, 'delete')
    },
  },
}))

const mdiBotenSchema = $markSchema('mdiBoten', () => ({
  attrs: {
    mark: {
      default: '﹅',
      validate: (value) => {
        if (!isMdiMark(value)) throw new RangeError(`Invalid MDI emphasis mark: ${String(value)}`)
      },
    },
  },
  parseDOM: [
    {
      tag: 'span.mdi-boten',
      getAttrs: (dom) => {
        const mark = stringAttribute(dom as HTMLElement, 'data-mdi-mark') || '﹅'
        return isMdiMark(mark) ? { mark } : false
      },
    },
  ],
  toDOM: (mark) => [
    'span',
    {
      class: 'mdi-boten',
      'data-mdi-mark': String(mark.attrs.mark),
      style: `--mdi-boten-mark: '${String(mark.attrs.mark).replace(/[\\']/g, '\\$&')}'`,
    },
    0,
  ],
  parseMarkdown: {
    match: (node) => node.type === 'mdiEm',
    runner: (state, node, type) => {
      state.openMark(type, { mark: typeof node.mark === 'string' ? node.mark : '﹅' })
      state.next(node.children)
      state.closeMark(type)
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === 'mdiBoten',
    runner: (state, mark) => {
      state.withMark(mark, 'mdiEm', undefined, { mark: String(mark.attrs.mark) })
    },
  },
}))

const wrappingMark = (
  name: 'mdiNoBreak' | 'mdiWarichu',
  mdastType: 'mdiNoBreak' | 'mdiWarichu',
  className: string,
) => $markSchema(name, () => ({
  parseDOM: [{ tag: `span.${className}` }],
  toDOM: () => ['span', { class: className, [`data-${className}`]: '' }, 0],
  parseMarkdown: {
    match: (node) => node.type === mdastType,
    runner: (state, node, type) => {
      state.openMark(type)
      state.next(node.children)
      state.closeMark(type)
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === name,
    runner: (state, mark) => {
      state.withMark(mark, mdastType)
    },
  },
}))

const mdiNoBreakSchema = wrappingMark('mdiNoBreak', 'mdiNoBreak', 'mdi-no-break')
const mdiWarichuSchema = wrappingMark('mdiWarichu', 'mdiWarichu', 'mdi-warichu')

const mdiKernSchema = $markSchema('mdiKern', () => ({
  attrs: {
    amount: {
      default: '0em',
      validate: (value) => {
        if (typeof value !== 'string' || !KERN_AMOUNT.test(value)) {
          throw new RangeError(`Invalid MDI kern amount: ${String(value)}`)
        }
      },
    },
  },
  parseDOM: [
    {
      tag: 'span.mdi-kern',
      getAttrs: (dom) => {
        const amount = stringAttribute(dom as HTMLElement, 'data-mdi-kern')
        return KERN_AMOUNT.test(amount) ? { amount } : false
      },
    },
  ],
  toDOM: (mark) => [
    'span',
    {
      class: 'mdi-kern',
      'data-mdi-kern': String(mark.attrs.amount),
      style: `--mdi-kern: ${String(mark.attrs.amount)}`,
    },
    0,
  ],
  parseMarkdown: {
    match: (node) => node.type === 'mdiKern',
    runner: (state, node, type) => {
      const amount = typeof node.amount === 'string' && KERN_AMOUNT.test(node.amount)
        ? node.amount
        : '0em'
      state.openMark(type, { amount })
      state.next(node.children)
      state.closeMark(type)
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === 'mdiKern',
    runner: (state, mark) => {
      state.withMark(mark, 'mdiKern', undefined, { amount: String(mark.attrs.amount) })
    },
  },
}))

const mdiBreakSchema = $node('mdiBreak', () => ({
  inline: true,
  group: 'inline',
  atom: true,
  selectable: false,
  // Win over CommonMark's generic `br` rule when parsing our own semantic DOM.
  parseDOM: [{ tag: 'br.mdi-break', priority: 60 }],
  toDOM: () => ['br', { class: 'mdi-break', 'data-mdi-break': '' }],
  parseMarkdown: {
    match: (node) => node.type === 'mdiBreak',
    runner: (state, _node, type) => state.addNode(type),
  },
  toMarkdown: {
    match: (node) => node.type.name === 'mdiBreak',
    runner: (state) => state.addNode('mdiBreak'),
  },
}))

const isPagebreakVariant = (value: unknown): value is 'right' | 'left' =>
  value === 'right' || value === 'left'

const mdiPagebreakSchema = $node('mdiPagebreak', () => ({
  group: 'block',
  atom: true,
  selectable: true,
  attrs: {
    variant: {
      default: null,
      validate: (value) => {
        if (value === null || isPagebreakVariant(value)) return
        throw new RangeError(`Invalid MDI pagebreak variant: ${String(value)}`)
      },
    },
  },
  // Win over CommonMark's thematic break rule when parsing our semantic DOM.
  parseDOM: [{
    tag: 'hr.mdi-pagebreak[data-mdi-pagebreak]',
    priority: 60,
    getAttrs: (dom) => {
      const value = (dom as HTMLElement).getAttribute('data-mdi-variant')
      return value === null || isPagebreakVariant(value) ? { variant: value } : false
    },
  }],
  toDOM: (node) => [
    'hr',
    {
      class: 'mdi-pagebreak',
      'data-mdi-pagebreak': '',
      ...(isPagebreakVariant(node.attrs.variant)
        ? { 'data-mdi-variant': node.attrs.variant }
        : {}),
    },
  ],
  parseMarkdown: {
    match: (node) => node.type === 'mdiPagebreak',
    runner: (state, node, type) => state.addNode(type, {
      variant: isPagebreakVariant(node.variant) ? node.variant : null,
    }),
  },
  toMarkdown: {
    match: (node) => node.type.name === 'mdiPagebreak',
    runner: (state, node) => state.addNode('mdiPagebreak', undefined, undefined, {
      ...(isPagebreakVariant(node.attrs.variant) ? { variant: node.attrs.variant } : {}),
    }),
  },
}))

const mdiLayoutAttribute = {
  default: null,
  validate: (value: unknown) => {
    if (value === null || (typeof value === 'number' && Number.isInteger(value) && value >= 0)) return
    throw new RangeError(`Invalid MDI paragraph layout value: ${String(value)}`)
  },
}

const parseMdiLayoutAttribute = (element: HTMLElement, name: string) => {
  const value = element.getAttribute(name)
  if (value === null) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const mdiParagraphSchema = paragraphSchema.extendSchema((previous) => (ctx) => {
  const schema = previous(ctx)
  return {
    ...schema,
    attrs: {
      ...schema.attrs,
      mdiIndent: mdiLayoutAttribute,
      mdiBottom: mdiLayoutAttribute,
      mdiBlank: { default: false },
    },
    parseDOM: [{
      tag: 'div.mdi-blank[data-mdi-blank]',
      priority: 70,
      getAttrs: () => ({ mdiIndent: null, mdiBottom: null, mdiBlank: true }),
    }, {
      tag: 'p',
      getAttrs: (dom) => {
        const element = dom as HTMLElement
        return {
          mdiIndent: parseMdiLayoutAttribute(element, 'data-mdi-indent'),
          mdiBottom: parseMdiLayoutAttribute(element, 'data-mdi-bottom'),
          mdiBlank: element.hasAttribute('data-mdi-blank') && element.textContent === '',
        }
      },
    }],
    toDOM: (node) => {
      const base = schema.toDOM?.(node) as unknown[] | undefined
      const attributes: Record<string, unknown> = {
        ...(base?.[1] && typeof base[1] === 'object' ? base[1] as Record<string, unknown> : {}),
      }
      if (typeof node.attrs.mdiIndent === 'number') {
        attributes.class = [attributes.class, 'mdi-indent'].filter(Boolean).join(' ')
        attributes['data-mdi-indent'] = String(node.attrs.mdiIndent)
        attributes.style = [attributes.style, `--mdi-indent: ${String(node.attrs.mdiIndent)}`]
          .filter(Boolean).join('; ')
      } else if (typeof node.attrs.mdiBottom === 'number') {
        attributes.class = [attributes.class, 'mdi-bottom'].filter(Boolean).join(' ')
        attributes['data-mdi-bottom'] = String(node.attrs.mdiBottom)
        attributes.style = [attributes.style, `--mdi-bottom: ${String(node.attrs.mdiBottom)}`]
          .filter(Boolean).join('; ')
      }
      if (node.attrs.mdiBlank === true && node.content.size === 0) {
        attributes.class = [attributes.class, 'mdi-blank'].filter(Boolean).join(' ')
        attributes['data-mdi-blank'] = ''
      }
      return ['p', attributes, 0]
    },
    parseMarkdown: {
      match: (node) => node.type === 'paragraph' || node.type === 'mdiBlank',
      runner: (state, node, type) => {
        const data = node.data as Record<string, unknown> | undefined
        state.openNode(type, {
          mdiIndent: typeof data?.mdiIndent === 'number' ? data.mdiIndent : null,
          mdiBottom: typeof data?.mdiBottom === 'number' ? data.mdiBottom : null,
          mdiBlank: node.type === 'mdiBlank' || data?.mdiBlank === true,
        })
        if (node.children) state.next(node.children)
        else if (typeof node.value === 'string' && node.value) state.addText(node.value)
        state.closeNode()
      },
    },
    toMarkdown: {
      match: (node) => node.type.name === 'paragraph',
      runner: (state, node) => {
        if (node.content.size === 0 && node.attrs.mdiBlank === true) {
          state.addNode('mdiBlank')
          return
        }
        const data: Record<string, number> = {}
        if (typeof node.attrs.mdiIndent === 'number') data.mdiIndent = node.attrs.mdiIndent
        else if (typeof node.attrs.mdiBottom === 'number') data.mdiBottom = node.attrs.mdiBottom
        state.openNode('paragraph', undefined, Object.keys(data).length > 0 ? { data } : undefined)
        state.next(node.content)
        state.closeNode()
      },
    },
  }
})

const mdiBlankNormalization = $prose(
  () => new Plugin({
    appendTransaction: (transactions, _oldState, state) => {
      if (!transactions.some((transaction) => transaction.docChanged)) return null
      const paragraph = state.schema.nodes.paragraph
      if (!paragraph) return null
      const updates: Array<{ pos: number; attrs: Record<string, unknown> }> = []
      state.doc.forEach((node, pos, index) => {
        if (node.type !== paragraph) return
        if (node.attrs.mdiBlank === true && node.content.size > 0) {
          updates.push({ pos, attrs: { ...node.attrs, mdiBlank: false } })
          return
        }
        if (node.content.size === 0 && index < state.doc.childCount - 1 && node.attrs.mdiBlank !== true) {
          updates.push({ pos, attrs: { ...node.attrs, mdiBlank: true } })
        }
      })
      if (updates.length === 0) return null
      const tr = state.tr
      for (const update of updates) tr.setNodeMarkup(update.pos, paragraph, update.attrs)
      return tr.setMeta('addToHistory', false)
    },
  }),
)

const mdiRemarkPlugin: MilkdownPlugin = (ctx) => {
  ctx.inject(mdiFrontmatterCtx)
  ctx.update(editorStateTimerCtx, (timers) => [...timers, mdiProvenanceReady])
  const literalMdiUnsafe = [
    { character: '{', after: '[^{}\\r\\n]*\\|', inConstruct: 'phrasing' as const },
    { character: '^', after: '[^^\\r\\n]+\\^', inConstruct: 'phrasing' as const },
    { character: '[', after: '\\[', inConstruct: 'phrasing' as const },
    { character: '《', after: '《', inConstruct: 'phrasing' as const },
  ]
  const literalTextHandler = (node: { value?: unknown }) => literalPlaceholder(
    typeof node.value === 'string' ? node.value : '',
  )
  ctx.update(remarkStringifyOptionsCtx, (options) => ({
    ...options,
    handlers: {
      ...options.handlers,
      mdiLiteralText: literalTextHandler,
    } as typeof options.handlers,
    unsafe: [...(options.unsafe ?? []), ...literalMdiUnsafe],
  }))
  ctx.record(mdiProvenanceReady)
  return async () => {
    await ctx.wait(InitReady)
    // The initial document is parsed only once. Canonicalize it before the
    // provenance parser is installed so its document shape and the later
    // source-coordinate snapshot always describe the same MDI source.
    ctx.update(defaultValueCtx, (source) => (
      typeof source === 'string' ? canonicalizeMdiPreservingLiteralText(source) : source
    ))
    let entry: unknown
    ctx.update(remarkPluginsCtx, (plugins) => {
      const nextEntry = {
        plugin: createRemarkMdiForMilkdown(ctx) as (typeof plugins)[number]['plugin'],
        options: {},
      } as (typeof plugins)[number]
      entry = nextEntry
      return [nextEntry, ...plugins]
    })
    await ctx.wait(ParserReady)
    installMdiProvenanceParser(ctx)
    ctx.done(mdiProvenanceReady)
    return () => {
      ctx.update(remarkPluginsCtx, (plugins) => plugins.filter((plugin) => plugin !== entry))
      ctx.update(remarkStringifyOptionsCtx, (options) => ({
        ...options,
        handlers: Object.fromEntries(
          Object.entries(options.handlers ?? {}).filter(
            ([name, handler]) => name !== 'mdiLiteralText' || handler !== literalTextHandler,
          ),
        ) as typeof options.handlers,
        unsafe: (options.unsafe ?? []).filter(
          (rule) => !literalMdiUnsafe.some((candidate) => candidate === rule),
        ),
      }))
      ctx.remove(mdiFrontmatterCtx)
      ctx.clearTimer(mdiProvenanceReady)
    }
  }
}

const mdiPlugins: MilkdownPlugin[] = [
  mdiRemarkPlugin,
  mdiRubySchema,
  ...gfmDeleteSchema,
  ...mdiLiteralSchema,
  ...mdiTcySchema,
  ...mdiBotenSchema,
  ...mdiNoBreakSchema,
  ...mdiWarichuSchema,
  ...mdiKernSchema,
  mdiBreakSchema,
  mdiPagebreakSchema,
  ...mdiParagraphSchema,
  mdiBlankNormalization,
]

export function mdi(): MilkdownPlugin[] {
  return [...mdiPlugins]
}

export function getMdi(): (ctx: Ctx) => string {
  return (ctx) => {
    const body = getMarkdown()(ctx)
    const frontmatter = ctx.get(mdiFrontmatterCtx)
    const source = frontmatter === undefined
      ? body
      : `---\n${frontmatter}\n---\n\n${body}`
    return canonicalizeMdiSource(source)
  }
}

export * from './editing.js'
export * from './input-clipboard.js'
export * from './mapping.js'
export * from './projection.js'
