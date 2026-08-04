# Changelog

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
