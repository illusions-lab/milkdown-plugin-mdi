# Changelog

## 0.5.2 - 2026-09-04

- Map complete block spans assembled from multiple inline provenance segments.
- Preserve exact editor offsets when a block mixes plain text with marks or MDI annotations.

## 0.5.1 - 2026-09-03

- Add explicit rich and literal-text clipboard slice canonicalization.
- Keep MDI- and Markdown-looking literal text unchanged after save and reopen.
- Preserve supported rich document semantics and provenance mapping while filtering unsupported styling.

## 0.4.2 - 2026-08-19

- Keep tate-chu-yoko as a native inline box so vertical writing does not create an empty line-sized gap before the combined glyphs.

## 0.4.1 - 2026-08-19

- Canonicalize the initial MDI source before the provenance parser is installed, so source-coordinate mappings remain available for documents with compact GFM table syntax.

## 0.4.0 - 2026-08-14

- Replace source/editor text and traversal heuristics with transient Rust-owned mdast provenance.
- Add batch source-span mapping through one `resolveMdiSourceSpans()` call.
- Reject every editor-state-stale mapping snapshot, including after undo/redo.
- Complete typed editing acceptance and reject structurally impossible commands without mutation.
- Complete opt-in input/clipboard families, MIME fallbacks, history, and duplicate-registration handling.

## 0.3.0 - 2026-08-13

- Add exact-source MDI UTF-8 source-span to ProseMirror range mapping snapshots.
- Add typed, schema-safe commands and selection inspection for every supported MDI construct.
- Add independently registerable MDI input rules and semantic clipboard conversion with lossless fallback.
- Require `@illusions-lab/mdi` 2.0.20 for authoritative inverse source-span resolution.

## 0.2.0 - 2026-08-13

- Add semantic Milkdown block schemas for MDI blank lines and plain, right, and left pagebreaks.
- Extend CommonMark paragraphs with round-trippable indent and bottom layout attributes.
- Add stable semantic DOM hooks and logical CSS for blank, pagebreak, indent, and bottom presentation.
- Keep invalid MDI source under upstream parser control and preserve unknown mdast extensions as literal editable text.
- Require Milkdown 7.21.3 or newer, including `@milkdown/preset-commonmark`, and align `mdast-util-mdi` with the verified block bridge contract.
- Expand the English and Japanese documentation, editor showroom, kitchen-sink fixture, minimum-peer consumer, and cross-browser tests.
- Keep the public API limited to `getMdi`, `initializeMdi`, and `mdi`; commands and clipboard behavior remain out of scope.

## 0.1.0 - 2026-08-04

First public release.

- Add Milkdown schemas for group and split ruby, tate-chu-yoko, boten, no-break, warichu, kern, explicit breaks, and GFM deletion.
- Preserve YAML front matter outside the editable body and restore it through `getMdi()`.
- Canonicalize complete persisted source with the Rust-owned MDI serializer.
- Preserve unsupported block syntax as editable literal Markdown.
- Provide semantic DOM and CSS hooks for horizontal and vertical writing.
- Keep parsing, text projection, text blocks, search, indexing, and AI policy in `@illusions-lab/mdi` and application code.
- Require the stable MDI text-block projection contract and document direct `getMdiTextBlocks()` integration without adding a plugin proxy API.
- Verify unit, malformed-input, deterministic fuzz, performance, tarball, minimum-peer, browser, and documentation contracts.
## 0.5.0

- Represent semantic MDI blank lines as editable paragraph nodes.
- Preserve legacy blank DOM on import while emitting `<p class="mdi-blank">`.
- `insertBlank`, input rules, and clipboard parsing now produce text selections.
