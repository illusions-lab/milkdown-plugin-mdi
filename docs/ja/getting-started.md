# 導入

## インストール

```bash
npm install @illusions-lab/milkdown-plugin-mdi @milkdown/core @milkdown/ctx @milkdown/preset-commonmark @milkdown/prose @milkdown/utils
```

## プラグインの登録

MDI には Milkdown の CommonMark preset が必要です。パッケージのスタイルシートを読み込み、ブラウザでは editor を作る前に `initializeMdi()` を await してください。

`@milkdown/preset-commonmark` を含むすべての Milkdown peer package には
`7.21.3` 以降が必要です。本 plugin は preset の paragraph schema を拡張し、
MDI の block layout metadata を保持します。

```ts
import { Editor } from '@milkdown/core'
import { commonmark } from '@milkdown/preset-commonmark'
import { initializeMdi, mdi } from '@illusions-lab/milkdown-plugin-mdi'
import '@illusions-lab/milkdown-plugin-mdi/style.css'

await initializeMdi()
const editor = await Editor.make().use(commonmark).use(mdi()).create()
```

`initializeMdi()` は Rust-backed MDI JavaScript binding を初期化し、複数回呼んでも安全です。実行環境の背景は公式の [JavaScript binding ドキュメント](https://mdi.illusions.app/ja/bindings/javascript/)を参照してください。

MDI を有効にする文書で `mdi()` を登録します。本パッケージは拡張子からの判定、縦書きの有効化、アプリケーションの文書モード方針を実装しません。
