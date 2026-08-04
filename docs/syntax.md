# Syntax Support

This page describes editor integration, not the MDI grammar. Consult the official [syntax reference](https://mdi.illusions.app/syntax/reference/) and [showcase](https://mdi.illusions.app/syntax/showcase/) for syntax definitions, limits, and escaping rules.

| MDI feature | Editor representation | Serialization | Nesting |
| --- | --- | --- | --- |
| YAML front matter | Metadata; not in body | Restored by `getMdi()` | — |
| Ruby (group and split) | Atomic inline node | Canonical MDI | Supported inside supported marks |
| Tate-chu-yoko | Editable mark | Canonical MDI | Supported |
| Boten | Editable mark | Canonical MDI | Supported |
| No-break | Editable mark | Canonical MDI | Supported |
| Warichu | Editable mark | Canonical MDI | Supported |
| Kern | Editable mark | Canonical MDI | Supported |
| Explicit break | Inline leaf node | Canonical MDI | Inline context |

Block MDI constructs and other unsupported mdast extension nodes are not editor features in this milestone. They fall back to editable literal Markdown text so that one unsupported construct does not prevent the rest of a document from loading. This is preservation-oriented fallback, not a claim of complete block-MDI support.
