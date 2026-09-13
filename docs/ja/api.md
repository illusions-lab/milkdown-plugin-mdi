# API

```ts
import {
  createMdiEditorMapping,
  getMdi,
  mapMdiSourceSpanToCurrentEditorRanges,
  mapMdiSourceSpansToEditorRanges,
  mdi,
  mdiClipboard,
  mdiEditCommand,
  mdiInputRules,
  prepareMdiDocument,
  type PreparedMdiDocument,
  type StructuredCloneSafeMdast,
} from '@illusions-lab/milkdown-plugin-mdi'
```

## `initializeMdi()`

parser と canonical serializer が使う MDI JavaScript binding を初期化します。ブラウザでは Milkdown editor を作る前に await してください。このパッケージは `@illusions-lab/mdi` から再エクスポートしています。

## `prepareMdiDocument(source)`

Rust parse、canonicalization、Milkdown 用 mdast normalization を現在の実行
context で完了し、`Promise<PreparedMdiDocument>` を返します。大きな初期文書では
module Worker 内で `initializeMdi()` の後に呼び、結果を `postMessage()` で renderer
へ渡してください。

```ts
interface PreparedMdiDocument {
  version: 2
  mdiIrVersion: string
  provenanceVersion: string
  canonicalSource: string
  document: StructuredCloneSafeMdast
  frontmatter?: string
  diagnostics: readonly MdiDiagnostic[]
  stats: {
    sourceUtf16Length: number
    sourceBytes: number
    blockCount: number
  }
}
```

返される object は structured clone 可能なデータだけで構成されます。diagnostics は
元の入力を、mdast provenance は `canonicalSource` を参照します。error 表示や source
safe mode が必要な application は元の source を別に保持してください。

## `mdi(options?)`

MDI remark adapter、inline schema、blank / pagebreak の block schema、
indent / bottom attr 用に拡張した CommonMark paragraph schema を登録する
Milkdown plugin を返します。Milkdown の CommonMark preset と併用してください。

初期 ProseMirror document を準備済みデータから構築するには
`{ initialDocument: prepared }` を渡します。この経路は transport、MDI IR、provenance
の version を検証し、互換性がなければ明示的に失敗します。source の canonicalize、
Rust parser、Remark parse は再実行しません。schema に対応した ProseMirror node を
構築するときに transient provenance map を再生成します。

```ts
// module Worker
import {
  initializeMdi,
  prepareMdiDocument,
} from '@illusions-lab/milkdown-plugin-mdi/prepared'

await initializeMdi()
postMessage(await prepareMdiDocument(source))

// renderer
const editor = await Editor.make()
  .use(commonmark)
  .use(mdi({ initialDocument: prepared }))
  .create()
```

`./prepared` subpath は Worker-safe な entrypoint です。Milkdown、ProseMirror、
および DOM 専用 module を読み込みません。後方互換のため、同じ関数は package root
からも利用できます。

引数なしの `mdi()` は後方互換です。以後の編集、paste、serialization は従来の同期
動作を維持します。準備や version 検証の失敗時に renderer thread で同期 parse へ
fallback せず、application の open error として扱ってください。

## `getMdi()`

現在の本文をシリアライズし、保持された front matter を復元してから、ソース全体を canonical 化する Milkdown action を返します。`.mdi` の保存には `editor.action(getMdi())` を使用します。本文だけの Markdown には `@milkdown/utils` の `getMarkdown()` を使用してください。

返されたソースは、`@illusions-lab/mdi` から直接 import した `parse()`、`renderText()`、`getMdiTextBlocks()`、その他の解析 API に渡す正式な入力でもあります。

```ts
import { getMdiTextBlocks } from '@illusions-lab/mdi'

const source = editor.action(getMdi())
const { blocks } = getMdiTextBlocks(source)
```

text-block range は、その `source` revision にだけ属します。revision または hash と一緒に保存してください。本 plugin は editor の変更を越えて range を安定化しません。

## Source span から editor range への変換

`createMdiEditorMapping()` は、完全に同一の canonical source と ProseMirror
document を結びつけた immutable snapshot を作成します。
`mapMdiSourceSpanToCurrentEditorRanges()` は document が変更済みなら
`reason: 'stale'` を返します。transaction や undo/redo の後は upstream
解析と snapshot を一緒に作り直してください。synthetic text や editor 上に
表現がない構文は明示的に unmapped となります。

複数 span には `mapMdiSourceSpansToEditorRanges(snapshot, spans)` を使用します。
Rust の `resolveMdiSourceSpans()` を一度だけ呼び、mdast から ProseMirror を構築した
時点で保持した transient `mdiProvenance` と canonical target を結合します。editor
text、substring search、DOM traversal、source order による関連付けは行いません。
undo/redo を含む editor-state transaction の後は snapshot が stale になります。

