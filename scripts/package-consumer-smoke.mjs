import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = new URL('..', import.meta.url)
const work = mkdtempSync(join(tmpdir(), 'milkdown-mdi-consumer-'))
const run = (command, args, cwd = work) => execFileSync(command, args, { cwd, stdio: 'inherit' })
const installPeers = (version, tarball) => run('npm', ['install', '--no-package-lock', '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline', tarball,
  `@milkdown/core@${version}`, `@milkdown/ctx@${version}`, `@milkdown/prose@${version}`,
  `@milkdown/utils@${version}`, `@milkdown/preset-commonmark@${version}`, 'typescript@5.9.3', 'vite@6.4.3'])

const buildAndAssert = (label) => {
  run('npm', ['exec', '--', 'tsc', '-p', 'tsconfig.json'])
  run('npm', ['run', 'build'])
  const output = join(work, 'dist')
  const html = readFileSync(join(output, 'index.html'), 'utf8')
  if (!html.includes('/consumer/assets/')) throw new Error('consumer did not honor non-root base path')
  const assets = readdirSync(join(output, 'assets'))
  for (const extension of ['.js', '.css', '.wasm']) {
    if (!assets.some((name) => name.endsWith(extension))) throw new Error(`consumer bundle has no ${extension} asset`)
  }
  console.log(`package consumer build passed (${label})`)
}

