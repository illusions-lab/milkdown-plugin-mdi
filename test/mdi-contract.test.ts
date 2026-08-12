import { parse, renderText, serializeMdi } from '@illusions-lab/mdi'
import { describe, expect, it } from 'vitest'
import * as milkdownMdi from '../src/index'
import { getMdi } from '../src/index'
import { createEditor } from './harness'

const completeDocument = [
  '---',
  'mdi: "2.0"',
  'title: Contract metadata',
  'custom-key: retained metadata',
  '---',
  '',
  '# Unicode 本文 👩🏽‍💻',
  '',
  'CommonMark **strong**、*emphasis*、~~deleted~~、`code`、[link](https://example.com)。',
  '',
  'MDI {東京|とうきょう}、{雪女|ゆき.おんな}、^12^、[[em:●:傍点]]、[[no-break:禁則]]、[[warichu:注記]]、[[kern:-0.1em:字間]][[br]]改行。',
  '',
  '> blockquote',
  '',
  '- list one',
  '- list two',
  '',
  '| fallback | table |',
  '| - | - |',
  '| A | B |',
  '',
  '[[pagebreak]]',
].join('\n')

describe('canonical MDI cross-package contract', () => {
  it('hands a complete canonical editor source to MDI parsing and text projection', async () => {
    const editor = await createEditor(completeDocument)
    const source = editor.action(getMdi())

    const result = parse(source)
    const firstText = renderText(source)
    const secondText = renderText(source)

    expect(serializeMdi(source)).toBe(source)
    expect(secondText).toBe(firstText)
    expect(result.document.frontmatter?.entries).toEqual(expect.arrayContaining([
      { key: 'mdi', value: '2.0' },
      { key: 'title', value: 'Contract metadata' },
      { key: 'custom-key', value: 'retained metadata' },
    ]))

    expect(firstText).not.toContain('Contract metadata')
    expect(firstText).not.toContain('retained metadata')
    expect(firstText).toContain('Unicode 本文 👩🏽‍💻')
    expect(firstText).toContain('CommonMark strong、emphasis、deleted、code、link。')
    expect(firstText).toContain('MDI 東京、雪女、12、傍点、禁則、注記、字間')
    expect(firstText).toContain('blockquote')
    expect(firstText).toContain('list one')

    // Unsupported block extensions remain editable literal Markdown, but the
    // complete editor output still satisfies the upstream MDI source contract.
    expect(source).toContain('fallback')
    expect(source).toContain('[[pagebreak]]')
    expect(() => parse(source)).not.toThrow()
  })

  it.each([
    '{東京|とうきょう',
    '^123456789^',
    '[[em:未完',
    '[[kern:calc(1em):字]]',
    '{👨‍👩‍👧‍👦|x.y}',
    '***',
    '---\nmissing close',
    '[[no-break:[[warichu:^123^]]]',
  ])('keeps malformed editor input serializable and reparsable: %j', async (input) => {
    const editor = await createEditor(input)
    const source = editor.action(getMdi())

    expect(typeof source).toBe('string')
    expect(() => parse(source)).not.toThrow()
    expect(() => renderText(source)).not.toThrow()

    const serialized = serializeMdi(source)
    expect(() => parse(serialized)).not.toThrow()
    expect(serializeMdi(serialized)).toBe(serialized)
  })

  it('does not add proxy analysis APIs to the plugin public surface', () => {
    expect(Object.keys(milkdownMdi).sort()).toEqual([
      'getMdi',
      'initializeMdi',
      'insertMdiRubyCommand',
      'mdi',
      'mdiClipboardSerializer',
      'toggleMdiTcyCommand',
    ])
    expect(milkdownMdi).not.toHaveProperty('getMdiIR')
    expect(milkdownMdi).not.toHaveProperty('getMdiText')
    expect(milkdownMdi).not.toHaveProperty('getMdiTextBlocks')
  })
})
