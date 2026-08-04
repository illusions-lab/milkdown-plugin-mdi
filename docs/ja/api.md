# API

```ts
import { getMdi, initializeMdi, mdi } from '@illusions-lab/milkdown-plugin-mdi'
```

## `initializeMdi()`

parser と canonical serializer が使う MDI JavaScript binding を初期化します。ブラウザでは Milkdown editor を作る前に await してください。このパッケージは `@illusions-lab/mdi` から再エクスポートしています。

## `mdi()`

MDI remark adapter と対応するインライン schema を登録する Milkdown plugin を返します。Milkdown の CommonMark preset と併用してください。

## `getMdi()`

現在の本文をシリアライズし、保持された front matter を復元してから、ソース全体を canonical 化する Milkdown action を返します。`.mdi` の保存には `editor.action(getMdi())` を使用します。本文だけの Markdown には `@milkdown/utils` の `getMarkdown()` を使用してください。

返されたソースは、`@illusions-lab/mdi` から直接 import した `parse()`、`renderText()`、`getMdiTextBlocks()`、その他の解析 API に渡す正式な入力でもあります。

```ts
import { getMdiTextBlocks } from '@illusions-lab/mdi'

const source = editor.action(getMdi())
const { blocks } = getMdiTextBlocks(source)
```

text-block range は、その `source` revision にだけ属します。revision または hash と一緒に保存してください。本 plugin は editor の変更を越えて range を安定化しません。

## 意図的に提供しない API

このパッケージは `getMdiIR()`、`getMdiText()`、`getMdiTextBlocks()`、検索 API を提供しません。解析、テキスト投影、text block、diagnostics、source map は MDI の責務であり、`@illusions-lab/mdi` を直接利用してください。本 plugin の public API は Milkdown 統合と完全な canonical source の取得だけに限定します。
