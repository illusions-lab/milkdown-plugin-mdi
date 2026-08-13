# Changelog

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
