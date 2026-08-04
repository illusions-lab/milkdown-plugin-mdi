# 導入

## インストール

```bash
npm install @illusions-lab/milkdown-plugin-mdi
```

## プラグインの登録

MDI には Milkdown の CommonMark preset が必要です。パッケージのスタイルシートを読み込み、ブラウザでは editor を作る前に `initializeMdi()` を await してください。

```ts
import { Editor } from '@milkdown/core'
import { commonmark } from '@milkdown/preset-commonmark'
import { initializeMdi, mdi } from '@illusions-lab/milkdown-plugin-mdi'
import '@illusions-lab/milkdown-plugin-mdi/style.css'

await initializeMdi()
const editor = await Editor.make().use(commonmark).use(mdi()).create()
```

`initializeMdi()` は Rust-backed MDI JavaScript binding を初期化し、複数回呼んでも安全です。実行環境の背景は公式の [JavaScript binding ドキュメント](https://mdi.illusions.app/ja/bindings/javascript/)を参照してください。

インライン MDI を有効にする文書で `mdi()` を登録します。本パッケージは拡張子からの判定、縦書きの有効化、アプリケーションの文書モード方針を実装しません。
