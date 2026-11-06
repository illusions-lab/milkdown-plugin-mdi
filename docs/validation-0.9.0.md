# 0.9.0 validation record

## #24: paragraph persistence contract

- 18 focused tests use independent CommonMark + `mdi()` editors: root layout
  round trips at Rust u32 boundaries, update/switch/clear and Undo/Redo, nested
  rejection, direct transactions, structured/HTML slices, legacy recovery,
  malformed/conflicting attributes, empty paragraphs and literal directive text.
- A 10,000-paragraph ordinary-input check confirms unchanged subtree validation
  is reused, without Rust parsing or whole-document serialization per keystroke.
- 12 browser checks passed across Chromium, Firefox and WebKit, covering native
  HTML paste into quotes/lists and cross-editor HTML with closed slice metadata.
- `npm run release:check` passed: typecheck, coverage thresholds, build, tarball,
  showroom, three browsers, minimum-peer package consumer, docs and npm dry-run.
- Release workflow validation now accepts 0.9.x. Production publication must run
  in GitHub Actions for a main commit with successful Verify; no local publish
  or npm login was performed.

## #25: existing IME work, kept separate

The existing 11 composition unit tests and 6 synthetic browser composition checks
passed as part of the full suite. They cover DOM preservation, cancellation,
finalization without further editing, and history. The pre-existing #25 changes
remain separate from the #24 commit. Synthetic events do not establish real OS
IME acceptance; that manual check remains outstanding.

The opt-in large-book performance suites remain skipped in the normal release
check. The ordinary-input subtree-reuse check runs in the default unit suite.
