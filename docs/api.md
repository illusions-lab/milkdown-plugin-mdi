# API

The public API is intentionally small and will be finalized during the initial implementation.

```ts
interface MdiOptions {
  enabled?: boolean;
  ruby?: boolean;
  tcy?: boolean;
  noBreak?: boolean;
  kern?: boolean;
  break?: boolean;
  blank?: boolean;
  frontmatter?: boolean;
}

declare function mdi(options?: MdiOptions): MilkdownPlugin[];
```

The package should expose syntax plugins and `MdiDocument` only when those exports are stable and documented.
