import { serializeMdi } from '@illusions-lab/mdi'
import { parseForMdast } from '@illusions-lab/mdi/internal/mdast'

interface LiteralNode {
  type?: string
  value?: string
  mdiLiteral?: boolean
  span?: { startByte: number; endByte: number }
  children?: LiteralNode[]
}

const placeholderNonce = (() => {
  const words = new Uint32Array(4)
  globalThis.crypto?.getRandomValues?.(words)
  if (words.some(Boolean)) return [...words].map((word) => word.toString(16).padStart(8, '0')).join('')
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`
})()
const placeholderPrefix = `<!--illusions-mdi-literal-${placeholderNonce}:`
const placeholderPattern = new RegExp(`${placeholderPrefix}([0-9a-f]*)-->`, 'g')

const escapeLiteralText = (value: string) => [...value].map((character) => (
  character === '《' || character === '》' || /[!-/:-@[-`{-~]/.test(character)
    ? `\\${character}`
    : character
)).join('')

export const literalPlaceholder = (value: string) => {
  const encoded = [...new TextEncoder().encode(value)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  return `${placeholderPrefix}${encoded}-->`
}

const restoreLiteralPlaceholders = (source: string) => source.replace(
  placeholderPattern,
  (_match, encoded: string) => {
    const bytes = Uint8Array.from(encoded.match(/.{2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? [])
    return escapeLiteralText(new TextDecoder().decode(bytes))
  },
)

const protectLiteralSource = (source: string) => {
  const ranges: Array<{ startByte: number; endByte: number; value: string }> = []
  const visit = (node: LiteralNode) => {
    if (node.type === 'text' && node.mdiLiteral === true && node.span && typeof node.value === 'string') {
      ranges.push({ ...node.span, value: node.value })
    }
    node.children?.forEach(visit)
  }
  try {
    visit({ children: parseForMdast(source).document.children as unknown as LiteralNode[] })
  } catch {
    return source
  }
  if (!ranges.length) return source

  const requested = new Set(ranges.flatMap(({ startByte, endByte }) => [startByte, endByte]))
  const offsets = new Map<number, number>([[0, 0]])
  let byte = 0
  let utf16 = 0
  for (const character of source) {
    const codePoint = character.codePointAt(0)!
    byte += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4
    utf16 += character.length
    if (requested.has(byte)) offsets.set(byte, utf16)
  }

  return ranges
    .map((range) => ({
      ...range,
      start: offsets.get(range.startByte),
      end: offsets.get(range.endByte),
    }))
    .filter((range): range is typeof range & { start: number; end: number } => (
      range.start !== undefined && range.end !== undefined
    ))
    .sort((left, right) => right.start - left.start)
    .reduce((result, range) => (
      `${result.slice(0, range.start)}${literalPlaceholder(range.value)}${result.slice(range.end)}`
    ), source)
}

export const canonicalizeMdiSource = (source: string) => {
  const first = serializeMdi(source)
  let candidate = first
  for (let pass = 0; pass < 8; pass += 1) {
    const next = serializeMdi(candidate)
    if (next === candidate) return restoreLiteralPlaceholders(candidate)
    candidate = next
  }
  return restoreLiteralPlaceholders(first)
}

export const canonicalizeMdiPreservingLiteralText = (source: string) => (
  canonicalizeMdiSource(protectLiteralSource(source))
)
