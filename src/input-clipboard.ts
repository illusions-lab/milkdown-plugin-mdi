import { parse, renderHtml } from '@illusions-lab/mdi'
import type { Ctx, MilkdownPlugin } from '@milkdown/ctx'
import { inputRulesCtx, parserCtx, prosePluginsCtx, schemaCtx, serializerCtx } from '@milkdown/core'
import { InputRule } from '@milkdown/prose/inputrules'
import { Fragment, Slice, type Node as ProseNode } from '@milkdown/prose/model'
import { Plugin, TextSelection } from '@milkdown/prose/state'
import {
  canonicalizeMdiPreservingLiteralText,
  canonicalizeMdiSource,
} from './literal-text.js'

export const MDI_CLIPBOARD_MIME = 'application/x-illusion-markdown;version=2.0'
export const MDI_CLIPBOARD_SLICE_MIME = 'application/x-illusion-markdown-slice;version=2'
export const MDI_CLIPBOARD_SLICE_V1_MIME = 'application/x-illusion-markdown-slice;version=1'

export interface MdiClipboardParseOptions {
  /** Accept an ordinary MDI/Markdown document even when it has no MDI-only construct. */
  explicit?: boolean
}

export interface MdiClipboardCanonicalizeOptions {
  /**
   * The explicit clipboard representation that produced the slice. Both paths
   * rebuild through canonical MDI; literal text is marked before serialization
   * so syntax-looking text cannot gain semantics on reopen.
   */
  source: 'rich' | 'literal-text'
}

export interface MdiClipboardSlicePayload {
  readonly version: 2
  readonly contentKind: 'inline' | 'block'
  readonly mdi: string
  readonly startAncestors: readonly string[]
  readonly endAncestors: readonly string[]
}

const MDI_NODE_TYPES = new Set([
  'comment', 'ruby', 'tcy', 'break', 'em', 'noBreak', 'warichu', 'kern', 'blank', 'pagebreak',
])

const containsMdi = (result: ReturnType<typeof parse>) => {
  const visit = (node: { type: string; children?: unknown[]; indent?: unknown; bottom?: unknown }): boolean => (
    MDI_NODE_TYPES.has(node.type)
    || typeof node.indent === 'number'
    || typeof node.bottom === 'number'
    || node.children?.some((child) => visit(child as typeof node)) === true
  )
  return result.document.children.some((node) => visit(node))
}

const parsedSlice = (ctx: Ctx, source: string, options: MdiClipboardParseOptions = {}) => {
  const result = parse(source, { includeComments: true })
  if (result.diagnostics.some(({ code }) => code === 'mdi.version.unsupported')) return null
  if (!options.explicit && !containsMdi(result)) return null
  const canonical = canonicalizeMdiPreservingLiteralText(source)
  const doc = ctx.get(parserCtx)(canonical)
  return new Slice(doc.content, 0, 0)
}

/** Parse MDI clipboard text through Rust and the registered Milkdown schema. */
export const parseMdiClipboard = (source: string, options?: MdiClipboardParseOptions) =>
  (ctx: Ctx): Slice | null => {
    try {
      return parsedSlice(ctx, source, options)
    } catch {
      return null
    }
  }

const documentForSlice = (ctx: Ctx, slice: Slice): ProseNode | null => {
  const schema = ctx.get(schemaCtx)
  const direct = schema.topNodeType.createAndFill(null, slice.content)
  if (direct) return direct
  const paragraph = schema.nodes.paragraph?.createAndFill(null, slice.content)
  return paragraph ? schema.topNodeType.createAndFill(null, paragraph) : null
}

const openDepth = (node: ProseNode | null | undefined, fromEnd: boolean): number => {
  if (!node || !node.content.size) return 0
  const child = fromEnd ? node.lastChild : node.firstChild
  return child ? 1 + openDepth(child, fromEnd) : 0
}

const validOpenDepth = (slice: Slice, openStart: number, openEnd: number): boolean =>
  Number.isInteger(openStart) && Number.isInteger(openEnd) && openStart >= 0 && openEnd >= 0
  && openStart <= openDepth(slice.content.firstChild, false)
  && openEnd <= openDepth(slice.content.lastChild, true)

// Transport semantic roles, never implementation-dependent ProseMirror depths.
const semanticRoles: Record<string, string> = {
  paragraph: 'paragraph', heading: 'heading', blockquote: 'blockquote',
  bullet_list: 'unorderedList', ordered_list: 'orderedList', list_item: 'listItem',
  mdiWarichu: 'warichu',
  table: 'table', table_header_row: 'tableHeadRow', table_row: 'tableRow',
  table_header: 'tableHeader', table_cell: 'tableCell',
}
const ancestorPath = (slice: Slice, depth: number, end: boolean): string[] | null => {
  const path: string[] = []
  let node = end ? slice.content.lastChild : slice.content.firstChild
  for (let index = 0; index < depth; index += 1) {
    const role = node && semanticRoles[node.type.name]
    if (!role) return null
    path.push(role)
    node = end ? node!.lastChild : node!.firstChild
  }
  return path
}

