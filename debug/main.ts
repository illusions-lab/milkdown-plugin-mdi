import { defaultValueCtx, Editor, rootCtx } from '@milkdown/core'
import {
  changeWritingMode,
  verticalWriting,
  type WritingMode,
} from '@illusions-lab/milkdown-plugin-vertical-writing'
import '@illusions-lab/milkdown-plugin-vertical-writing/style.css'
import { commonmark } from '@milkdown/preset-commonmark'
import { nord } from '@milkdown/theme-nord'
import { parse } from '@illusions-lab/mdi'
import { getMdi, initializeMdi, mdi } from '../src/index'
import '../src/style.css'
import markdown from './content.mdi?raw'
import './style.css'

declare global {
  interface Window {
    __MDI_SMOKE__?: { ready: boolean; serialized?: string; error?: string }
    __MDI_PERF__?: {
      loadBook: (minimumCharacters: number) => Promise<LargeDocumentMetrics>
    }
  }
}

interface LargeDocumentMetrics {
  sourceCharacters: number
  paragraphCount: number
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

const makeEditor = (source: string) => Editor.make()
  .config((ctx) => {
    ctx.set(rootCtx, '#editor')
    ctx.set(defaultValueCtx, source)
  })
  .config(nord)
  .use(commonmark)
  .use(mdi())
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
    editor = makeEditor(source)
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

    editor = makeEditor(markdown)
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
    window.__MDI_SMOKE__ = { ready: true, serialized }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    const details = error instanceof Error && error.stack ? `${message}\n${error.stack}` : message
    window.__MDI_SMOKE__ = { ready: false, error: details }
    setStatus(`Editor initialization failed: ${message}`, true)
    console.error(error)
  }
}

void start()
