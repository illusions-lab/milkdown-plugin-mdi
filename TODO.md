## Goal

Extract MDI document support from the existing Japanese-novel editor integration into a standalone, reusable Milkdown plugin.

## Roadmap

- [ ] Define the public `mdi(options)` API and feature flags
- [ ] Move `MdiDocument` into the package and document its raw/editor/export boundaries
- [ ] Move MDI remark plugins and ProseMirror node schemas
  - [ ] Ruby
  - [ ] Tate-chu-yoko
  - [ ] No-break
  - [ ] Kern
  - [ ] Explicit break
  - [ ] Blank paragraph
  - [ ] Frontmatter
- [ ] Add Markdown/MDI round-trip tests for every syntax family
- [ ] Add clipboard serialization tests, including disabled-feature behavior
- [ ] Ensure MDI support is independent from vertical writing
- [ ] Add generated declarations and a build pipeline
- [ ] Add package metadata and publish workflow
- [ ] Add compatibility documentation for Milkdown 7.x
- [ ] Migrate the illusions app to the standalone package
- [ ] Publish the first stable release

## Acceptance criteria

- MDI documents round-trip without losing supported syntax.
- Non-MDI Markdown and plain-text content remain unchanged when MDI is disabled.
- The package can be used without importing the vertical-writing package.
- CI covers type checking and the complete syntax/serializer test matrix.
