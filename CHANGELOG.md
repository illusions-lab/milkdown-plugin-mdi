# Changelog

## 0.2.0 - 2026-08-12

- Add semantic blank paragraph and pagebreak block schemas.
- Preserve MDI indent and bottom paragraph attributes through editor round-trips.
- Add structured Ruby insertion and TCY toggle commands.
- Add an MDI-aware plain-text clipboard serializer.
- Update the MDI remark and mdast adapter dependencies for complete MDI 2.0 block support.
- Require Milkdown 7.21.3 or newer for the paragraph schema extension contract.

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
