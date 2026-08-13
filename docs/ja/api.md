# API

```ts
import {
  createMdiEditorMapping,
  getMdi,
  mapMdiSourceSpanToCurrentEditorRanges,
  mdi,
  mdiClipboard,
  mdiEditCommand,
  mdiInputRules,
} from '@illusions-lab/milkdown-plugin-mdi'
```

## `initializeMdi()`

parser と canonical serializer が使う MDI JavaScript binding を初期化します。ブラウザでは Milkdown editor を作る前に await してください。このパッケージは `@illusions-lab/mdi` から再エクスポートしています。

## `mdi()`

MDI remark adapter、inline schema、blank / pagebreak の block schema、
indent / bottom attr 用に拡張した CommonMark paragraph schema を登録する
Milkdown plugin を返します。Milkdown の CommonMark preset と併用してください。

## `getMdi()`

現在の本文をシリアライズし、保持された front matter を復元してから、ソース全体を canonical 化する Milkdown action を返します。`.mdi` の保存には `editor.action(getMdi())` を使用します。本文だけの Markdown には `@milkdown/utils` の `getMarkdown()` を使用してください。

返されたソースは、`@illusions-lab/mdi` から直接 import した `parse()`、`renderText()`、`getMdiTextBlocks()`、その他の解析 API に渡す正式な入力でもあります。

```ts
import { getMdiTextBlocks } from '@illusions-lab/mdi'

const source = editor.action(getMdi())
const { blocks } = getMdiTextBlocks(source)
```

text-block range は、その `source` revision にだけ属します。revision または hash と一緒に保存してください。本 plugin は editor の変更を越えて range を安定化しません。

## Source span から editor range への変換

`createMdiEditorMapping()` は、完全に同一の canonical source と ProseMirror
document を結びつけた immutable snapshot を作成します。
`mapMdiSourceSpanToCurrentEditorRanges()` は document が変更済みなら
`reason: 'stale'` を返します。transaction や undo/redo の後は upstream
解析と snapshot を一緒に作り直してください。synthetic text や editor 上に
表現がない構文は明示的に unmapped となります。

## 型付き編集 API

`mdiEditCommand()` は ruby、TCY、傍点、no-break、warichu、kern、明示改行、
blank、pagebreak、indent/bottom を扱う通常の ProseMirror command を返します。
`canApplyMdiEdit()` と `inspectMdiSelection()` を UI の状態判定に利用できます。
無効な値や構造上適用できない操作は document を変更せず `false` を返します。

## opt-in input / clipboard

`mdi()` だけでは有効になりません。必要な application だけ登録します。

```ts
Editor.make()
  .use(commonmark)
  .use(mdi())
  .use([mdiInputRules(), mdiClipboard()])
```

input candidate は公式 parser で確認されます。clipboard は canonical MDI の
plain-text fallback を常に保持し、MDI でない入力は通常の ProseMirror 処理へ
そのままフォールバックします。

## 意図的に提供しない API

このパッケージは `getMdiIR()`、`getMdiText()`、`getMdiTextBlocks()`、検索 API を提供しません。解析、テキスト投影、text block、diagnostics、source map は MDI の責務であり、`@illusions-lab/mdi` を直接利用してください。

mapping API は upstream の解析結果を利用しますが、それを proxy または再構築しません。
