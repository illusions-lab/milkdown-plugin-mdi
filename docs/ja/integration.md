# 統合

## 永続化の境界

`@milkdown/utils` の `getMarkdown()` は、Milkdown に登録された handler を使って編集可能な本文をシリアライズします。このパッケージの `getMdi()` はさらに保持済み front matter を復元し、MDI の canonical serializer に通します。

`.mdi` 文書の保存時と、エディター内容を MDI の解析 API に渡す前には `getMdi()` を使ってください。これは、変更可能な Milkdown state と完全な文書ソースの間にある永続化の境界です。canonical 出力では等価なソース表記が正規化される場合があるため、元の表記がそのまま保持される前提にはしないでください。

```ts
import { getMarkdown } from '@milkdown/utils'
import { getMdi } from '@illusions-lab/milkdown-plugin-mdi'

const markdown = editor.action(getMarkdown())
const canonicalMdi = editor.action(getMdi())
```

## 解析とテキスト投影

文書の解析とプレーンテキスト投影には `@illusions-lab/mdi` を直接呼び出します。本文だけを返す `getMarkdown()` ではなく、必ず `getMdi()` が返した完全な canonical source を渡してください。

```ts
import { getMdiTextBlocks, parse, renderText } from '@illusions-lab/mdi'
import { getMdi } from '@illusions-lab/milkdown-plugin-mdi'

const source = editor.action(getMdi())
const ir = parse(source)
const text = renderText(source)
const { blocks } = getMdiTextBlocks(source)
```

`parse()` の結果には文書の front matter が保持されます。`renderText()` は本文を投影し、front matter を本文テキストに混ぜません。`getMdiTextBlocks()` は Rust が生成した完全な projection envelope（document、diagnostics、source-order blocks、source maps、ruby-reading annotations）を返します。front matter は metadata のままであり、本文 block にはなりません。

検索や AI workflow では、`renderText()` を再分割したり application code で IR を走査したりせず、`blocks` を直接 index してください。`3:18` のような座標は 1-based Unicode grapheme であり、その座標を生成した同一 canonical source revision に対してのみ有効です。座標と一緒に revision または content hash を保存してください。persistent paragraph ID、index、ranking、retrieval、AI context policy は application 側の責務です。

このパッケージは `getMdiIR()`、`getMdiText()`、`getMdiTextBlocks()`、検索 API をエクスポートしません。これらは MDI が所有する public contract と重複するためです。revision の追跡、永続 ID、索引、ranking、AI context policy もアプリケーション側の責務です。

## Front matter

YAML front matter は編集可能な ProseMirror 本文を作る前に取り除かれます。エディターメタデータとして保持され、`getMdi()` だけが復元します。`getMarkdown()` が返すのは front matter を含まない本文です。

## スタイル用フック

標準表示には `@illusions-lab/milkdown-plugin-mdi/style.css` を読み込みます。安定した CSS hook は `mdi-ruby`、`mdi-tcy`、`mdi-boten`、`mdi-no-break`、`mdi-warichu`、`mdi-kern`、`mdi-break` と対応する `data-mdi-*` 属性です。

## 意図的に提供しない編集機能

このマイルストーンには input rule、popover、貼り付け処理、独自 clipboard serialization はありません。アプリケーションは独自の UI を構築できますが、永続化と解析の境界としては `getMdi()` を使用してください。
