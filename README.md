# @illusions-lab/milkdown-plugin-mdi

MDI syntax support for [Milkdown](https://milkdown.dev/), built for Japanese novel and long-form writing workflows.

> Early development: the public API is being stabilized. See the [roadmap](https://github.com/illusions-lab/milkdown-plugin-mdi/issues) before relying on an unreleased feature.

## Goals

- Parse MDI constructs into editable ProseMirror nodes.
- Preserve MDI syntax through Milkdown's Markdown serializer.
- Support safe clipboard conversion and round-tripping.
- Keep document semantics independent from visual writing direction.

## Planned usage

```ts
import { mdi } from "@illusions-lab/milkdown-plugin-mdi";

editor.use(mdi({
  enabled: true,
  ruby: true,
  tcy: true,
  noBreak: true,
  kern: true,
}));
```

## Scope

This package owns MDI syntax, parsing, serialization, nodes, and clipboard behavior. It does not impose vertical writing or application-specific file-extension logic. Use `@illusions-lab/milkdown-plugin-vertical-writing` for visual writing direction.

## Development

```bash
npm install
npm test
npm run typecheck
```

## Contributing

Please read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening an issue or pull request.

## License

MIT © Iktahana
