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

block MDI と、未対応の mdast 拡張 node はこのマイルストーンのエディター機能ではありません。未対応の構文が一つあっても文書全体の読み込みを妨げないよう、編集可能なリテラル Markdown テキストへフォールバックします。これは保存を優先した処理であり、block MDI を完全対応しているという意味ではありません。