## 型付き編集 API

`mdiEditCommand()` は ruby、TCY、傍点、no-break、warichu、kern、明示改行、
blank、pagebreak、indent/bottom を扱う通常の ProseMirror command を返します。
`canApplyMdiEdit()` と `inspectMdiSelection()` を UI の状態判定に利用できます。
無効な値や構造上適用できない操作は document を変更せず `false` を返します。
ruby の apply/update 後は atomic ruby node を選択し、remove 後は復元した base text
range を選択します。range mark は text selection を維持し、collapsed の非 TCY mark
は通常の stored mark を使います（TCY は 1〜6 文字の有効な range が必要です）。
break/block insertion と paragraph layout は ProseMirror の通常の mapped selection
を使い、全 command の undo/redo は plugin 独自 state ではなく通常の history で
document と selection を復元します。

## opt-in input / clipboard

`mdi()` だけでは有効になりません。必要な application だけ登録します。

```ts
Editor.make()
  .use(commonmark)
  .use(mdi())
  .use([mdiInputRules(), mdiClipboard()])
```

input candidate は公式 parser で確認されます。clipboard は canonical MDI の
plain-text fallback を常に保持し、MDI でない入力は通常の ProseMirror 処理へ
そのままフォールバックします。
unsupported source version、missing/malformed/unknown MIME も native 処理へ戻します。
custom MIME を書けない環境でも `text/plain` は維持され、同一 editor context での
重複 plugin 登録は deduplicate されます。

## 意図的に提供しない API

このパッケージは `getMdiIR()`、`getMdiText()`、`getMdiTextBlocks()`、検索 API を提供しません。解析、テキスト投影、text block、diagnostics、source map は MDI の責務であり、`@illusions-lab/mdi` を直接利用してください。

mapping API は upstream の解析結果を利用しますが、それを proxy または再構築しません。

### 編集可能な割注へのスキーマ移行（0.7）

割注は、インライン子要素を持つ編集可能なインラインノードになります。
`mdiEditCommand` に `{ type: 'setWarichu' }` または
`{ type: 'removeWarichu' }` を渡します。従来の `setInlineMark` /
`removeInlineMark` の `mark: 'warichu'` も同じ操作に転送されます。
割注内のカーソルでも `inspectMdiSelection(state).marks.warichu` を取得でき、
解除すると内容を残して割注を外します。

保存データには canonical MDI を使用してください。古い ProseMirror JSON は
旧スキーマで MDI にシリアライズしてから、このバージョンで読み込みます。
構造化クリップボード v2 は意味上の祖先パスを保存します。v1 も読み込めますが、
深さを安全に解釈できない場合は canonical MDI にフォールバックします。

`serializeMdiClipboardHtml(slice)(ctx)` は選択内容の静的な HTML 断片を返し、
ルビ、傍点、禁則、割注、空行、改ページの必要なスタイルを含めます。
v2 の `contentKind` はインライン断片とブロック断片を区別します。

割注は本文の50%の字級で2行に配置されます。入れ子の割注やルビが高い場合は
その行の高さを確保し、行の間に余分な間隔を追加しません。自動分割は文書へ
書き戻されません。IME変換中は表示位置を固定し、終了後に再配置します。
Enter は変換中以外で自動配置の案内を表示し、`mdi-warichu-auto-layout` を送出します。

## Editorial comments in MDI 2.1

The editor preserves valid `<!-- note -->` comments as hidden document atoms.
Inline `mdiComment` and block `mdiCommentBlock` nodes store the exact `value`
and original UTF-8 `span`; editing, clipboard operations and undo keep them with
their surrounding content. The plugin adds no comment controls or labels.

Synchronous parsing, Worker preparation, paste and `getMdi()` explicitly retain
comments. Prepared transport version 2 requires MDI IR 1.1. Discard version 1
caches and call `prepareMdiDocument()` again from their source; incompatible
caches fail explicitly. Never continue by silently dropping comment nodes.

Body projections and publication output omit valid comments. Default public MDI
parsing still returns comment-free IR 1.0. Applications that need comment content
must request `{ includeComments: true }` explicitly. Existing 2.0 documents also
recognize comments without changing their version declaration. Previously visible
HTML comment text now disappears from publication output. Unterminated comments
remain literal and may be exported, with `mdi.comment.unterminated` diagnostics.

`@illusions-lab/milkdown-plugin-mdi/prepared` は Worker 対応の `hasCompatiblePreparedMdiDocumentVersions(value)` を公開します。キャッシュの再利用前に prepared・IR・provenance の全バージョンを確認し、非互換の場合は保持している元のソースから再生成してください。
