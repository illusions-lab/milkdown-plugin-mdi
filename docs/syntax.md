# MDI syntax

The supported syntax families are planned to include:

| Feature | Example |
| --- | --- |
| Ruby | `{漢字|かんじ}` |
| Tate-chu-yoko | `^12^` |
| No-break | `[[no-break:固有名詞]]` |
| Kern | `[[kern:0.1em:本文]]` |
| Explicit break | `[[br]]` |
| Blank paragraph | `[[blank]]` |

Each syntax family must have parser, editor, serializer, clipboard, and round-trip tests before it is considered stable.