export const encodeMdiClipboardSlice = (slice: Slice) => (ctx: Ctx): string | null => {
  if (!validOpenDepth(slice, slice.openStart, slice.openEnd)) return null
  const mdi = serializeMdiClipboard(slice)(ctx)
  const startAncestors = ancestorPath(slice, slice.openStart, false)
  const endAncestors = ancestorPath(slice, slice.openEnd, true)
  return mdi && startAncestors && endAncestors ? JSON.stringify({ version: 2, mdi, contentKind: slice.content.firstChild?.isInline ? 'inline' : 'block',
    startAncestors, endAncestors } satisfies MdiClipboardSlicePayload) : null
}

export const decodeMdiClipboardSlice = (source: string) => (ctx: Ctx): Slice | null => {
  try {
    const value: unknown = JSON.parse(source)
    if (!value || typeof value !== 'object') return null
    const payload = value as Record<string, unknown>
    if ((payload.version !== 1 && payload.version !== 2) || typeof payload.mdi !== 'string') return null
    let parsed = parseMdiClipboard(payload.mdi, { explicit: true })(ctx)
    if (!parsed) return null
    if (payload.version === 2 && payload.contentKind === 'inline') {
      if (parsed.content.childCount !== 1 || parsed.content.firstChild?.type.name !== 'paragraph') return parsed
      parsed = new Slice(parsed.content.firstChild.content, 0, 0)
    }
    if (payload.version === 1) {
      const start = payload.openStart as number
      const end = payload.openEnd as number
      if (!validOpenDepth(parsed, start, end)) return parsed
      // v1 predates the inline warichu node; its numeric depths are ambiguous.
      let hasWarichu = false
      parsed.content.descendants(node => { if (node.type.name === 'mdiWarichu') hasWarichu = true })
      return hasWarichu ? parsed : new Slice(parsed.content, start, end)
    }
    const start = payload.startAncestors
    const end = payload.endAncestors
    if (!Array.isArray(start) || !Array.isArray(end)
      || !start.every(role => typeof role === 'string') || !end.every(role => typeof role === 'string')) return null
    if (JSON.stringify(ancestorPath(parsed, start.length, false)) !== JSON.stringify(start)
      || JSON.stringify(ancestorPath(parsed, end.length, true)) !== JSON.stringify(end)) return parsed
    return new Slice(parsed.content, start.length, end.length)
  } catch {
    return null
  }
}

/** Serialize a PM slice to canonical interoperable MDI text. */
export const serializeMdiClipboard = (slice: Slice) => (ctx: Ctx): string | null => {
  const doc = documentForSlice(ctx, slice)
  if (!doc) return null
  try {
    return canonicalizeMdiSource(ctx.get(serializerCtx)(doc))
  } catch {
    return null
  }
}

/** Render the selected canonical content as portable, static HTML. */
export const serializeMdiClipboardHtml = (slice: Slice) => (ctx: Ctx): string | null => {
  const source = serializeMdiClipboard(slice)(ctx)
  if (source === null) return null
  const document = new DOMParser().parseFromString(renderHtml(source), 'text/html')
  const style = (element: HTMLElement, property: string, value: string) => {
    element.style.setProperty(property, value)
    if (!element.style.getPropertyValue(property)) {
      element.setAttribute('style', `${element.getAttribute('style') ?? ''};${property}:${value};`)
    }
  }
  const rules: Array<[string, Record<string, string>]> = [
    ['ruby', { 'ruby-align': 'center', 'ruby-position': 'over' }],
    ['rt', { 'font-size': '0.5em' }],
    ['.mdi-tcy', { 'text-combine-upright': 'all' }],
    ['.mdi-nobr', { 'white-space': 'nowrap', 'word-break': 'keep-all' }],
    ['.mdi-warichu-fragment', { display: 'inline-flex', 'flex-direction': 'column', 'vertical-align': 'middle' }],
    ['.mdi-warichu-line', { display: 'block', 'white-space': 'nowrap', 'min-block-size': '1em', 'line-height': '1' }],
    ['.mdi-blank', { display: 'block', 'min-height': '1em' }],
    ['.mdi-pagebreak', { 'page-break-after': 'always', 'break-after': 'page' }],
  ]
  for (const [selector, declarations] of rules) {
    document.body.querySelectorAll<HTMLElement>(selector).forEach(element => {
      for (const [property, value] of Object.entries(declarations)) style(element, property, value)
    })
  }
  document.body.querySelectorAll<HTMLElement>('.mdi-em').forEach(element => {
    const mark = element.style.getPropertyValue('--mdi-em') || 'filled sesame'
    style(element, 'text-emphasis-style', mark)
    style(element, '-webkit-text-emphasis-style', mark)
    style(element, 'text-emphasis-position', 'over right')
  })
  document.body.querySelectorAll<HTMLElement>('.mdi-kern').forEach(element => {
    style(element, 'letter-spacing', element.style.getPropertyValue('--mdi-kern'))
  })
  document.body.querySelectorAll<HTMLElement>('.mdi-indent').forEach(element => {
    const indent = Number(element.style.getPropertyValue('--mdi-indent'))
    if (Number.isFinite(indent) && indent >= 0) style(element, 'text-indent', `${indent}em`)
  })
  document.body.querySelectorAll<HTMLElement>('.mdi-warichu').forEach(element => {
    if (!element.style.fontSize) style(element, 'font-size', element.parentElement?.closest('.mdi-warichu') ? '1em' : '0.5em')
    style(element, 'line-height', '1')
    element.removeAttribute('data-mdi-warichu-source')
  })
  return document.body.innerHTML
}

