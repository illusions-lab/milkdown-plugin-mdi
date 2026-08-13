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
| Blank (`[[blank]]` or `\`) | `mdiBlank` atomic block | `\` | Block |
| Pagebreak (plain, right, left) | `mdiPagebreak` atomic block with `variant` | Canonical pagebreak macro | Block |
| Indent | Paragraph attr `mdiIndent: number` | `[[indent:N]]` | Paragraph metadata |
| Bottom | Paragraph attr `mdiBottom: number` | `[[bottom]]` or `[[bottom:N]]` | Paragraph metadata |

Blank and pagebreak nodes map to semantic DOM hooks and remain selectable
atomic blocks. Pagebreak `variant` is `null`, `"right"`, or `"left"`. Indent
and bottom stay attached to their paragraph when its text is edited. A bare
`[[bottom]]` is represented by `mdiBottom: 0`.

Pagebreak variants serialize as `[[pagebreak]]`, `[[pagebreak:right]]`, and
`[[pagebreak:left]]`, respectively.

The upstream MDI parser decides grammar validity, numeric limits, and canonical
spelling. Invalid syntax remains literal text. Other unknown mdast extension
nodes continue to fall back to editable literal Markdown so that one unknown
construct does not prevent the document from loading.
