import type { MilkdownPlugin } from '@milkdown/ctx'
import { defaultValueCtx, editorStateCtx, ParserReady } from '@milkdown/core'
import { MDI_COMMENT_IR_VERSION } from '@illusions-lab/mdi'
import { MDI_MDAST_PROVENANCE_VERSION, parseForMdast } from '@illusions-lab/mdi/internal/mdast'
import { $remark } from '@milkdown/utils'
import { describe, expect, it } from 'vitest'
import {
  getMdi,
  mdi,
  prepareMdiDocument,
  type PreparedMdiDocument,
} from '../src/index'
import { getMdiDocumentProvenance } from '../src/provenance'
import { normalizeMdiMdastTree, type StructuredCloneSafeMdast } from '../src/prepared'
import { createEditor } from './harness'

const source = [
  '---',
  'mdi: "2.0"',
  'title: Prepared parity',
  '---',
  '',
  '# 見出し',
  '',
  '前{東京|とうきょう}後  **強調**',
  '前[[warichu:一[[no-break:二**三**四]][[warichu:内注]]**e**́五[[br]][[br]]六]]後',
  'Invalid: [[kern:abc:text]] and ^too long^.',
  'Escaped literal: \\{東京|とうきょう} and \\*literal\\*.',
  '',
  '[[pagebreak:right]]',
].join('\n')

