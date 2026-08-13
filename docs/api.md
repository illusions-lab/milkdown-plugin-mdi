# API

```ts
import {
  createMdiEditorMapping,
  getMdi,
  mapMdiSourceSpanToCurrentEditorRanges,
  mdi,
  mdiClipboard,
  mdiEditCommand,
  mdiInputRules,
} from '@illusions-lab/milkdown-plugin-mdi'
```

## `initializeMdi()`

Initializes the MDI JavaScript binding used by the parser and canonical serializer. In browser applications, await it before creating a Milkdown editor. This package re-exports it from `@illusions-lab/mdi`.

## `mdi()`

Returns Milkdown plugins that register the MDI remark adapter, inline schemas,
blank/pagebreak block schemas, and an extended CommonMark paragraph schema for
indent/bottom attributes. Use it alongside Milkdown's CommonMark preset.

## `getMdi()`

Returns a Milkdown action that serializes the current body, restores stored front matter, and canonicalizes the complete source. Use `editor.action(getMdi())` for `.mdi` persistence. For body-only Markdown, use `getMarkdown()` from `@milkdown/utils` instead.

The returned source is also the supported input for `parse()`, `renderText()`, `getMdiTextBlocks()`, and other analysis APIs imported directly from `@illusions-lab/mdi`.

```ts
import { getMdiTextBlocks } from '@illusions-lab/mdi'

const source = editor.action(getMdi())
const { blocks } = getMdiTextBlocks(source)
```

Text-block ranges belong to that exact `source` revision. Store a revision or hash alongside them; this plugin does not make ranges stable across editor changes.

## Source span → editor range

`createMdiEditorMapping()` returns an action that captures the exact canonical
source and ProseMirror document. Map a Rust-owned UTF-8 span only through that
snapshot:

```ts
const snapshot = editor.action(createMdiEditorMapping())
const result = editor.action(
  mapMdiSourceSpanToCurrentEditorRanges(snapshot, diagnostic.span),
)

if (result.reason === 'stale') {
  // The document changed. Recompute source analysis and the snapshot together.
}
```

`matches` distinguishes block text and ruby annotations. Synthetic projection
text and source syntax without an editor representation return an explicit
unmapped result. The mapping API never creates decorations or mutates history.

## Typed editing

`mdiEditCommand(operation)` returns a standard ProseMirror command. Operations
cover ruby, TCY, boten, no-break, warichu, kern, explicit breaks, blank and
pagebreak blocks, and paragraph indent/bottom layout. Use
`canApplyMdiEdit()` for enablement and `inspectMdiSelection()` for UI state.

```ts
const command = mdiEditCommand({ type: 'setRuby', reading: 'とうきょう' })
editor.action((ctx) => {
  const view = ctx.get(editorViewCtx)
  command(view.state, view.dispatch, view)
})
```

Invalid values or structurally impossible operations return `false` and leave
the document unchanged.

## Opt-in input and clipboard

Neither behavior is enabled by `mdi()`:

```ts
Editor.make()
  .use(commonmark)
  .use(mdi())
  .use([mdiInputRules(), mdiClipboard()])
```

Input-rule candidates are confirmed through the official parser. Clipboard
copy emits canonical MDI in `text/plain` and a versioned MDI MIME entry; paste
uses semantic conversion only for explicit MDI data or recognized MDI syntax.
Ordinary or unsupported content falls through to ProseMirror unchanged.

For application-controlled flows, use `parseMdiClipboard()` and
`serializeMdiClipboard()` directly.

## Intentionally absent APIs

This package does not provide `getMdiIR()`, `getMdiText()`, `getMdiTextBlocks()`, or search APIs. Parsing, text projection, text blocks, diagnostics, and source maps are MDI responsibilities and must be accessed directly through `@illusions-lab/mdi`.

The mapping API consumes upstream analysis results but does not proxy or rebuild
them.
