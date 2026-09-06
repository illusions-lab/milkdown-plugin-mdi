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
import type { MarkdownNode } from '@milkdown/transformer'
import { mdastToMdiSource } from 'mdast-util-mdi'
import { installMdiProvenanceParser } from './provenance.js'
import {
  canonicalizeMdiPreservingLiteralText,
  canonicalizeMdiSource,
  literalPlaceholder,
} from './literal-text.js'
import {
  assertCompatiblePreparedMdiDocument,
  normalizeMdiMdastTree,
  type PreparedMdiDocument,
  type StructuredCloneSafeMdast,
} from './prepared.js'

export { initializeMdi } from '@illusions-lab/mdi'

const KERN_AMOUNT = /^[+-]?\d+(?:\.\d+)?em$/
const mdiFrontmatterCtx = createSlice<string | undefined>(undefined, 'mdiFrontmatter')
const mdiProvenanceReady = createTimer('mdiProvenanceReady')

interface VFileLike {
  value?: unknown
}

const createRemarkMdiForMilkdown = (ctx: Ctx) => {
  return function remarkMdiForMilkdown(this: ThisParameterType<typeof remarkMdi>) {
    remarkMdi.call(this)
    return (tree: unknown, file: VFileLike) => {
      const source = typeof file.value === 'string' ? file.value : ''
      ctx.set(mdiFrontmatterCtx, normalizeMdiMdastTree(
        tree as StructuredCloneSafeMdast,
        source,
        (node) => mdastToMdiSource({ type: 'root', children: [node] } as never).trimEnd(),
      ))
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

const createMdiRemarkPlugin = (initialDocument?: PreparedMdiDocument): MilkdownPlugin => (ctx) => {
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
    // A prepared payload is already canonical. Use that exact source so the
    // provenance parser can consume the transported tree without invoking
    // canonicalization, Rust parsing, or the Remark pipeline again.
    if (initialDocument) {
      ctx.set(defaultValueCtx, initialDocument.canonicalSource)
      ctx.set(mdiFrontmatterCtx, initialDocument.frontmatter)
    } else {
      ctx.update(defaultValueCtx, (source) => (
        typeof source === 'string' ? canonicalizeMdiPreservingLiteralText(source) : source
      ))
    }
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
    installMdiProvenanceParser(ctx, initialDocument ? {
      source: initialDocument.canonicalSource,
      document: initialDocument.document as MarkdownNode,
    } : undefined)
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

interface MdiPluginOptions {
  initialDocument?: PreparedMdiDocument
}

export function mdi(options: MdiPluginOptions = {}): MilkdownPlugin[] {
  const initialDocument = options.initialDocument
    ? assertCompatiblePreparedMdiDocument(options.initialDocument)
    : undefined
  return [createMdiRemarkPlugin(initialDocument), ...mdiPlugins]
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
export { prepareMdiDocument } from './prepared.js'
export type { PreparedMdiDocument, StructuredCloneSafeMdast } from './prepared.js'
