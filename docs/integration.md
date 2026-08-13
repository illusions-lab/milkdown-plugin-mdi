# Integration

## The persistence boundary

`getMarkdown()` from `@milkdown/utils` serializes the editable editor body through Milkdown's registered handlers. `getMdi()` from this package additionally restores retained front matter and runs the result through MDI's canonical serializer.

Use `getMdi()` to persist `.mdi` documents and before handing editor content to MDI analysis APIs. It is the persistence boundary between the mutable Milkdown state and a complete document source. Canonical output can normalize equivalent source forms, so persist its result rather than assuming the original spelling is retained.

```ts
import { getMarkdown } from '@milkdown/utils'
import { getMdi } from '@illusions-lab/milkdown-plugin-mdi'

const markdown = editor.action(getMarkdown())
const canonicalMdi = editor.action(getMdi())
```

## Parsing and text projection

Call `@illusions-lab/mdi` directly for document parsing and plain-text projection. Always pass the complete canonical source returned by `getMdi()`, rather than the body-only result from `getMarkdown()`.

```ts
import { getMdiTextBlocks, parse, renderText } from '@illusions-lab/mdi'
import { getMdi } from '@illusions-lab/milkdown-plugin-mdi'

const source = editor.action(getMdi())
const ir = parse(source)
const text = renderText(source)
const { blocks } = getMdiTextBlocks(source)
```

`parse()` retains document front matter in its result. `renderText()` projects body text and does not mix front matter into it. `getMdiTextBlocks()` returns the complete Rust-owned projection envelope: document, diagnostics, source-order blocks, source maps, and ruby-reading annotations. Front matter remains metadata and does not create a body block.

For search and AI workflows, index `blocks` directly rather than splitting `renderText()` or walking the IR in application code. A coordinate such as `3:18` uses one-based Unicode grapheme positions and is valid only for the exact canonical source revision that produced it. Store a revision or content hash with coordinates. Applications own persistent paragraph IDs, indexes, ranking, retrieval, and AI context policy.

This package does not export `getMdiIR()`, `getMdiText()`, `getMdiTextBlocks()`, or any search API. Those would duplicate the public contract owned by MDI. Applications also own revision tracking, persistent identifiers, indexes, ranking, and AI context policy.

## Front matter

YAML front matter is removed before the editable ProseMirror body is created. It is retained as editor metadata and is restored only by `getMdi()`; `getMarkdown()` returns the body without it.

## Styling hooks

Import `@illusions-lab/milkdown-plugin-mdi/style.css` for the default presentation. Stable CSS hooks include `mdi-ruby`, `mdi-tcy`, `mdi-boten`, `mdi-no-break`, `mdi-warichu`, `mdi-kern`, `mdi-break`, `mdi-blank`, `mdi-pagebreak`, `mdi-indent`, and `mdi-bottom`.

Block semantic DOM uses `data-mdi-blank`, `data-mdi-pagebreak`, optional
`data-mdi-variant`, `data-mdi-indent`, and `data-mdi-bottom`. The default
stylesheet gives blank blocks a logical one-em minimum size, applies paged
media breaks (including right/left variants), adds logical block-start indent
spacing, and aligns bottom paragraphs with an optional logical offset.

## Optional authoring behavior

`mdi()` installs schema and persistence support only. Register
`mdiInputRules()` and/or `mdiClipboard()` explicitly when direct syntax entry or
semantic MDI copy/paste fits the product. Typed commands are exported through
`mdiEditCommand()` without installing menus, keybindings, dialogs, or selection
policy.

Source/editor mappings are immutable snapshots. Recompute both upstream MDI
analysis and `createMdiEditorMapping()` after a document change, including
undo/redo; stale snapshots are rejected by the current-editor mapping action.
