# Milkdown MDI

MDI syntax support for Milkdown, designed for Japanese novel and long-form writing workflows.

## What this package does

- Parses MDI constructs into editable ProseMirror nodes.
- Preserves MDI syntax through Milkdown serialization.
- Provides clipboard conversion and round-trip guarantees.
- Keeps document semantics independent from writing direction.

## What it does not do

This package does not control vertical layout, scrolling, or application file-type detection. Pair it with [`@illusions-lab/milkdown-plugin-vertical-writing`](https://github.com/illusions-lab/milkdown-plugin-vertical-writing) when you need vertical presentation.

## Status

The package is under active development. Check the [open TODO](https://github.com/illusions-lab/milkdown-plugin-mdi/issues/1) for the implementation roadmap.
