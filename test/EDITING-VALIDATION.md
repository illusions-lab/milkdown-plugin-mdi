# Editing validation

This work fixes Enter paragraph selection, delays blank normalization during composition, and persists every top-level empty paragraph in multi-block documents using the existing explicit blank syntax. Initial empty documents remain ordinary paragraphs; existing explicit blanks retain their semantics. Nested paragraphs and #24 layout refusal rules are unchanged. Export validates the original document and normalizes an immutable copy without changing editor state, selection, or history. No dependencies, public API, MDI format or production publishing workflow are changed. Linux Chromium/Firefox/WebKit CI remains the automated gate.

| Batch | Traceable automated entry points |
| --- | --- |
| Foundation and P0 | `test/harness.ts`, `debug/testing.html`, `test/scenarios/editing.ts`, `test/default-editing.test.ts`, `browser/editing-matrix.spec.ts` |
| Synthetic IME | `test/blank-composition.test.ts`, `test/composition-timing.test.ts`, `test/composition-lifecycle.test.ts`, `browser/blank-composition.spec.ts`, external-paste case in `browser/clipboard-matrix.spec.ts` |
| History/save | `test/persistence-matrix.test.ts`, `test/editing-acceptance.test.ts`, unsupported layout export assertions in `test/layout-contract.test.ts` |
| Structure | `test/structure-boundaries.test.ts`, `browser/structure-boundaries.spec.ts`, existing warichu/ruby/comment suites |
| Clipboard | `browser/clipboard-matrix.spec.ts`, `test/input-clipboard-acceptance.test.ts`; Chromium-only actual system clipboard in `browser/system-clipboard.spec.ts` |
| Plugins/lifecycle | Seven configurations in `browser/editing-matrix.spec.ts` (CommonMark plus normal/prepared MDI, input/clipboard, vertical); duplicate registration/history/frontmatter in `test/persistence-matrix.test.ts` |
| Stateful | `test/stateful-editing.test.ts`, reducer verification in `test/shrink.test.ts` |

The shared comparison removes only source spans and default inactive MDI paragraph attributes. It retains text, node types, marks, non-default attributes and selection. Top-level empty paragraphs in multi-block documents have explicit MDI blank expectations rather than ignoring their attributes. Browser edits use actual keys or clipboard events; selection and history controls are test setup helpers.

## Commands

- `npm run typecheck`
- `npm run test:coverage` (unchanged thresholds: statements/lines 98, functions 100, branches 89)
- `npm run test:browser:all`
- `npm run test:stateful:extended` — 128 seeds × 200 steps; normal gate: 16 × 50.
- `MDI_SEED=7 npm run test:stateful:replay` — replay one seed.
- `MDI_SEED=7 MDI_OPERATIONS='<JSON array from minimized output>' npm run test:stateful:replay` — replay reduced operations.
- `npm run build`, `npm run test:tarball`, `PLAYWRIGHT_BROWSERS=all npm run test:consumer`, `npm run docs:build`.

Browser runs must be sequential because Vite builds share `debug/dist`; do not rebuild that directory while a preview test server is serving it. `PLAYWRIGHT_PORT` can avoid a port owned by another development task without terminating it. Failures retain traces, screenshots and editor state JSON; CI uploads browser artifacts on failure.

Random operations cover text insertion, suffix replacement, split/join, deletion, explicit undo/redo grouping, legal no-break marking, rejected collapsed ruby, and save/reopen including terminal empty paragraphs. The independent paragraph text model is checked each step; persistence compares complete semantic JSON. Failure output contains seed, initial source, operations, minimized operations, model and state. Chunk reduction accepts only replays with valid positions and the same error signature. The suite owns timeout clocks to clean up Milkdown's resolved deadline timers; complex IME timing remains in separate deterministic tests.

## Resolved persistence regression

Enter at the end of `字` previously created an unmarked last paragraph that export omitted. The original minimal unit/browser reproductions now run in the normal suites (`trailing-empty.test.ts` and `trailing-empty.spec.ts`). They cover one/three Enter operations, normal/prepared entrypoints, three save/reopen cycles, and semantic document equality. Unit coverage also checks Undo/Redo, deletion to empty, cancelled composition, immediate export before the delayed normalization task, and export after it. The random generator has no terminal-empty save exclusion and retains its full semantic JSON comparison.

The defect-only scripts, configurations, and expected-failure instructions were removed. Old local failure artifacts are historical evidence, not current failures.

## Manual and scope limitations

Real OS Japanese IME acceptance is **unverified**. Follow `JAPANESE-IME-CHECKLIST.md`; synthetic event results do not validate the actual input source. Actual system clipboard validation is Chromium-only. The structural matrix verifies whole graphemes remain intact through neighbour input and node edits; exhaustive browser-native grapheme deletion and every vertical click/arrow combination are not covered. The scenario tables are representative coverage, not a Cartesian product of all documents/positions/actions. Unsupported plugin registration orders are not promised.

## Current results (2026-11-06, macOS 27.0.1 build 26A434 / Node 24.22.1)

- Typecheck: passed.
- Regular Vitest: 392 passed; 2 existing optional performance tests skipped.
- Coverage: statements/lines 99.02%, functions 100%, branches 89.40%; original thresholds retained.
- Extended model: 128 seeds × 200 steps passed, including terminal-empty save/reopen.
- Build, tarball contract, and VitePress documentation build: passed.
- Playwright Chromium/Firefox/WebKit: 280 passed; 6 existing optional performance cases skipped. Terminal Enter regressions run in all three engines.
- Minimum-peer packed consumer: passed with all three browser engines.
- Release artifact contract: 5 tests passed.
- CI: extended randomized suite added to GitHub Actions; remote result pending.
- Real Japanese IME: not executed. Current tools cannot control the macOS input source or drive native IME composition; see the per-browser manual checklist. The user subsequently authorized publishing 0.9.0 with this limitation recorded. Native IME acceptance remains outstanding; publication runs only through GitHub Actions.
