# Milkdown MDI

MDI editing and serialization integration for [Milkdown](https://milkdown.dev/), for Japanese novel and long-form writing workflows.

## Responsibilities

This package parses supported MDI into editable ProseMirror content, serializes it through Milkdown, and provides canonical MDI persistence. It does not define MDI itself.

The MDI specification, grammar, limits, escaping rules, and examples are maintained in the official documentation:

- [What is MDI?](https://mdi.illusions.app/learn/what-is-mdi/)
- [Syntax reference](https://mdi.illusions.app/syntax/reference/)
- [Syntax showcase](https://mdi.illusions.app/syntax/showcase/)

## Scope

Supported inline features are represented as editable marks, atomic nodes, or inline leaves. YAML front matter is retained as document metadata rather than shown in the editable body. See [Syntax Support](/syntax) for the integration matrix.

Vertical layout, scrolling, file-extension detection, and application-specific enablement are outside this package. Use [`@illusions-lab/milkdown-plugin-vertical-writing`](https://github.com/illusions-lab/milkdown-plugin-vertical-writing) when your application needs vertical presentation.
