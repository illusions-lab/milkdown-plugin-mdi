# API

```ts
import {
  createMdiEditorMapping,
  getMdi,
  mapMdiSourceSpanToCurrentEditorRanges,
  mapMdiSourceSpansToEditorRanges,
  mdi,
  mdiClipboard,
  mdiEditCommand,
  mdiInputRules,
  prepareMdiDocument,
  type PreparedMdiDocument,
  type StructuredCloneSafeMdast,
} from '@illusions-lab/milkdown-plugin-mdi'
```

## `initializeMdi()`

Initializes the MDI JavaScript binding used by the parser and canonical serializer. In browser applications, await it before creating a Milkdown editor. This package re-exports it from `@illusions-lab/mdi`.

## `prepareMdiDocument(source)`

Completes the Rust parse, canonicalization, and Milkdown mdast normalization in
the current execution context and returns `Promise<PreparedMdiDocument>`. For a
large initial document, call it in a module Worker after `initializeMdi()` and
send the result to the renderer with `postMessage()`.

```ts
interface PreparedMdiDocument {
  version: 1
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
```

The object contains only structured-clone-safe data. Diagnostics describe the
original input; mdast provenance describes `canonicalSource`. Keep the original
source separately when an application needs to display an error or offer a
source-safe editing mode.

## `mdi(options?)`

Returns Milkdown plugins that register the MDI remark adapter, inline schemas,
blank/pagebreak block schemas, and an extended CommonMark paragraph schema for
indent/bottom attributes. Use it alongside Milkdown's CommonMark preset.

Pass `{ initialDocument: prepared }` to build the initial ProseMirror document
from a `PreparedMdiDocument`. This path validates the transport, MDI IR, and
provenance versions, and fails explicitly when they are incompatible. It does
not canonicalize the source, call the Rust parser, or run Remark parsing again.
The plugin rebuilds its transient provenance map while schema-bound
ProseMirror nodes are created.

```ts
// module Worker
import {
  initializeMdi,
  prepareMdiDocument,
} from '@illusions-lab/milkdown-plugin-mdi/prepared'

await initializeMdi()
postMessage(await prepareMdiDocument(source))

// renderer
const editor = await Editor.make()
  .use(commonmark)
  .use(mdi({ initialDocument: prepared }))
  .create()
```

The `./prepared` subpath is the Worker-safe entrypoint. It does not load
Milkdown, ProseMirror, or their DOM-only modules. The same functions remain
available from the package root for backward-compatible renderer usage.

`mdi()` without options remains backward compatible. Later edits, paste, and
serialization retain the existing synchronous behavior. Applications should
surface preparation and version errors instead of synchronously reparsing on
the renderer thread.

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

Use `mapMdiSourceSpansToEditorRanges(snapshot, spans)` for multiple spans. It
calls Rust's batch `resolveMdiSourceSpans()` once, then joins each canonical
target to the transient `mdiProvenance` captured while the mdast-to-ProseMirror
bridge built the document. It never associates nodes by editor text, substring
search, DOM traversal, or source order. A snapshot becomes stale after every
editor-state transaction, including undo and redo.

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

Ruby apply/update selects the atomic ruby node; removing ruby selects the
restored base-text range. Ranged mark operations retain their text selection,
while collapsed non-TCY marks use ordinary stored marks (TCY requires a valid
one-to-six-character range). Break/block insertion and paragraph-layout
commands use ProseMirror's normal mapped selection. Every dispatched command
is a normal history transaction, so undo and redo restore both document and
selection through ProseMirror rather than plugin-owned state.

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
Unsupported MDI source versions are rejected. If a clipboard implementation
does not accept the custom MIME entry, copy still writes interoperable
`text/plain`; missing, malformed, and unknown MIME entries stay on the native
fallback path. Repeated plugin registration is deduplicated per editor context.

For application-controlled flows, use `parseMdiClipboard()` and
`serializeMdiClipboard()` directly.

## Intentionally absent APIs

This package does not provide `getMdiIR()`, `getMdiText()`, `getMdiTextBlocks()`, or search APIs. Parsing, text projection, text blocks, diagnostics, and source maps are MDI responsibilities and must be accessed directly through `@illusions-lab/mdi`.

The mapping API consumes upstream analysis results but does not proxy or rebuild
them.

### Editable warichu schema migration (0.7)

Warichu is an inline node with editable inline children and a single content DOM.
Use `{ type: 'setWarichu' }` and `{ type: 'removeWarichu' }` with `mdiEditCommand`.
The legacy `setInlineMark` / `removeInlineMark` operations with `mark: 'warichu'`
forward to the same commands. `inspectMdiSelection(state).marks.warichu` remains
available, including an insertion point inside the annotation. Removing warichu
unwraps its content. Canonical MDI remains the portable representation; to migrate
saved ProseMirror JSON, serialize it using the old schema before loading the MDI
with this version. Old JSON cannot be loaded directly into the new schema.

Structured clipboard v2 records semantic ancestor paths. The decoder accepts v1;
when numeric depths cannot be safely interpreted after schema migration, it uses
the canonical MDI document. The default plain clipboard representation remains
canonical MDI.

`serializeMdiClipboardHtml(slice)(ctx)` returns the selected source as a static
HTML fragment with inline ruby, emphasis, no-break, warichu, blank and print
styles. No editor geometry or duplicated editable content is included. v2
`contentKind` distinguishes closed inline slices from block slices.

Presentation measures actual advances without overriding author tracking.
Resizing and font/writing-mode changes call Rust again; nested note and ruby
heights expand their containing row and retain zero added row spacing.
During composition only source edits are applied; positions stay frozen until
composition ends. Enter emits `mdi-warichu-auto-layout` and a visible live status.