/** Rebuild an interoperable PM slice through one canonical, provenance-ready source. */
export const canonicalizeMdiClipboardSlice = (
  slice: Slice,
  options: MdiClipboardCanonicalizeOptions,
) => (ctx: Ctx): Slice | null => {
  if (options.source !== 'rich' && options.source !== 'literal-text') return null
  const doc = documentForSlice(ctx, slice)
  if (!doc) return null
  try {
    const literalMark = ctx.get(schemaCtx).marks.mdiLiteral
    const visit = (fragment: Fragment): Fragment => {
      const nodes: ProseNode[] = []
      fragment.forEach((node) => {
        if (node.isText && literalMark) {
          nodes.push(node.mark(literalMark.create().addToSet(node.marks)))
        } else {
          nodes.push(node.isLeaf ? node : node.copy(visit(node.content)))
        }
      })
      return Fragment.fromArray(nodes)
    }
    // The slice structure is the only semantic authority. Mark every text leaf
    // while serializing so syntax-looking text cannot be reinterpreted as a new
    // MDI construct; existing marks and block nodes remain intact.
    const sourceDoc = doc.copy(visit(doc.content))
    const serialized = ctx.get(serializerCtx)(sourceDoc)
    const source = canonicalizeMdiPreservingLiteralText(serialized)
    const parsed = ctx.get(parserCtx)(source)
    const content = slice.content.firstChild?.isInline && parsed.childCount === 1 && parsed.firstChild?.type.name === 'paragraph'
      ? parsed.firstChild.content : parsed.content
    const parsedSlice = new Slice(content, 0, 0)
    if (!validOpenDepth(parsedSlice, slice.openStart, slice.openEnd)) return null
    return new Slice(content, slice.openStart, slice.openEnd)
  } catch {
    return null
  }
}

const semanticInlineContent = (doc: ProseNode) => {
  const first = doc.firstChild
  if (!first || first.type.name !== 'paragraph') return null
  let semantic = false
  first.descendants((node) => {
    if (node.type.name.startsWith('mdi')) semantic = true
    if (node.marks.some((mark) => mark.type.name.startsWith('mdi'))) semantic = true
  })
  return semantic ? first.content : null
}

const inlineRule = (ctx: Ctx, expression: RegExp) => new InputRule(
  expression,
  (state, match, start, end) => {
    const source = match[1]!
    try {
      const content = semanticInlineContent(ctx.get(parserCtx)(source))
      return content ? state.tr.replaceWith(start, end, content) : null
    } catch {
      return null
    }
  },
)

const blockRule = (ctx: Ctx) => new InputRule(
  /^(\[\[(?:pagebreak(?::(?:right|left))?|blank)\]\]|\\)$/,
  (state, match, _start, _end) => {
    try {
      const parsed = ctx.get(parserCtx)(match[1]!)
      const node = parsed.firstChild
      const { $from } = state.selection
      if (!node || !(node.type.name === 'mdiPagebreak' ||
        (node.type.name === 'paragraph' && node.attrs.mdiBlank === true)) || !$from.parent.isTextblock) {
        return null
      }
      const tr = state.tr.replaceWith($from.before(), $from.after(), node)
      if (node.type.name === 'paragraph') {
        tr.setSelection(TextSelection.create(tr.doc, $from.before() + 1))
      }
      return tr
    } catch {
      return null
    }
  },
)