const browserSmoke = async () => {
  const { chromium, firefox, webkit } = await import('playwright')
  const output = join(work, 'dist')
  const server = createServer((request, response) => {
    const path = request.url === '/consumer/' ? join(output, 'index.html') : join(output, request.url?.replace('/consumer/', '') ?? '')
    const extension = path.split('.').pop()
    const contentType = extension === 'wasm' ? 'application/wasm' : extension === 'css' ? 'text/css' : extension === 'js' ? 'text/javascript' : 'text/html'
    try {
      const body = readFileSync(path)
      response.writeHead(200, { 'content-type': contentType })
      response.end(body)
    } catch {
      response.writeHead(404)
      response.end()
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('consumer server did not bind a TCP port')
  try {
    const engines = process.env.PLAYWRIGHT_BROWSERS === 'all'
      ? [['chromium', chromium], ['firefox', firefox], ['webkit', webkit]]
      : [['chromium', chromium]]
    for (const [name, engine] of engines) {
      const browser = await engine.launch()
      const page = await browser.newPage()
      const errors = []
      page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
      page.on('pageerror', (error) => errors.push(error.message))
      await page.goto(`http://127.0.0.1:${address.port}/consumer/`)
      await page.waitForFunction(() => window.__PACKAGE_CONSUMER__?.serialized).catch((error) => {
        throw new Error(`${name} package consumer did not become ready: ${errors.join('\n')}`, {
          cause: error,
        })
      })
      await page.waitForFunction(() => document.querySelector('#warichu-consumer .mdi-warichu-editable-line[data-mdi-row="1"]'))
      const noteGeometry = await page.locator('#warichu-consumer .mdi-warichu-space').evaluateAll(elements => elements.every(element => !element.textContent && element.getAttribute('aria-hidden') === 'true'))
      if (!noteGeometry) throw new Error(`${name} packed warichu widgets are not empty presentation spacers`)
      const result = await page.evaluate(() => ({
        ...window.__PACKAGE_CONSUMER__,
        tcy: getComputedStyle(document.querySelector('.mdi-tcy')).textCombineUpright,
        blankMinBlockSize: getComputedStyle(document.querySelector('.mdi-blank')).minBlockSize,
        pagebreakAfter: getComputedStyle(document.querySelector('.mdi-pagebreak')).breakAfter,
        indentMargin: getComputedStyle(document.querySelector('.mdi-indent')).marginBlockStart,
      }))
      if (!result.serialized?.includes('{東京|とうきょう}')
        || !result.serialized?.includes('[[indent:2]]')
        || !result.serialized?.includes('[[bottom]]')
        || !result.serialized?.includes('[[pagebreak:right]]')
        || !result.serialized?.includes('<!--consumer note-->')
        || result.text?.includes('consumer note')
        || !result.canonical
        || result.frontmatterTitle !== 'Consumer Contract'
        || !result.text?.includes('東京 12')
        || result.text.includes('Consumer Contract')
        || result.projectionVersion !== '1.0'
        || result.positionEncoding !== 'unicode-grapheme-cluster-1-based'
        || result.projectedBlocksJson !== JSON.stringify([
          { index: 1, kind: 'paragraph', text: '東京 12', range: { start: '1:1', end: '1:6' } },
          { index: 2, kind: 'paragraph', text: 'Indented', range: { start: '2:1', end: '2:9' } },
          { index: 3, kind: 'paragraph', text: 'Bottom', range: { start: '3:1', end: '3:7' } },
        ])
        || !result.projectionHasDocument
        || !result.projectionHasSourceMap
        || !result.projectionHasRubyAnnotation
        || !result.projectionDeterministic
        || result.mappedRubyMatches !== 1
        || result.preparedVersion !== 2
        || !result.preparedCloneSafe
        || result.workerPreparedVersion !== 2
        || !result.clipboardParsed
        || result.blockJson !== JSON.stringify([
          { type: 'paragraph', attrs: { mdiIndent: null, mdiBottom: null, mdiBlank: false } },
          { type: 'paragraph', attrs: { mdiIndent: 2, mdiBottom: null, mdiBlank: false } },
          { type: 'paragraph', attrs: { mdiIndent: null, mdiBottom: 0, mdiBlank: false } },
          { type: 'mdiPagebreak', attrs: { variant: 'right' } },
          { type: 'paragraph', attrs: { mdiIndent: null, mdiBottom: null, mdiBlank: true } },
        ])
        || result.tcy !== 'all'
        || result.blankMinBlockSize === '0px'
        || result.pagebreakAfter !== 'right'
        || result.indentMargin === '0px'
        || errors.length) throw new Error(`${name} package consumer failure: ${errors.join('\n')}\n${JSON.stringify(result, null, 2)}`)
      await browser.close()
    }
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}

try {
  const registryVersion = process.env.REGISTRY_PLUGIN_VERSION
  if (registryVersion && !/^0\.8\.\d+$/.test(registryVersion)) throw new Error('Invalid registry plugin version')
  if (!registryVersion) run('npm', ['run', 'build'], root)
  const tarball = registryVersion
    ? `@illusions-lab/milkdown-plugin-mdi@${registryVersion}`
    : './' + JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', work], { cwd: root, encoding: 'utf8' }))[0].filename
  writeFileSync(join(work, 'package.json'), JSON.stringify({ private: true, type: 'module', scripts: { build: 'vite build' } }, null, 2))
  writeFileSync(join(work, 'contract.ts'), `
    import type { Ctx, MilkdownPlugin } from '@milkdown/ctx'
    import { getMdiTextBlocks, type MdiTextBlocksResult } from '@illusions-lab/mdi'
    import type { Command } from '@milkdown/prose/state'
    import {
      createMdiEditorMapping,
      getMdi,
      initializeMdi,
      mdi,
      mdiClipboard,
      mdiEditCommand,
      mdiInputRules,
      mapMdiSourceSpansToEditorRanges,
      prepareMdiDocument,
      type PreparedMdiDocument,
    } from '@illusions-lab/milkdown-plugin-mdi'
    import {
      hasCompatiblePreparedMdiDocumentVersions,
      initializeMdi as initializeMdiForWorker,
      prepareMdiDocument as prepareMdiDocumentInWorker,
      type PreparedMdiDocument as WorkerPreparedMdiDocument,
    } from '@illusions-lab/milkdown-plugin-mdi/prepared'
    const plugins: MilkdownPlugin[] = mdi()
    const optionalPlugins: MilkdownPlugin[] = [mdiInputRules(), mdiClipboard()]
    const command: Command = mdiEditCommand({ type: 'insertBlank' })
    const action: (ctx: Ctx) => string = getMdi()
    const mappingAction = createMdiEditorMapping()
    const batchMapping = mapMdiSourceSpansToEditorRanges
    const initialized: Promise<void> = initializeMdi()
    const prepare: (source: string) => Promise<PreparedMdiDocument> = prepareMdiDocument
    const workerPrepare: (source: string) => Promise<WorkerPreparedMdiDocument> = prepareMdiDocumentInWorker
    const workerInitialized: Promise<void> = initializeMdiForWorker()
    const preparedOptions: NonNullable<Parameters<typeof mdi>[0]> = { initialDocument: undefined }
    const projection: MdiTextBlocksResult = getMdiTextBlocks('# typed consumer<!--note-->', { includeComments: true })
    const compatible: boolean = hasCompatiblePreparedMdiDocumentVersions({ version: 2, mdiIrVersion: '1.1', provenanceVersion: '1.0' })
    void compatible
    void [plugins, optionalPlugins, command, action, mappingAction, batchMapping, initialized, prepare, workerPrepare, workerInitialized, preparedOptions, projection]
  `)
  writeFileSync(join(work, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      lib: ['ES2022', 'DOM', 'DOM.Iterable'],
      module: 'ESNext',
      moduleResolution: 'Bundler',
      noEmit: true,
      strict: true,
      target: 'ES2022',
    },
    include: ['contract.ts'],
  }, null, 2))
  // Verify the minimum declared peer versions in an otherwise clean consumer.
  installPeers('7.21.3', tarball)
  execFileSync(process.execPath, ['--input-type=module', '--eval', `
    import {
      createMdiEditorMapping, initializeMdi, mdi, mdiClipboard,
      mdiEditCommand, mdiInputRules, mapMdiSourceSpansToEditorRanges, getMdi,
      prepareMdiDocument,
    } from '@illusions-lab/milkdown-plugin-mdi'
    import {
      hasCompatiblePreparedMdiDocumentVersions,
      initializeMdi as initializeMdiForWorker,
      prepareMdiDocument as prepareMdiDocumentInWorker,
    } from '@illusions-lab/milkdown-plugin-mdi/prepared'
    import { getMdiTextBlocks, parse, renderText, serializeMdi } from '@illusions-lab/mdi'
    await initializeMdi()
    const prepared = await prepareMdiDocument('{東京|とうきょう}<!--worker note-->')
    if (
      typeof initializeMdi !== 'function' || typeof initializeMdiForWorker !== 'function'
      || typeof prepareMdiDocumentInWorker !== 'function'
      || !Array.isArray(mdi()) || typeof getMdi !== 'function'
      || typeof createMdiEditorMapping !== 'function' || typeof mdiEditCommand !== 'function'
      || typeof mapMdiSourceSpansToEditorRanges !== 'function'
      || typeof mdiInputRules() !== 'function' || typeof mdiClipboard() !== 'function'
      || prepared.version !== 2 || structuredClone(prepared).canonicalSource !== prepared.canonicalSource
      || !hasCompatiblePreparedMdiDocumentVersions(prepared)
      || hasCompatiblePreparedMdiDocumentVersions({ ...prepared, mdiIrVersion: '1.0' })
      || !Array.isArray(mdi({ initialDocument: prepared }))
    ) process.exit(1)
    if ([getMdiTextBlocks, parse, renderText, serializeMdi].some((value) => typeof value !== 'function')) process.exit(1)
  `], { cwd: work, stdio: 'inherit' })
  writeFileSync(join(work, 'index.html'), '<div id="editor"></div><script type="module" src="/main.js"></script>')
  writeFileSync(join(work, 'prepared-worker.js'), `
    import {
      initializeMdi,
      prepareMdiDocument,
    } from '@illusions-lab/milkdown-plugin-mdi/prepared'

    void initializeMdi()
      .then(() => prepareMdiDocument('{東京|とうきょう}<!--worker note-->'))
      .then((prepared) => {
        postMessage({ commentsPreserved: prepared.canonicalSource.includes('<!--worker note-->'), version: prepared.version, cloneSafe: structuredClone(prepared).version === 2 })
      })
      .catch((error) => { throw error })
  `)
  writeFileSync(join(work, 'main.js'), `
    import { Editor, defaultValueCtx, editorStateCtx, rootCtx } from '@milkdown/core'
    import { commonmark } from '@milkdown/preset-commonmark'
    import { getMdiTextBlocks, parse, renderText, serializeMdi } from '@illusions-lab/mdi'
    import {
      createMdiEditorMapping, initializeMdi, mapMdiSourceSpansToEditorRanges,
      mdi, mdiClipboard, mdiInputRules, parseMdiClipboard, getMdi, prepareMdiDocument,
    } from '@illusions-lab/milkdown-plugin-mdi'
    import '@illusions-lab/milkdown-plugin-mdi/style.css'
    const start = async () => {
      await initializeMdi()
      const initial = [
        '---', 'title: Consumer Contract', '---', '',
        '{東京|とうきょう}<!--consumer note--> ^12^', '',
        '[[indent:2]]', 'Indented', '',
        '[[bottom]]', 'Bottom', '',
        '[[pagebreak:right]]', '',
        '[[blank]]',
      ].join('\\n')
      const prepared = await prepareMdiDocument(initial)
      const preparedCloneSafe = structuredClone(prepared).canonicalSource === prepared.canonicalSource
      const workerPreparedVersion = await new Promise((resolve, reject) => {
        const worker = new Worker(new URL('./prepared-worker.js', import.meta.url), { type: 'module' })
        worker.addEventListener('message', ({ data }) => {
          worker.terminate()
          if (!data?.cloneSafe || !data?.commentsPreserved) reject(new Error('prepared Worker result is not clone safe'))
          else resolve(data.version)
        }, { once: true })
        worker.addEventListener('error', reject, { once: true })
      })
      const editor = Editor.make().config((ctx) => { ctx.set(rootCtx, '#editor'); ctx.set(defaultValueCtx, initial) }).use(commonmark).use(mdi({ initialDocument: prepared })).use([mdiInputRules(), mdiClipboard()])
      await editor.create()
      const serialized = editor.action(getMdi())
      const parsed = parse(serialized)
      const projection = getMdiTextBlocks(serialized)
      const repeatedProjection = getMdiTextBlocks(serialized)
      const rubyOffset = serialized.indexOf('東京')
      const rubyStartByte = new TextEncoder().encode(serialized.slice(0, rubyOffset)).length
      const mapping = editor.action(createMdiEditorMapping())
      const mappedRuby = mapMdiSourceSpansToEditorRanges(mapping, [{
        startByte: rubyStartByte,
        endByte: rubyStartByte + new TextEncoder().encode('東京').length,
      }])[0]
      const clipboardParsed = editor.action(parseMdiClipboard('{字|じ}', { explicit: true }))
      const blockJson = editor.action((ctx) => JSON.stringify(
        ctx.get(editorStateCtx).doc.toJSON().content.map(({ type, attrs }) => ({
          type,
          ...(attrs ? { attrs } : {}),
        })),
      ))
      window.__PACKAGE_CONSUMER__ = {
        serialized,
        canonical: serializeMdi(serialized) === serialized,
        frontmatterTitle: parsed.document.frontmatter?.entries.find(({ key }) => key === 'title')?.value,
        text: renderText(serialized),
        projectionVersion: projection.projectionVersion,
        positionEncoding: projection.positionEncoding,
        projectedBlocksJson: JSON.stringify(projection.blocks.map(({ index, kind, text, range }) => ({ index, kind, text, range }))),
        projectionHasDocument: projection.document.frontmatter?.entries.some(({ key, value }) => key === 'title' && value === 'Consumer Contract'),
        projectionHasSourceMap: projection.blocks[0]?.sourceMap.runs.length > 0,
        projectionHasRubyAnnotation: projection.blocks[0]?.annotations[0]?.text === 'とうきょう',
        projectionDeterministic: JSON.stringify(projection) === JSON.stringify(repeatedProjection),
        mappedRubyMatches: mappedRuby.matches.length,
        preparedVersion: prepared.version,
        preparedCloneSafe,
        workerPreparedVersion,
        clipboardParsed: clipboardParsed !== null,
        blockJson,
      }
      const noteRoot = document.createElement('div')
      noteRoot.id = 'warichu-consumer'
      noteRoot.style.cssText = 'font-size:20px;width:180px'
      document.body.append(noteRoot)
      const noteEditor = Editor.make().config(ctx => { ctx.set(rootCtx, noteRoot); ctx.set(defaultValueCtx, '前[[warichu:一二三四五六七八九十]]後') }).use(commonmark).use(mdi())
      await noteEditor.create()
    }
    void start()
  `)
  writeFileSync(join(work, 'vite.config.js'), "import { defineConfig } from 'vite'; export default defineConfig({ base: '/consumer/' })")
  buildAndAssert('minimum declared Milkdown peers')
  await browserSmoke()
} finally {
  rmSync(work, { recursive: true, force: true })
}
