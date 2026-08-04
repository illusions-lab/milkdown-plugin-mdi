import { createSlice, type Ctx, type MilkdownPlugin } from '@milkdown/ctx'
import { serializeMdi } from '@illusions-lab/mdi'
import remarkMdi from '@illusions-lab/mdi-remark'
import { InitReady, remarkPluginsCtx } from '@milkdown/core'
import { getMarkdown, $markSchema, $node } from '@milkdown/utils'
import { mdastToMdiSource } from 'mdast-util-mdi'

export { initializeMdi } from '@illusions-lab/mdi'

const KERN_AMOUNT = /^[+-]?\d+(?:\.\d+)?em$/
const mdiFrontmatterCtx = createSlice<string | undefined>(undefined, 'mdiFrontmatter')

interface PositionalMdastNode {
  type: string
  value?: string
  children?: PositionalMdastNode[]
  data?: Record<string, unknown>
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
  'mdiBreak',
  'mdiEm',
  'mdiKern',
  'mdiNoBreak',
  'mdiRuby',
  'mdiTcy',
  'mdiWarichu',
  'paragraph',
  'strong',
  'text',
  'thematicBreak',
])

const BLOCK_CONTAINERS = new Set(['root', 'blockquote', 'listItem'])

const serializeFallback = (node: PositionalMdastNode): string => {
  try {
    return mdastToMdiSource({ type: 'root', children: [node] } as never).trimEnd()
  } catch {
    if (typeof node.value === 'string') return node.value
    return node.children?.map(serializeFallback).join('') ?? ''
  }
}

const needsLiteralFallback = (node: PositionalMdastNode) => {
  if (!SUPPORTED_MDAST_TYPES.has(node.type)) return true
  if (node.type !== 'paragraph') return false
  return node.data?.mdiIndent !== undefined || node.data?.mdiBottom !== undefined
}

// Block MDI and other mdast extensions are intentionally outside this
// milestone. Preserve their Markdown as editable literal text instead of
// allowing one unsupported node to abort parsing of the entire document.
const normalizeUnsupportedNodes = (parent: PositionalMdastNode) => {
  if (!parent.children) return
  parent.children = parent.children.map((node) => {
    if (needsLiteralFallback(node)) {
      const value = serializeFallback(node)
      if (BLOCK_CONTAINERS.has(parent.type)) {
        return { type: 'paragraph', children: [{ type: 'text', value }] }
      }
      return { type: 'text', value }
    }
    normalizeUnsupportedNodes(node)
    return node
  })
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
// `*` versus `_`. Rust-backed mdast intentionally omits positions, so restore
// only the marker offsets that transformer needs. Canonical MDI persistence
// does not otherwise depend on source positions.
const addCommonmarkMarkerPositions = (tree: PositionalMdastNode, source: string) => {
  let cursor = 0

  const markerOffset = (type: string) => {
    const expression = type === 'strong' ? /\*\*|__/g : /(?<![*_])[*_](?![*_])/g
    expression.lastIndex = cursor
    const match = expression.exec(source)
    if (!match) return 0
    cursor = match.index + match[0].length
    return match.index
  }

  const visit = (node: PositionalMdastNode) => {
    if (!node.position && (node.type === 'strong' || node.type === 'emphasis')) {
      const offset = markerOffset(node.type)
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
      extractFrontmatter(tree, ctx)
      normalizeUnsupportedNodes(tree)
      addCommonmarkMarkerPositions(tree, typeof file.value === 'string' ? file.value : '')
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
  attrs: { mark: { default: '﹅', validate: 'string' } },
  parseDOM: [
    {
      tag: 'span.mdi-boten',
      getAttrs: (dom) => ({ mark: stringAttribute(dom as HTMLElement, 'data-mdi-mark') || '﹅' }),
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

const mdiRemarkPlugin: MilkdownPlugin = (ctx) => {
  ctx.inject(mdiFrontmatterCtx)
  return async () => {
    await ctx.wait(InitReady)
    let entry: unknown
    ctx.update(remarkPluginsCtx, (plugins) => {
      const nextEntry = {
        plugin: createRemarkMdiForMilkdown(ctx) as (typeof plugins)[number]['plugin'],
        options: {},
      } as (typeof plugins)[number]
      entry = nextEntry
      return [nextEntry, ...plugins]
    })
    return () => {
      ctx.update(remarkPluginsCtx, (plugins) => plugins.filter((plugin) => plugin !== entry))
      ctx.remove(mdiFrontmatterCtx)
    }
  }
}

const mdiPlugins: MilkdownPlugin[] = [
  mdiRemarkPlugin,
  mdiRubySchema,
  ...gfmDeleteSchema,
  ...mdiTcySchema,
  ...mdiBotenSchema,
  ...mdiNoBreakSchema,
  ...mdiWarichuSchema,
  ...mdiKernSchema,
  mdiBreakSchema,
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
    const canonical = serializeMdi(source)
    const candidate = serializeMdi(canonical)
    if (candidate === canonical) return canonical

    // Milkdown can expose formerly unsupported literal block syntax to MDI on
    // the first pass (for example, a fallback table). Use a converged second
    // pass, but keep the first canonical form if upstream cannot reach a fixed
    // point for an unsupported construct.
    return serializeMdi(candidate) === candidate ? candidate : canonical
  }
}
