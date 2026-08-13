import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = new URL('..', import.meta.url)
const work = mkdtempSync(join(tmpdir(), 'milkdown-mdi-consumer-'))
const run = (command, args, cwd = work) => execFileSync(command, args, { cwd, stdio: 'inherit' })
const installPeers = (version, tarball) => run('npm', ['install', '--no-package-lock', '--ignore-scripts', `./${tarball}`,
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
      await page.waitForFunction(() => window.__PACKAGE_CONSUMER__?.serialized)
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
        || result.blockJson !== JSON.stringify([
          { type: 'paragraph', attrs: { mdiIndent: null, mdiBottom: null } },
          { type: 'paragraph', attrs: { mdiIndent: 2, mdiBottom: null } },
          { type: 'paragraph', attrs: { mdiIndent: null, mdiBottom: 0 } },
          { type: 'mdiPagebreak', attrs: { variant: 'right' } },
          { type: 'mdiBlank' },
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
  run('npm', ['run', 'build'], root)
  const tarball = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', work], { cwd: root, encoding: 'utf8' }))[0].filename
  writeFileSync(join(work, 'package.json'), JSON.stringify({ private: true, type: 'module', scripts: { build: 'vite build' } }, null, 2))
  writeFileSync(join(work, 'contract.ts'), `
    import type { Ctx, MilkdownPlugin } from '@milkdown/ctx'
    import { getMdiTextBlocks, type MdiTextBlocksResult } from '@illusions-lab/mdi'
    import { getMdi, initializeMdi, mdi } from '@illusions-lab/milkdown-plugin-mdi'
    const plugins: MilkdownPlugin[] = mdi()
    const action: (ctx: Ctx) => string = getMdi()
    const initialized: Promise<void> = initializeMdi()
    const projection: MdiTextBlocksResult = getMdiTextBlocks('# typed consumer')
    void [plugins, action, initialized, projection]
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
    import { initializeMdi, mdi, getMdi } from '@illusions-lab/milkdown-plugin-mdi'
    import { getMdiTextBlocks, parse, renderText, serializeMdi } from '@illusions-lab/mdi'
    if (typeof initializeMdi !== 'function' || !Array.isArray(mdi()) || typeof getMdi !== 'function') process.exit(1)
    if ([getMdiTextBlocks, parse, renderText, serializeMdi].some((value) => typeof value !== 'function')) process.exit(1)
  `], { cwd: work, stdio: 'inherit' })
  writeFileSync(join(work, 'index.html'), '<div id="editor"></div><script type="module" src="/main.js"></script>')
  writeFileSync(join(work, 'main.js'), `
    import { Editor, defaultValueCtx, editorStateCtx, rootCtx } from '@milkdown/core'
    import { commonmark } from '@milkdown/preset-commonmark'
    import { getMdiTextBlocks, parse, renderText, serializeMdi } from '@illusions-lab/mdi'
    import { initializeMdi, mdi, getMdi } from '@illusions-lab/milkdown-plugin-mdi'
    import '@illusions-lab/milkdown-plugin-mdi/style.css'
    const start = async () => {
      await initializeMdi()
      const initial = [
        '---', 'title: Consumer Contract', '---', '',
        '{東京|とうきょう} ^12^', '',
        '[[indent:2]]', 'Indented', '',
        '[[bottom]]', 'Bottom', '',
        '[[pagebreak:right]]', '',
        '[[blank]]',
      ].join('\\n')
      const editor = Editor.make().config((ctx) => { ctx.set(rootCtx, '#editor'); ctx.set(defaultValueCtx, initial) }).use(commonmark).use(mdi())
      await editor.create()
      const serialized = editor.action(getMdi())
      const parsed = parse(serialized)
      const projection = getMdiTextBlocks(serialized)
      const repeatedProjection = getMdiTextBlocks(serialized)
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
        blockJson,
      }
    }
    void start()
  `)
  writeFileSync(join(work, 'vite.config.js'), "import { defineConfig } from 'vite'; export default defineConfig({ base: '/consumer/' })")
  buildAndAssert('minimum declared Milkdown peers')
  await browserSmoke()
} finally {
  rmSync(work, { recursive: true, force: true })
}
