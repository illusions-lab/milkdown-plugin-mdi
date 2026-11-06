# Real Japanese IME acceptance — current system

Date: 2026-11-06. Platform: macOS 27.0.1 (build 26A434), inspected with `sw_vers`.
IME name/version: unverified (automation did not inspect or change the system input source).
Installed browser versions (Info.plist inspection only, not execution evidence): Google Chrome 156.0.8078.80; Firefox 156.0.1; Safari 27.0.1 (22625.1.29.11.28).
No real OS IME session has been executed. All rows below are **UNVERIFIED**.
Synthetic `composition*` tests are separate and cannot change this status.

Run `npm run debug:dev`, open `/testing.html`, and initialize in browser DevTools:

```js
await window.__EDITING__.create('manual', { source: '前\n\n後', mode: 'input' })
window.__EDITING__.select('manual', 2)
```

Use actual Japanese keyboard input, not DevTools text insertion. Record OS build, input source (e.g. Apple Japanese Romaji), browser/version, observed text, cursor, and a screenshot or screen recording for every result.

| Case | Steps | Expected | Result |
| --- | --- | --- | --- |
| Middle empty paragraph, first input | Press Enter at the initialized caret; type `tokyo`, convert to 東京, confirm | The middle paragraph contains 東京; input does not disappear or move | UNVERIFIED |
| After external paste, first input | Copy 日本語 from an external app; paste into an empty editor; immediately type/convert `kanji` | 日本語漢字 remains in order, caret follows 漢字 | UNVERIFIED |
| Cancel | In a new middle blank, start conversion, press Escape until cancelled | No provisional text; blank paragraph remains | UNVERIFIED |
| Two conversions | Confirm 東京; immediately convert 日本 | 東京日本, no duplicated text | UNVERIFIED |
| Terminal paragraph | Enter at document end, convert/confirm 日本 | A normal paragraph, no accidental heading | UNVERIFIED |
| Blur | During provisional input click a second instance, return | No lost or duplicated committed input; record OS-specific commit/cancel behavior | UNVERIFIED |
| Selection change | During provisional input click another paragraph | Active input node stays connected until OS completes/cancels input; no exception | UNVERIFIED |
| History and save | Confirm text, Undo, Redo; read `snapshot('manual').source`; rebuild with source | One user undo restores prior semantics, redo restores text; save/reopen stable for supported states | UNVERIFIED |
| Vertical | Repeat first-input and paste cases with `mode: 'vertical'` | Same semantics, visible caret and usable navigation | UNVERIFIED |

Execute the matrix separately in Chrome/Chromium, Firefox, and real Safari. Do not infer Safari OS IME behavior from Playwright WebKit.

## Per-browser execution record

All entries are UNVERIFIED: no OS input session or screenshot/recording exists. The available automation can synthesize browser events but cannot operate the native input source. Input method name/version is therefore unknown for every entry. Installed versions above must be rechecked when the manual session runs.

| Case | Chrome 156.0.8078.80 | Firefox 156.0.1 | Safari 27.0.1 |
| --- | --- | --- | --- |
| Middle empty paragraph | UNVERIFIED | UNVERIFIED | UNVERIFIED |
| External paste | UNVERIFIED | UNVERIFIED | UNVERIFIED |
| Cancel | UNVERIFIED | UNVERIFIED | UNVERIFIED |
| Two conversions | UNVERIFIED | UNVERIFIED | UNVERIFIED |
| Terminal paragraph | UNVERIFIED | UNVERIFIED | UNVERIFIED |
| Blur | UNVERIFIED | UNVERIFIED | UNVERIFIED |
| Selection change | UNVERIFIED | UNVERIFIED | UNVERIFIED |
| History and save | UNVERIFIED | UNVERIFIED | UNVERIFIED |
| Vertical | UNVERIFIED | UNVERIFIED | UNVERIFIED |

For each completed cell, record the actual OS build, IME/input-source version, full browser version, operations and observed text/selection/history, and link a screenshot or recording. For terminal paragraphs also save immediately after confirmation/cancellation and after the delayed task, then reopen three times. Preserve paragraph order, text, marks and blank attributes. Any failure must get an automated regression where reproducible before repair and real-browser revalidation. Synthetic checks cannot complete these cells.
