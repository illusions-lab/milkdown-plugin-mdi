# Milkdown MDI

日本語の小説・長文執筆向けに、[Milkdown](https://milkdown.dev/) へ MDI の編集とシリアライズを統合するパッケージです。

## 責務の範囲

このパッケージは、対応する MDI を編集可能な ProseMirror コンテンツへ解析し、Milkdown 経由でシリアライズして canonical な MDI 永続化を提供します。MDI 自体の仕様は定義しません。

MDI の仕様、文法、制限、エスケープ規則、例は公式ドキュメントを参照してください。

- [MDI とは](https://mdi.illusions.app/ja/learn/what-is-mdi/)
- [構文リファレンス](https://mdi.illusions.app/ja/syntax/reference/)
- [構文ショーケース](https://mdi.illusions.app/ja/syntax/showcase/)

## 対応範囲

対応するインライン機能は、編集可能な mark、atomic node、または inline leaf として表現されます。YAML front matter は編集本文に表示せず、文書メタデータとして保持します。詳細は[構文サポート](/ja/syntax)を参照してください。

縦書きレイアウト、スクロール、拡張子判定、アプリケーション固有の有効化方針は本パッケージの対象外です。縦書き表示には [`@illusions-lab/milkdown-plugin-vertical-writing`](https://github.com/illusions-lab/milkdown-plugin-vertical-writing) を利用してください。
