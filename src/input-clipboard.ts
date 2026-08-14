import { parse, serializeMdi } from '@illusions-lab/mdi'
import type { Ctx, MilkdownPlugin } from '@milkdown/ctx'
import { inputRulesCtx, parserCtx, prosePluginsCtx, schemaCtx, serializerCtx } from '@milkdown/core'
import { InputRule } from '@milkdown/prose/inputrules'
import { Slice, type Node as ProseNode } from '@milkdown/prose/model'
import { Plugin } from '@milkdown/prose/state'

export const MDI_CLIPBOARD_MIME = 'application/x-illusion-markdown;version=2.0'

export interface MdiClipboardParseOptions {
  /** Accept an ordinary MDI/Markdown document even when it has no MDI-only construct. */
  explicit?: boolean
}

const MDI_NODE_TYPES = new Set([
  'ruby', 'tcy', 'break', 'em', 'noBreak', 'warichu', 'kern', 'blank', 'pagebreak',
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
  const result = parse(source)
  if (result.diagnostics.some(({ code }) => code === 'mdi.version.unsupported')) return null
  if (!options.explicit && !containsMdi(result)) return null
  const canonical = serializeMdi(source)
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

/** Serialize a PM slice to canonical interoperable MDI text. */
export const serializeMdiClipboard = (slice: Slice) => (ctx: Ctx): string | null => {
  const doc = documentForSlice(ctx, slice)
  if (!doc) return null
  try {
    return serializeMdi(ctx.get(serializerCtx)(doc))
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
      if (!node || !['mdiPagebreak', 'mdiBlank'].includes(node.type.name) || !$from.parent.isTextblock) {
        return null
      }
      return state.tr.replaceWith($from.before(), $from.after(), node)
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
          if (!source) return false
          let written = false
          try {
            clipboard.setData(MDI_CLIPBOARD_MIME, source)
            written = true
          } catch {
            // Some clipboard implementations reject non-standard MIME types.
          }
          try {
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
        let explicitSource = ''
        let plainSource = ''
        try {
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
