import { Buffer } from 'node:buffer'
import {
  formatMdiTextPosition,
  getMdiTextBlocks,
  parse,
  sourceSpansForTextRange,
  type MdiSourceSpan,
  type MdiTextBlock,
  type MdiTextRange,
} from '@illusions-lab/mdi'
import { describe, expect, it } from 'vitest'
import { getMdi } from '../src/index'
import { createEditor } from './harness'

const sourceFixture = [
  '---',
  'mdi: "2.0"',
  'title: Text block metadata',
  'document-revision: rev-42',
  '---',
  '',
  '# Unicode 👩🏽‍💻',
  '',
  'CommonMark **strong**、*emphasis*、~~deleted~~、`code`、[label](https://example.com)。',
  '',
  'MDI {東京|とうきょう}、{雪女|ゆき.おんな}、^12^、[[em:傍点]]、[[no-break:禁則]]、[[warichu:注記]]、[[kern:-0.1em:字間]][[br]]改行。',
  '',
  '> quote {京都|きょうと}',
  '',
  '- list ^34^',
  '- second',
  '',
  '| fallback | table |',
  '| - | - |',
  '| A | B |',
  '',
  '[[pagebreak]]',
].join('\n')

const textRange = (block: MdiTextBlock, start: number, length: number): MdiTextRange => ({
  start: formatMdiTextPosition({ block: block.index, character: start }),
  end: formatMdiTextPosition({ block: block.index, character: start + length }),
})

const graphemes = (value: string) => Array.from(
  new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(value),
  ({ segment }) => segment,
)

const rangeForText = (block: MdiTextBlock, value: string) => {
  const units = graphemes(block.text)
  const needle = graphemes(value)
  const start = units.findIndex((_unit, index) => needle.every((unit, offset) => units[index + offset] === unit))
  if (start < 0) throw new Error(`${JSON.stringify(value)} is absent from block ${block.index}`)
  return textRange(block, start + 1, needle.length)
}

const sourceSlices = (source: string, spans: MdiSourceSpan[]) => {
  const bytes = Buffer.from(source)
  return spans.map(({ startByte, endByte }) => bytes.subarray(startByte, endByte).toString())
}

const projectEditorSource = async (input = sourceFixture) => {
  const editor = await createEditor(input)
  const source = editor.action(getMdi())
  return { source, result: getMdiTextBlocks(source) }
}

