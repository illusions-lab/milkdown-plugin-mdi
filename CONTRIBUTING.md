# Contributing

Thank you for contributing to `@illusions-lab/milkdown-plugin-mdi`.

Before opening a pull request:

1. Search existing issues and pull requests.
2. For syntax changes, document the editor representation and round-trip behavior; link to the official MDI specification instead of copying grammar into this repository.
3. Add or update focused tests.
4. Run `npm run test:release` and `npm run docs:build`. Use `npm run test:browser:all` before
   merging browser-sensitive changes.

Keep pull requests focused and explain compatibility implications. Keep the English and Japanese documentation in sync. Changes that affect MDI grammar interpretation should link to the official [MDI syntax reference](https://mdi.illusions.app/syntax/reference/) and include source text, editor behavior, and serialized output.

Use `npm run test:performance` on a dedicated machine when a change could affect large-document loading. It measures editor creation with generated one-million- and ten-million-character MDI books; tune its guardrails with `MDI_1M_LOAD_MAX_MS` and `MDI_10M_LOAD_MAX_MS`.

By contributing, you agree that your contribution is provided under the MIT License.
