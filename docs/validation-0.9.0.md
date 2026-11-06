# 0.9.0 validation record

## #24: paragraph persistence contract

The independent unit harness installs CommonMark + `mdi()`; history is added
where needed. The browser fixture at `/layout-contract.html` installs only
CommonMark, MDI, history and a transaction observer, with an explicit
`?structured` configuration for `mdiClipboard()`. It does not use the warichu
showroom API.

| Scenario | Test name (`test/layout-contract.test.ts`) | Result | Limits |
| --- | --- | --- | --- |
| Root, quote, ordered/unordered lists, quote in list, list in quote, mixed lists × indent/bare bottom/valued bottom | `support matrix …` | Pass | Only nonempty root paragraphs accept layout |
| Invalid numeric values and empty paragraphs | `invalid … preserves populated state`, `empty refusal …` | Pass | Query/execution false; zero dispatch; document, selection, nonempty stored marks, plugin history and populated Undo/Redo unchanged |
| Set/update/switch/clear, Undo/Redo, three successive reloads per operation | `three reloads after lifecycle …` | Pass | Compares full semantic JSON, excluding only `span`; retains marks, attributes and containers |
| Quote and both list wrappers | `wrap refusal …` | Pass | Guard dispatches zero times; original command dispatches a candidate once, which is filtered; full state/history unchanged |
| Normal list sink, legacy deeper sink refusal, adjacent editing | `ordinary list sink works while deeper legacy layout is refused and neighbours remain editable` | Pass | Legacy state is injected through EditorState, not accepted as a new transaction |
| Multiple legacy issues, diagnostic position migration, clear + standard list lift, rejected Undo, save/reload | `legacy diagnostics migrate and sequential repairs permit save but cannot be undone` | Pass | Registered serializer, getMdi and getMarkdown expose matching diagnostics; full invalid clipboard slice returns null without state changes |
| Long-document subtree reuse and previous boundaries | Existing persistence contract tests | Pass | Performance check uses 10,000 paragraphs; opt-in book benchmarks remain separate |

61 focused unit tests and 84 focused browser cases pass. No required #24 test is skipped.

| Scenario | Test name (`browser/layout-contract.spec.ts`) | Result | Limits |
| --- | --- | --- | --- |
| Actual source copy → target paste, all three layouts with marks, save/reload and unchanged source | `actual copy preserves top-level semantic layout …` | Pass in Chromium/Firefox/WebKit | Both default HTML and opt-in structured MIME configurations |
| Quote, both lists, list in quote, quote in list and mixed lists | `actual copy into container …` | Pass in all three engines | A legal open-slice text merge is allowed; illegal candidate requires complete state refusal |
| Actual copied closed legacy container | `legacy closed container rejection drag=false …` | Pass in all three engines | Asserts candidate has issues and validator rejects it before checking unchanged final state |
| Cross-editor drag copy and same-editor drag move of legacy container | `legacy closed container rejection drag=true …` | Pass in all three engines | Same-editor refusal preserves source; both document and selection/history snapshots compared |
| Legal top-level cross-editor copy and same-editor move, then save/reload | `legal top-level drag same=…` | Pass in all three engines | Same-editor control must actually change the document and retain exactly one laid-out paragraph |

The fixture invokes browser copy/paste and dragstart/drop handlers with a
DataTransfer populated by the source editor. It never supplies hand-written
transfer HTML. Firefox's synthetic ClipboardEvent store is explicitly bound to
the same DataTransfer. These are browser-event tests, **not system clipboard
acceptance**. Transfer completion waits for animation-frame stability and the
absence of temporary capture nodes, without fixed sleeps.

## #25: synthetic IME evidence, separate work

The existing 11 `test/blank-composition.test.ts` cases and 6 three-engine
`browser/blank-composition.spec.ts` cases cover DOM text-node preservation,
cancellation, completion without further editing, and history. These pass with
the #24 focused checks. The pre-existing #25 implementation and tests remain
outside the #24 commit. Synthetic events do not establish real OS IME acceptance.

## #25: real macOS Japanese IME checklist — 待验收

Host inspection reports macOS 27.0.1 (26A434). No manual Japanese Romaji IME
session was performed. Browser and IME versions must be recorded during the
manual run; Playwright WebKit does not substitute for installed Safari.

| Manual scenario, in both middle and trailing empty paragraphs | Chrome | Firefox | Safari |
| --- | --- | --- | --- |
| Type and convert with candidate window open: no lost/duplicate text or caret jump | 待验收 | 待验收 | 待验收 |
| Cancel composition and recover the original empty paragraph | 待验收 | 待验收 | 待验收 |
| Confirm, stop editing, wait for normalization, save and reload | 待验收 | 待验收 | 待验收 |
| Undo/Redo restores body text and empty-paragraph state | 待验收 | 待验收 | 待验收 |
| Record installed browser version | 待记录 | 待记录 | 待记录 |
| Record Japanese Romaji input method/version | 待记录 | 待记录 | 待记录 |

Only automated acceptance can be reported complete; #25 and overall real-IME
acceptance remain outstanding.

## Release verification

- `node --test scripts/release-artifact.test.mjs`: 5 passed.
- Version remains 0.9.0. No production publish, push or local npm login occurred.
  Production publishing remains restricted to GitHub Actions.
- Full `release:check` passed in an isolated snapshot at
  `/tmp/mdi-issue24-verification`, containing HEAD + this #24 patch + the original
  #25 working files. Command: `PLAYWRIGHT_PORT=4207 PLAYWRIGHT_WORKERS=1 npm run release:check`.
  Results: 307 unit tests; Chromium 47 passed; full three-engine suite 141 passed;
  build, tarball contract, minimum-peer consumers (including all three engines),
  docs build and npm dry-run passed. Existing opt-in performance tests account
  for 2 unit and 6 three-engine browser skips; no required case was skipped.
- Coverage: statements/lines 99.02%, functions 100%, branches 89.08%; the existing
  98/100/89 thresholds were retained.
- The shared workspace was changing concurrently. Its full-suite attempts
  encountered shared build-output replacement and failures in separate,
  newly added clipboard/structure-boundary matrices. Those matrices are not
  part of this commit or the isolated result. This record does not claim the
  entire concurrent workspace passes. A synthetic ClipboardEvent data binding
  correction was also left in the separate clipboard matrix working file.
- #24 required automation is complete. This change adds tests and test fixtures;
  no additional production fix or public API was needed.
