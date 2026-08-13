# 構文サポート

このページはエディター統合を説明するものであり、MDI 文法の定義ではありません。構文、制限、エスケープ規則は公式の[構文リファレンス](https://mdi.illusions.app/ja/syntax/reference/)と[ショーケース](https://mdi.illusions.app/ja/syntax/showcase/)を参照してください。

| MDI 機能 | エディター表現 | シリアライズ | ネスト |
| --- | --- | --- | --- |
| YAML front matter | 本文外のメタデータ | `getMdi()` が復元 | — |
| Ruby（group / split） | Atomic inline node | Canonical MDI | 対応 mark 内で可 |
| Tate-chu-yoko | 編集可能な mark | Canonical MDI | 対応 |
| Boten | 編集可能な mark | Canonical MDI | 対応 |
| No-break | 編集可能な mark | Canonical MDI | 対応 |
| Warichu | 編集可能な mark | Canonical MDI | 対応 |
| Kern | 編集可能な mark | Canonical MDI | 対応 |
| Explicit break | Inline leaf node | Canonical MDI | インライン文脈 |
| Blank（`[[blank]]` / `\`） | `mdiBlank` atomic block | `\` | Block |
| Pagebreak（plain / right / left） | `variant` を持つ `mdiPagebreak` atomic block | Canonical pagebreak macro | Block |
| Indent | paragraph attr `mdiIndent: number` | `[[indent:N]]` | Paragraph metadata |
| Bottom | paragraph attr `mdiBottom: number` | `[[bottom]]` / `[[bottom:N]]` | Paragraph metadata |

blank と pagebreak は semantic DOM hook に対応し、選択可能な atomic block
として保持されます。pagebreak の `variant` は `null`、`"right"`、`"left"`
のいずれかです。indent と bottom は paragraph のテキストを編集してもその
paragraph に保持されます。引数なしの `[[bottom]]` は `mdiBottom: 0` です。

pagebreak の各 variant は `[[pagebreak]]`、`[[pagebreak:right]]`、
`[[pagebreak:left]]` としてシリアライズされます。

文法の有効性、数値制限、canonical 表記は上流の MDI parser が決定します。
無効な構文はリテラルテキストのままです。その他の未知の mdast 拡張 node は、
一つの未知構文が文書全体の読み込みを妨げないよう、引き続き編集可能な
リテラル Markdown テキストへフォールバックします。
