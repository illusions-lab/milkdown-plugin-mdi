# Getting started

## Installation

```bash
npm install @illusions-lab/milkdown-plugin-mdi
```

## Register the plugin

```ts
import { Editor } from "@milkdown/core";
import { commonmark } from "@milkdown/preset-commonmark";
import { mdi } from "@illusions-lab/milkdown-plugin-mdi";

Editor.make()
  .use(commonmark)
  .use(mdi({ enabled: true }))
  .create();
```

Keep `enabled` as an application-level decision. The plugin should not inspect file extensions itself.