/** Opt-in input rules. Recognition is confirmed by the official MDI parser. */
export const mdiInputRules = (): MilkdownPlugin => (ctx) => {
  const registered = inputRuleRegistrations.get(ctx)
  if (registered) {
    registered.references += 1
    return () => () => releaseInputRules(ctx)
  }
  const rules = [
    inlineRule(ctx, /(\{[^{}\n]*\|[^{}\n]*\})$/),
    inlineRule(ctx, /(\^[^^\n]+\^)$/),
    inlineRule(ctx, /(《《[^《》\n]+》》)$/),
    inlineRule(ctx, /(\[\[(?:br|em|no-break|warichu|kern)(?::[^\n]*)?\]\])$/),
    blockRule(ctx),
  ]
  inputRuleRegistrations.set(ctx, { references: 1, rules })
  ctx.update(inputRulesCtx, (current) => [...current, ...rules])
  return () => () => releaseInputRules(ctx)
}

const inputRuleRegistrations = new WeakMap<Ctx, { references: number; rules: InputRule[] }>()

const releaseInputRules = (ctx: Ctx) => {
  const registered = inputRuleRegistrations.get(ctx)
  if (!registered) return
  registered.references -= 1
  if (registered.references > 0) return
  ctx.update(inputRulesCtx, (current) => current.filter((rule) => !registered.rules.includes(rule)))
  inputRuleRegistrations.delete(ctx)
}

/** Opt-in same-editor/cross-editor MDI clipboard support with plain-text fallback. */
export const mdiClipboard = (): MilkdownPlugin => (ctx) => {
  const registered = clipboardRegistrations.get(ctx)
  if (registered) {
    registered.references += 1
    return () => () => releaseClipboard(ctx)
  }
  const plugin = new Plugin({
    props: {
      clipboardTextSerializer: (slice) => serializeMdiClipboard(slice)(ctx) ?? slice.content.textBetween(0, slice.content.size, '\n'),
      handleDOMEvents: {
        copy: (view, event) => {
          const clipboard = (event as ClipboardEvent).clipboardData
          if (!clipboard || view.state.selection.empty) return false
          const source = serializeMdiClipboard(view.state.selection.content())(ctx)
          const slice = view.state.selection.content()
          const structured = encodeMdiClipboardSlice(slice)(ctx)
          if (!source || !structured) return false
          let written = false
          try {
            clipboard.setData(MDI_CLIPBOARD_SLICE_MIME, structured)
            clipboard.setData(MDI_CLIPBOARD_MIME, source)
            written = true
          } catch {
            // Some clipboard implementations reject non-standard MIME types.
          }
          try {
            clipboard.setData('text/html', serializeMdiClipboardHtml(slice)(ctx) ?? view.serializeForClipboard(slice).dom.innerHTML)
            clipboard.setData('text/plain', source)
            written = true
          } catch {
            // Return control to the native handler if no representation worked.
          }
          if (!written) return false
          event.preventDefault()
          return true
        },
      },
      handlePaste: (view, event) => {
        const clipboard = event.clipboardData
        if (!clipboard) return false
        let structuredSource = ''
        let explicitSource = ''
        let plainSource = ''
        try {
          structuredSource = clipboard.getData(MDI_CLIPBOARD_SLICE_MIME) || clipboard.getData(MDI_CLIPBOARD_SLICE_V1_MIME)
          explicitSource = clipboard.getData(MDI_CLIPBOARD_MIME)
        } catch {
          // Fall through to interoperable text/plain.
        }
        if (!explicitSource) {
          try {
            plainSource = clipboard.getData('text/plain')
          } catch {
            return false
          }
        }
        const structured = structuredSource ? decodeMdiClipboardSlice(structuredSource)(ctx) : null
        if (structured) {
          view.dispatch(view.state.tr.replaceSelection(structured).scrollIntoView())
          return true
        }
        const source = explicitSource || plainSource
        if (!source) return false
        const slice = parseMdiClipboard(source, { explicit: Boolean(explicitSource) })(ctx)
        if (!slice) return false
        view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView())
        return true
      },
    },
  })
  clipboardRegistrations.set(ctx, { references: 1, plugin })
  ctx.update(prosePluginsCtx, (plugins) => [...plugins, plugin])
  return () => () => releaseClipboard(ctx)
}

const clipboardRegistrations = new WeakMap<Ctx, { references: number; plugin: Plugin }>()

const releaseClipboard = (ctx: Ctx) => {
  const registered = clipboardRegistrations.get(ctx)
  if (!registered) return
  registered.references -= 1
  if (registered.references > 0) return
  ctx.update(prosePluginsCtx, (plugins) => plugins.filter((item) => item !== registered.plugin))
  clipboardRegistrations.delete(ctx)
}
