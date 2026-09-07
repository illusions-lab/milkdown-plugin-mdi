# @illusions-lab/milkdown-plugin-mdi

## 0.5.0 migration

Semantic blank lines are now native editable `paragraph` nodes with an internal
`mdiBlank` attribute. Consumers should treat them as ordinary textblocks: the
public commands, input rules, and clipboard APIs produce `TextSelection`, and
the attribute is not part of the public application contract. Legacy blank
`div` DOM is still accepted and is emitted as `<p class="mdi-blank">`.

MDI syntax support for [Milkdown](https://milkdown.dev/), built for Japanese novel and long-form writing workflows.

The plugin supports document front matter, all inline MDI constructs, semantic
blank and pagebreak blocks, and indent/bottom paragraph layout attributes.

## MDI documentation

MDI's specification and complete syntax live in the official documentation:

- [What is MDI?](https://mdi.illusions.app/learn/what-is-mdi/)
- [Syntax reference](https://mdi.illusions.app/syntax/reference/)

## Goals

- Parse inline and supported block MDI constructs into ProseMirror nodes, marks, and paragraph attributes.
- Preserve nested inline semantics through Milkdown's Markdown serializer.
- Produce canonical persistence output through Rust's MDI serializer.
- Keep document semantics independent from visual writing direction.

## Installation

```bash
npm install @illusions-lab/milkdown-plugin-mdi @milkdown/core @milkdown/ctx @milkdown/preset-commonmark @milkdown/prose @milkdown/utils
```

## Usage

```ts
import { Editor } from '@milkdown/core'
import { commonmark } from '@milkdown/preset-commonmark'
import {
  createMdiEditorMapping,
  getMdi,
  initializeMdi,
  mdi,
  mdiClipboard,
  mdiInputRules,
} from '@illusions-lab/milkdown-plugin-mdi'
import '@illusions-lab/milkdown-plugin-mdi/style.css'

await initializeMdi()

const editor = await Editor.make()
  .use(commonmark)
  .use(mdi())
  // Optional authoring behavior:
  .use([mdiInputRules(), mdiClipboard()])
  .create()

const canonicalSource = editor.action(getMdi())
```

### Preparing large initial documents in a Worker

`0.7.0` adds a structured-clone-safe initial-document path. Run the complete
Rust parse and mdast normalization in a module Worker, then give Milkdown the
prepared result. The initial editor build validates all transport versions and
does not canonicalize or parse the source again.

```ts
// Worker
import {
  initializeMdi,
  prepareMdiDocument,
} from '@illusions-lab/milkdown-plugin-mdi/prepared'

await initializeMdi()
const prepared = await prepareMdiDocument(source)
postMessage(prepared)

// Renderer (after receiving the Worker message)
const editor = await Editor.make()
  .use(commonmark)
  .use(mdi({ initialDocument: prepared }))
  .create()
```

Use the `./prepared` entrypoint inside a Worker. It intentionally excludes
Milkdown, ProseMirror, and their DOM-only modules.

Treat an incompatible prepared-document error as an open failure. Do not fall
back to synchronous initial parsing on the UI thread. Calling `mdi()` without
options remains supported for small documents and for synchronous editing,
paste, and serialization behavior.

Browser consumers must await `initializeMdi()` before creating the editor. It is idempotent and safe to call more than once.

`getMarkdown()` from `@milkdown/utils` emits valid MDI through the registered remark handlers. Use `getMdi()` when persisting a `.mdi` file: it additionally runs the Markdown through Rust's canonical serializer.

Treat that complete canonical source as the boundary for downstream MDI analysis. Import analysis APIs from `@illusions-lab/mdi` directly; this plugin does not proxy IR, text projection, text blocks, or search APIs.

```ts
import { getMdiTextBlocks, parse, renderText } from '@illusions-lab/mdi'

const source = editor.action(getMdi())
const ir = parse(source)
const text = renderText(source)
const { blocks } = getMdiTextBlocks(source)
```

`getMdiTextBlocks()` returns Rust-owned source-order blocks, diagnostics, ruby annotations, and grapheme-precise source maps. A coordinate such as `3:18` is valid only for the exact source revision that produced it. Applications own the revision or hash, persistent paragraph IDs, indexes, ranking, and AI context policy.

## Scope

The plugin supports YAML front matter, group and split ruby, tate-chu-yoko,
boten, no-break, warichu, kern, explicit breaks, blank blocks, pagebreaks,
indent/bottom paragraph layout, and valid nesting. Front matter is retained as
document metadata rather than displayed as editable body content. Ruby and the
standalone block constructs are atomic; the other text constructs remain
editable marks.

Typed transaction primitives and opt-in MDI input/clipboard plugins are
included. They do not install keybindings, menus, confirmations, or other
product UX. The package does not impose vertical writing or
application-specific file-extension logic. Use
`@illusions-lab/milkdown-plugin-vertical-writing` for visual writing direction.

Source-coordinate consumers can create an immutable mapping snapshot with
`createMdiEditorMapping()`. It binds Rust-owned UTF-8 spans and canonical
grapheme ranges to the exact current ProseMirror document through transient
Rust mdast provenance captured by the parse bridge. Batch lookups use
`mapMdiSourceSpansToEditorRanges()` and one Rust resolution pass. No editor-text,
substring, DOM, or source-order association is used. After any editor-state
transaction, including undo/redo, create a new snapshot instead of reusing
stale positions.

## Development

```bash
npm install
npm test
npm run test:coverage
npm run typecheck
npm run test:browser
npm run test:tarball
npm run test:consumer
```

Run `npm run test:performance` on a dedicated machine to measure end-to-end editor loading for generated one-million- and ten-million-character MDI books. The test logs elapsed time and uses conservative default limits; set `MDI_1M_LOAD_MAX_MS` or `MDI_10M_LOAD_MAX_MS` to apply your own regression budget.

Run `npm run test:browser:performance` to measure the same documents in Chromium, Firefox, and WebKit. It additionally records time to two animation frames after editor creation and time to scroll to the document end. Configure browser load limits with `MDI_BROWSER_1M_LOAD_MAX_MS` and `MDI_BROWSER_10M_LOAD_MAX_MS`.

`test:browser` uses Chromium for quick local feedback. Run `npm run test:browser:all`
after installing Playwright's three browser engines to exercise Chromium, Firefox, and WebKit.

## Contributing

Please read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening an issue or pull request.

## License

MIT © Iktahana

### Automatic warichu

Warichu uses an editable inline node with one ProseMirror content DOM. Rust
chooses the two-row fragments; browser measurements position existing editable
text and reserve space with empty, inaccessible widgets. Note glyphs stay at
50% of body size in horizontal and vertical writing. Nested annotations and
ruby can increase a row's block extent; adjacent rows have no added gap.
Automatic visual boundaries never become `[[br]]` or document edits.

Use `mdiEditCommand({ type: 'setWarichu' })` and
`mdiEditCommand({ type: 'removeWarichu' })`; legacy warichu mark operations and
`inspectMdiSelection(state).marks.warichu` remain available. IME composition
freezes geometry; Enter outside composition announces automatic layout.

`serializeMdiClipboardHtml(slice)(ctx)` returns portable static HTML for the
selection. Clipboard v2 carries semantic ancestor paths and inline/block shape;
v1 remains readable with canonical-MDI fallback where depths are ambiguous.
Migrate saved ProseMirror JSON through the old schema's canonical MDI serializer
before upgrading; canonical MDI documents need no migration. Exact proportional
font balancing and native OS IME coverage are not claimed by synthetic browser
tests.
