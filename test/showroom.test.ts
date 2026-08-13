import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { editorStateCtx } from '@milkdown/core'
import { parse, serializeMdi } from '@illusions-lab/mdi'
import { describe, expect, it } from 'vitest'
import { getMdi } from '../src/index'
import { createEditor } from './harness'

interface JsonNode {
  type: string
  attrs?: { mdiIndent?: number | null; mdiBottom?: number | null; variant?: string | null }
}

const fixture = (name: string) => readFileSync(resolve('debug', name), 'utf8')

describe('example showroom contract', () => {
  it.each([
    ['content.mdi', 'editor-showroom'],
    ['kitchen-sink.mdi', 'kitchen-sink-showroom'],
  ])('loads %s with every supported block bridge active', async (name, fixtureName) => {
    const editor = await createEditor(fixture(name))
    const json = editor.action((ctx) => ctx.get(editorStateCtx).doc.toJSON())
    const content: JsonNode[] = json.content ?? []
    const pagebreaks = content.filter((node) => node.type === 'mdiPagebreak')
    const blanks = content.filter((node) => node.type === 'mdiBlank')
    const paragraphs = content.filter((node) => node.type === 'paragraph')

    expect(pagebreaks.map((node) => node.attrs?.variant)).toEqual([null, 'right', 'left'])
    expect(blanks.length).toBeGreaterThanOrEqual(2)
    expect(paragraphs).toEqual(expect.arrayContaining([
      expect.objectContaining({ attrs: { mdiIndent: 2, mdiBottom: null } }),
      expect.objectContaining({ attrs: { mdiIndent: null, mdiBottom: 0 } }),
      expect.objectContaining({ attrs: { mdiIndent: null, mdiBottom: 2 } }),
    ]))

    const source = editor.action(getMdi())
    expect(source).toContain(`debug-fixture: ${fixtureName}`)
    expect(source).toContain('[[indent:2]]')
    expect(source).toContain('[[bottom]]')
    expect(source).toContain('[[bottom:2]]')
    expect(source).toContain('[[pagebreak]]')
    expect(source).toContain('[[pagebreak:right]]')
    expect(source).toContain('[[pagebreak:left]]')
    expect(serializeMdi(source)).toBe(source)
    expect(() => parse(source)).not.toThrow()
  })
})
