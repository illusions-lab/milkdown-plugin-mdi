import { performance } from 'node:perf_hooks'
import { editorStateCtx } from '@milkdown/core'
import { describe, expect, it } from 'vitest'
import { createEditor } from './harness'

const runPerformanceTests = process.env.RUN_PERFORMANCE_TESTS === '1'

// A book contains many editable blocks. Bounded paragraphs avoid measuring an
// unrealistic single multi-million-character DOM node.
const makeBookSource = (minimumCharacters: number) => {
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

const maximumLoadMs = (name: '1M' | '10M') => {
  const configured = process.env[`MDI_${name}_LOAD_MAX_MS`]
  // Conservative CI guardrails. Dedicated runners can provide tighter limits.
  return Number(configured ?? (name === '1M' ? 60_000 : 300_000))
}

describe.runIf(runPerformanceTests)('large-document loading performance', () => {
  it('loads a one-million-character MDI book within the configured budget', async () => {
    const source = makeBookSource(1_000_000)
    const startedAt = performance.now()
    const editor = await createEditor(source)
    const elapsedMs = performance.now() - startedAt
    const textLength = editor.action((ctx) => ctx.get(editorStateCtx).doc.textContent.length)

    console.info(`[performance] 1M characters: ${elapsedMs.toFixed(1)} ms`)
    expect(source.length).toBeGreaterThanOrEqual(1_000_000)
    expect(textLength).toBeGreaterThan(990_000)
    expect(elapsedMs).toBeLessThan(maximumLoadMs('1M'))
  }, 90_000)

  it('loads a ten-million-character MDI book within the configured budget', async () => {
    const source = makeBookSource(10_000_000)
    const startedAt = performance.now()
    const editor = await createEditor(source)
    const elapsedMs = performance.now() - startedAt
    const textLength = editor.action((ctx) => ctx.get(editorStateCtx).doc.textContent.length)

    console.info(`[performance] 10M characters: ${elapsedMs.toFixed(1)} ms`)
    expect(source.length).toBeGreaterThanOrEqual(10_000_000)
    expect(textLength).toBeGreaterThan(9_900_000)
    expect(elapsedMs).toBeLessThan(maximumLoadMs('10M'))
  }, 360_000)
})