describe('upstream MDI text-block integration', () => {
  it('projects canonical editor source through the complete upstream envelope', async () => {
    const { source, result } = await projectEditorSource()

    expect(result.projectionVersion).toBe('1.0')
    expect(result.positionEncoding).toBe('unicode-grapheme-cluster-1-based')
    expect(result.irVersion).toBe('1.0')
    expect(result.syntaxVersion).toBe('2.0')
    expect(result.document).toEqual(parse(source).document)
    expect(result.diagnostics).toEqual(parse(source).diagnostics)
    expect(result.document.frontmatter?.entries).toEqual(expect.arrayContaining([
      { key: 'title', value: 'Text block metadata' },
      { key: 'document-revision', value: 'rev-42' },
    ]))
    expect(result.blocks.every(({ text }) => !text.includes('Text block metadata') && !text.includes('rev-42'))).toBe(true)
    expect(getMdiTextBlocks(source)).toEqual(result)
  })

  it('returns exact source-order block kinds, text, and grapheme ranges', async () => {
    const { result } = await projectEditorSource()

    expect(result.blocks.map(({ index, kind, text, range }) => ({ index, kind, text, range }))).toEqual([
      { index: 1, kind: 'heading', text: 'Unicode 👩🏽‍💻', range: { start: '1:1', end: '1:10' } },
      {
        index: 2,
        kind: 'paragraph',
        text: 'CommonMark strong、emphasis、deleted、code、label。',
        range: { start: '2:1', end: '2:47' },
      },
      {
        index: 3,
        kind: 'paragraph',
        text: 'MDI 東京、雪女、12、傍点、禁則、注記、字間\n改行。',
        range: { start: '3:1', end: '3:29' },
      },
      { index: 4, kind: 'blockquote', text: 'quote 京都', range: { start: '4:1', end: '4:9' } },
      { index: 5, kind: 'listItem', text: 'list 34', range: { start: '5:1', end: '5:8' } },
      { index: 6, kind: 'listItem', text: 'second', range: { start: '6:1', end: '6:7' } },
      { index: 7, kind: 'table', text: 'fallback\ttable\nA\tB', range: { start: '7:1', end: '7:19' } },
    ])
  })

  it('maps CommonMark and inline MDI text to exact source bytes', async () => {
    const { source, result } = await projectEditorSource()
    const commonmark = result.blocks[1]
    const mdi = result.blocks[2]
    expect(commonmark).toBeDefined()
    expect(mdi).toBeDefined()

    for (const value of ['strong', 'emphasis', 'deleted', 'code', 'label']) {
      expect(sourceSlices(source, sourceSpansForTextRange(commonmark, rangeForText(commonmark, value)))).toEqual([value])
    }
    expect(sourceSlices(source, sourceSpansForTextRange(mdi, rangeForText(mdi, '東京')))).toEqual(['東京'])
    expect(sourceSlices(source, sourceSpansForTextRange(mdi, rangeForText(mdi, '12')))).toEqual(['12'])
    expect(sourceSlices(source, sourceSpansForTextRange(mdi, rangeForText(mdi, '\n')))).toEqual(['[[br]]'])
    expect(result.blocks.every(({ sourceMap }) => sourceMap.unmapped.length === 0)).toBe(true)
  })

  it('retains group and split ruby readings as independently mapped annotations', async () => {
    const { source, result } = await projectEditorSource()
    const mdi = result.blocks[2]

    expect(mdi.annotations.map(({ kind, text, anchor }) => ({ kind, text, anchor }))).toEqual([
      { kind: 'rubyReading', text: 'とうきょう', anchor: { start: '3:5', end: '3:7' } },
      { kind: 'rubyReading', text: 'ゆき', anchor: { start: '3:8', end: '3:9' } },
      { kind: 'rubyReading', text: 'おんな', anchor: { start: '3:9', end: '3:10' } },
    ])
    expect(mdi.annotations.map(({ span }) => sourceSlices(source, span ? [span] : []))).toEqual([
      ['とうきょう'],
      ['ゆき'],
      ['おんな'],
    ])
    expect(mdi.annotations.every(({ sourceMap }) => sourceMap.unmapped.length === 0)).toBe(true)
  })

  it('marks table separators as synthetic without manufacturing source spans', async () => {
    const { source, result } = await projectEditorSource()
    const table = result.blocks[6]

    expect(table.sourceMap.synthetic).toEqual([
      { start: '7:9', end: '7:10' },
      { start: '7:15', end: '7:16' },
      { start: '7:17', end: '7:18' },
    ])
    for (const separator of ['\t', '\n']) {
      expect(sourceSlices(source, sourceSpansForTextRange(table, rangeForText(table, separator)))).toEqual([])
    }
    expect(result.blocks.some(({ text }) => text.includes('pagebreak'))).toBe(false)
  })

  it.each([
    '{東京|とうきょう',
    '^123456789^',
    '[[em:未完',
    '[[kern:calc(1em):字]]',
    '---\nmissing close',
    '[[no-break:[[warichu:^123^]]]',
  ])('keeps malformed canonical editor source deterministic and non-panicking: %j', async (input) => {
    const { source, result } = await projectEditorSource(input)

    expect(result.projectionVersion).toBe('1.0')
    expect(result.document).toEqual(parse(source).document)
    expect(getMdiTextBlocks(source)).toEqual(result)
    expect(result.blocks.every(({ index, range, sourceMap, node }) => (
      index >= 1
      && range.start.startsWith(`${index}:`)
      && range.end.startsWith(`${index}:`)
      && Array.isArray(sourceMap.runs)
      && typeof node.type === 'string'
    ))).toBe(true)
  })
})
