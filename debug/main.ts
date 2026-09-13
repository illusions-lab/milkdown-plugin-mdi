import { history, undo } from '@milkdown/prose/history'
import { TextSelection } from '@milkdown/prose/state'
import { $prose } from '@milkdown/utils'
import { defaultValueCtx, editorViewCtx, parserCtx, Editor, rootCtx } from '@milkdown/core'
import {
  changeWritingMode,
  verticalWriting,
  type WritingMode,
} from '@illusions-lab/milkdown-plugin-vertical-writing'
import '@illusions-lab/milkdown-plugin-vertical-writing/style.css'
import { commonmark } from '@milkdown/preset-commonmark'
import { nord } from '@milkdown/theme-nord'
import { parse } from '@illusions-lab/mdi'
import {
  createMdiEditorMapping,
  getMdi,
  initializeMdi,
  mapMdiSourceSpansToEditorRanges,
  mdi,
  mdiClipboard,
  mdiInputRules,
  parseMdiClipboard,
  prepareMdiDocument,
  type PreparedMdiDocument,
} from '../src/index'
import '../src/style.css'
import markdown from './content.mdi?raw'
import './style.css'

declare global {
  interface Window {
    __MDI_SMOKE__?: {
      ready: boolean
      serialized?: string
      mappingMatches?: number
      clipboardParsed?: boolean
      prepared?: boolean
      error?: string
    }
    __MDI_PERF__?: {
      loadBook: (minimumCharacters: number) => Promise<LargeDocumentMetrics>
    }
  }
}

interface LargeDocumentMetrics {
  sourceCharacters: number
  paragraphCount: number
  preparationMs: number
  mountMs: number
  loadMs: number
  firstPaintMs: number
  scrollToEndMs: number
  scrollOffset: number
  scrollExtent: number
}

const initialMode: WritingMode = 'horizontal-tb'
const status = document.querySelector<HTMLElement>('#status')
const output = document.querySelector<HTMLElement>('#serialized-output')
const frontmatterValues = document.querySelector<HTMLElement>('#frontmatter-values')

window.__MDI_SMOKE__ = { ready: false }
let editor: Editor | undefined

const setStatus = (message: string, isError = false) => {
  if (!status) return
  status.textContent = message
  status.toggleAttribute('data-error', isError)
}

const setActiveButton = (mode: WritingMode) => {
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.mode === mode))
  })
}

const renderFrontmatter = (entries: Array<{ key: string; value: unknown }>) => {
  if (!frontmatterValues) return
  frontmatterValues.replaceChildren()

  if (entries.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'frontmatter-empty'
    empty.textContent = 'No front matter in this document.'
    frontmatterValues.append(empty)
    return
  }

  for (const { key, value } of entries) {
    const row = document.createElement('div')
    const term = document.createElement('dt')
    const description = document.createElement('dd')
    term.textContent = key
    description.textContent = typeof value === 'string' ? value : JSON.stringify(value)
    row.append(term, description)
    frontmatterValues.append(row)
  }
}

const makeEditor = (source: string, initialDocument?: PreparedMdiDocument) => Editor.make()
  .config((ctx) => {
    ctx.set(rootCtx, '#editor')
    ctx.set(defaultValueCtx, source)
  })
  .config(nord)
  .use(commonmark)
  .use($prose(() => history({ newGroupDelay: -1 })))
  .use(mdi({ initialDocument }))
  .use([mdiInputRules(), mdiClipboard()])
  .use(verticalWriting({ mode: initialMode }))

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

// Generate in the browser so Playwright transport is not part of the timing.
const makeLargeBook = (minimumCharacters: number) => {
  const paragraphs: string[] = []
  let length = 0
  let index = 1
  while (length < minimumCharacters) {
    const annotation = index % 20 === 0 ? ' [[no-break:第一章]] ^12^' : ''
    const paragraph = `第${index}節　${'本文'.repeat(500)}${annotation}`
    paragraphs.push(paragraph)
    length += paragraph.length + 2
    index += 1
  }
  return paragraphs.join('\n\n')
}