describe('prepared MDI document contract', () => {
  it('is structured-clone safe and reports original-input diagnostics', async () => {
    const malformed = source.replace('mdi: "2.0"', 'mdi: "3.0"')
    const prepared = await prepareMdiDocument(malformed)
    const cloned = structuredClone(prepared)

    expect(cloned).toEqual(prepared)
    expect(prepared.diagnostics).toEqual(parseForMdast(malformed).diagnostics)
    expect(prepared.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'mdi.version.unsupported',
    )
    expect(prepared).toMatchObject({
      version: 2,
      mdiIrVersion: MDI_COMMENT_IR_VERSION,
      provenanceVersion: MDI_MDAST_PROVENANCE_VERSION,
      canonicalSource: expect.any(String),
      document: { type: 'root', children: expect.any(Array) },
      frontmatter: expect.stringContaining('title: Prepared parity'),
      diagnostics: expect.any(Array),
      stats: {
        sourceUtf16Length: malformed.length,
        sourceBytes: new TextEncoder().encode(malformed).byteLength,
        blockCount: expect.any(Number),
      },
    })
  })

  it('builds the same ProseMirror document, serialized MDI and provenance', async () => {
    const prepared = await prepareMdiDocument(source)
    const preparedTypes = new Set<string>()
    const collectPreparedTypes = (node: StructuredCloneSafeMdast) => {
      preparedTypes.add(node.type)
      node.children?.forEach(collectPreparedTypes)
    }
    collectPreparedTypes(prepared.document)
    const synchronous = await createEditor(source)
    const fromPrepared = await createEditor('this value must not be parsed', [], {
      initialDocument: prepared,
    })

    const syncJson = synchronous.action((ctx) => ctx.get(editorStateCtx).doc.toJSON())
    const preparedJson = fromPrepared.action((ctx) => ctx.get(editorStateCtx).doc.toJSON())
    expect(preparedJson).toEqual(syncJson)
    expect(fromPrepared.action(getMdi())).toBe(synchronous.action(getMdi()))
    expect(fromPrepared.action(getMdi())).toContain('Escaped literal')
    expect(fromPrepared.action(getMdi())).toContain('東京|とうきょう')
    const provenanceContract = (editor: typeof synchronous) => editor.action((ctx) =>
      getMdiDocumentProvenance(ctx.get(editorStateCtx).doc),
    )
    expect(provenanceContract(fromPrepared)).toEqual(provenanceContract(synchronous))
    expect(prepared.frontmatter).toBe('mdi: "2.0"\ntitle: Prepared parity')
    expect(preparedTypes).toContain('mdiLiteralText')
  })

  it('does not run the Remark pipeline for a prepared initial document', async () => {
    const prepared = await prepareMdiDocument(source)
    const sentinelSource = 'non-canonical transport sentinel'
    const transported = { ...prepared, canonicalSource: sentinelSource }
    const rejectRemarkParse = $remark('reject-prepared-remark-parse', () => () => () => {
      throw new Error('prepared initial document entered Remark')
    })

    const editor = await createEditor('renderer source must be ignored', [...rejectRemarkParse], {
      initialDocument: transported,
    })
    expect(editor.action((ctx) => ctx.get(defaultValueCtx))).toBe(sentinelSource)
    expect(editor.action((ctx) => ctx.get(editorStateCtx).doc.textContent)).toContain('見出し')
  })

  it('rejects a prepared initial source mismatch without Remark fallback', async () => {
    const prepared = await prepareMdiDocument(source)
    const overrideInitialSource: MilkdownPlugin = (ctx) => async () => {
      await ctx.wait(ParserReady)
      ctx.set(defaultValueCtx, 'unexpected initial source')
    }

    await expect(createEditor(source, [overrideInitialSource], {
      initialDocument: prepared,
    })).rejects.toThrow(
      'Prepared MDI initial source mismatch; synchronous parsing fallback is disabled',
    )
  })

  it.each([
    ['version', 1],
    ['mdiIrVersion', 'future'],
    ['provenanceVersion', 'future'],
  ] as const)('rejects an incompatible %s without a synchronous fallback', (field, value) => {
    const incompatible = {
      version: 2,
      mdiIrVersion: MDI_COMMENT_IR_VERSION,
      provenanceVersion: MDI_MDAST_PROVENANCE_VERSION,
      canonicalSource: '',
      document: { type: 'root', children: [] },
      diagnostics: [],
      stats: { sourceUtf16Length: 0, sourceBytes: 0, blockCount: 0 },
      [field]: value,
    } as unknown as PreparedMdiDocument

    expect(() => mdi({ initialDocument: incompatible })).toThrow('Incompatible prepared MDI document')
  })

  it('rejects a prepared payload without an mdast root', () => {
    const incompatible = {
      version: 2,
      mdiIrVersion: MDI_COMMENT_IR_VERSION,
      provenanceVersion: MDI_MDAST_PROVENANCE_VERSION,
      canonicalSource: '',
      document: { type: 'paragraph', children: [] },
      diagnostics: [],
      stats: { sourceUtf16Length: 0, sourceBytes: 0, blockCount: 0 },
    } as unknown as PreparedMdiDocument

    expect(() => mdi({ initialDocument: incompatible })).toThrow('document must be an mdast root')
  })

  it('shares frontmatter, fallback and provenance normalization with the Remark path', () => {
    const target = { range: { start: '1:0', end: '1:3' } }
    const provenance = {
      role: 'textBearing',
      status: 'sourceBacked',
      span: { startByte: 0, endByte: 3 },
      targets: [target],
    }
    const tree: StructuredCloneSafeMdast = {
      type: 'root',
      children: [
        { type: 'yaml', value: 'title: Shared' },
        {
          type: 'paragraph',
          children: [{ type: 'text', value: 'a\nb', data: { mdiProvenance: provenance } }],
        },
        {
          type: 'unknownBlock',
          value: 'fallback',
          data: { mdiProvenance: provenance },
          children: [{ type: 'text', value: 'a\nb', data: { mdiProvenance: provenance } }],
        },
        {
          type: 'paragraph',
          children: [{ type: 'unknownInline', value: 'inline' }],
        },
        { type: 'strong', data: { mdiProvenance: provenance }, children: [] },
      ],
    }

    expect(normalizeMdiMdastTree(tree, 'a\nb')).toBe('title: Shared')
    expect(tree.children?.some((node) => node.type === 'yaml')).toBe(false)
    expect(tree.children?.[0]?.children?.map((node) => node.type)).toEqual([
      'text',
      'break',
      'text',
    ])
    expect(tree.children?.[1]).toMatchObject({ type: 'paragraph' })
    expect(tree.children?.[1]?.children?.map((node) => node.type)).toEqual([
      'text',
      'break',
      'text',
    ])
    expect(tree.children?.[1]?.children?.[0]?.data?.mdiBridgeSegments).toEqual(expect.any(Array))
    expect(tree.children?.[2]?.children?.[0]).toMatchObject({ type: 'text', value: 'inline' })
    expect(tree.children?.[3]?.position?.start.offset).toBe(0)
  })

  it('prepares every MDI node family without frontmatter', async () => {
    const prepared = await prepareMdiDocument([
      '{東京|とうきょう} ^12^ [[em:傍点]] [[no-break:禁則]]',
      '[[warichu:注記]] [[kern:-0.1em:字間]][[br]]改行',
      '',
      '[[blank]]',
      '',
      '[[pagebreak]]',
    ].join('\n'))
    const types = new Set<string>()
    const visit = (node: StructuredCloneSafeMdast) => {
      types.add(node.type)
      node.children?.forEach(visit)
    }
    visit(prepared.document)

    expect(prepared.frontmatter).toBeUndefined()
    expect([...types]).toEqual(expect.arrayContaining([
      'mdiRuby',
      'mdiTcy',
      'mdiEm',
      'mdiNoBreak',
      'mdiWarichu',
      'mdiKern',
      'mdiBreak',
      'mdiBlank',
      'mdiPagebreak',
    ]))
  })
})
