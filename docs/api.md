# API

```ts
import {
  getMdi,
  initializeMdi,
  insertMdiRubyCommand,
  mdi,
  mdiClipboardSerializer,
  toggleMdiTcyCommand,
} from '@illusions-lab/milkdown-plugin-mdi'
```

## `initializeMdi()`

Initializes the MDI JavaScript binding used by the parser and canonical serializer. In browser applications, await it before creating a Milkdown editor. This package re-exports it from `@illusions-lab/mdi`.

## `mdi()`

Returns Milkdown plugins that register the MDI remark adapter, semantic schema,
commands, and plain-text clipboard serializer. Use it alongside Milkdown's
CommonMark preset.

## Editor commands

`insertMdiRubyCommand` inserts an atomic Ruby node from a structured
`{ base, ruby }` payload. `toggleMdiTcyCommand` toggles the TCY mark on the
current selection. Call them through Milkdown's `commandsCtx`; applications do
not need to build or parse MDI delimiters.

`mdiClipboardSerializer` is installed by `mdi()` and writes semantic plain text
for selected MDI content. Rich HTML clipboard serialization remains owned by
Milkdown and ProseMirror.

## `getMdi()`

Returns a Milkdown action that serializes the current body, restores stored front matter, and canonicalizes the complete source. Use `editor.action(getMdi())` for `.mdi` persistence. For body-only Markdown, use `getMarkdown()` from `@milkdown/utils` instead.

The returned source is also the supported input for `parse()`, `renderText()`, `getMdiTextBlocks()`, and other analysis APIs imported directly from `@illusions-lab/mdi`.

```ts
import { getMdiTextBlocks } from '@illusions-lab/mdi'

const source = editor.action(getMdi())
const { blocks } = getMdiTextBlocks(source)
```

Text-block ranges belong to that exact `source` revision. Store a revision or hash alongside them; this plugin does not make ranges stable across editor changes.

## Intentionally absent APIs

This package does not provide `getMdiIR()`, `getMdiText()`, `getMdiTextBlocks()`, or search APIs. Parsing, text projection, text blocks, diagnostics, and source maps are MDI responsibilities and must be accessed directly through `@illusions-lab/mdi`. The plugin public API remains limited to Milkdown integration, editor commands, clipboard behavior, and complete canonical source extraction.