window.__MDI_PERF__ = {
  async loadBook(minimumCharacters) {
    const source = makeLargeBook(minimumCharacters)
    await editor?.destroy()
    document.querySelector('#editor')?.replaceChildren()

    const startedAt = performance.now()
    const prepared = await prepareMdiDocument(source)
    const preparedAt = performance.now()
    editor = makeEditor(prepared.canonicalSource, prepared)
    await editor.create()
    const loadedAt = performance.now()
    await nextFrame()
    await nextFrame()
    const paintedAt = performance.now()

    const viewport = document.querySelector<HTMLElement>('#editor .milkdown')
    if (!viewport) throw new Error('Milkdown viewport is unavailable')
    const scrollStartedAt = performance.now()
    viewport.scrollTop = viewport.scrollHeight
    await nextFrame()
    const scrollToEndMs = performance.now() - scrollStartedAt
    const scrollOffset = viewport.scrollTop
    const scrollExtent = viewport.scrollHeight
    viewport.scrollTop = 0

    return {
      sourceCharacters: source.length,
      paragraphCount: document.querySelectorAll('#editor .milkdown p').length,
      preparationMs: preparedAt - startedAt,
      mountMs: loadedAt - preparedAt,
      loadMs: loadedAt - startedAt,
      firstPaintMs: paintedAt - startedAt,
      scrollToEndMs,
      scrollOffset,
      scrollExtent,
    }
  },
}

const start = async () => {
  try {
    await initializeMdi()
    renderFrontmatter(parse(markdown).document.frontmatter?.entries ?? [])

    const prepared = await prepareMdiDocument(markdown)
    editor = makeEditor(prepared.canonicalSource, prepared)
    await editor.create()

    const changeMode = (mode: WritingMode) => {
      editor?.action(changeWritingMode(mode))
      setActiveButton(mode)
      setStatus(`Writing mode: ${mode} · MDI runtime ready`)
    }

    document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => {
      button.addEventListener('click', () => changeMode(button.dataset.mode as WritingMode))
    })

    document.querySelector<HTMLButtonElement>('#serialize')?.addEventListener('click', () => {
      const serialized = editor?.action(getMdi()) ?? ''
      if (output) {
        output.textContent = serialized
        output.hidden = false
      }
      setStatus('Canonical MDI serialized successfully')
    })

    changeMode(initialMode)
    const serialized = editor.action(getMdi())
    const ruby = serialized.indexOf('東京')
    const startByte = new TextEncoder().encode(serialized.slice(0, ruby)).length
    const snapshot = editor.action(createMdiEditorMapping())
    const mappingMatches = mapMdiSourceSpansToEditorRanges(snapshot, [{
      startByte,
      endByte: startByte + new TextEncoder().encode('東京').length,
    }])[0]?.matches.length
    const clipboardParsed = editor.action(parseMdiClipboard('{字|じ}', { explicit: true })) !== null
    window.__MDI_SMOKE__ = {
      ready: true,
      serialized,
      mappingMatches,
      clipboardParsed,
      prepared: true,
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    const details = error instanceof Error && error.stack ? `${message}\n${error.stack}` : message
    window.__MDI_SMOKE__ = { ready: false, error: details }
    setStatus(`Editor initialization failed: ${message}`, true)
    console.error(error)
  }
}

void start()

let warichuDocumentWrites = 0
let warichuTransactions = 0
const observedWarichuViews = new WeakSet<object>()
Object.assign(window, { __MDI_WARICHU__: {
  load: (source: string) => editor?.action(ctx => {
    const view = ctx.get(editorViewCtx)
    const doc = ctx.get(parserCtx)(source)
    if (!observedWarichuViews.has(view)) {
      observedWarichuViews.add(view)
      const dispatch = view.dispatch.bind(view)
      view.dispatch = transaction => { warichuTransactions += 1; if (transaction.docChanged) warichuDocumentWrites += 1; dispatch(transaction) }
    }
    view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content).setMeta('addToHistory', false))
    view.dom.style.position = 'relative'
    view.dom.style.width = '220px'
    view.dom.style.fontSize = '20px'
    warichuDocumentWrites = 0
    return getMdi()(ctx)
  }),
  writes: () => warichuDocumentWrites,
  transactions: () => warichuTransactions,
  source: () => editor?.action(getMdi()),
  insert: (text: string) => editor?.action(ctx => { const view = ctx.get(editorViewCtx); view.dispatch(view.state.tr.insertText(text)) }),
  range: () => editor?.action(ctx => { const selection = ctx.get(editorViewCtx).state.selection; return { from: selection.from, to: selection.to } }),
  position: () => editor?.action(ctx => ctx.get(editorViewCtx).state.selection.from),
  select: (from: number, to = from) => editor?.action(ctx => {
    const view = ctx.get(editorViewCtx)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)))
    view.focus()
  }),
  undo: () => editor?.action(ctx => {
    const view = ctx.get(editorViewCtx)
    return undo(view.state, view.dispatch)
  }),
} })
