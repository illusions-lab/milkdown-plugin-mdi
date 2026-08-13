# Getting Started

## Installation

```bash
npm install @illusions-lab/milkdown-plugin-mdi @milkdown/core @milkdown/ctx @milkdown/preset-commonmark @milkdown/prose @milkdown/utils
```

## Register the plugin

MDI requires Milkdown's CommonMark preset. Import the package stylesheet, then await `initializeMdi()` in the browser before creating an editor.

All Milkdown peer packages, including `@milkdown/preset-commonmark`, must be
version `7.21.3` or newer. The plugin extends the preset's paragraph schema to
carry MDI block-layout metadata.

```ts
import { Editor } from '@milkdown/core'
import { commonmark } from '@milkdown/preset-commonmark'
import { initializeMdi, mdi } from '@illusions-lab/milkdown-plugin-mdi'
import '@illusions-lab/milkdown-plugin-mdi/style.css'

await initializeMdi()

const editor = await Editor.make().use(commonmark).use(mdi()).create()
```

`initializeMdi()` initializes MDI's Rust-backed JavaScript binding and is safe to call more than once. For its runtime background, see the official [JavaScript binding documentation](https://mdi.illusions.app/bindings/javascript/).

Enable `mdi()` when your application chooses to support MDI. This package does not decide from a file extension, enable vertical writing, or implement an application's document-mode policy.
