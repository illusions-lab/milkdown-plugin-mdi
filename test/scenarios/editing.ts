// Positions are ProseMirror positions, not UTF-16 offsets into Markdown.
export const editingScenarios = [
  { name: 'empty', source: '', from: 1, key: 'Enter' },
  { name: 'paragraph start', source: 'abc', from: 1, key: 'Enter' },
  { name: 'paragraph middle', source: 'abc', from: 2, key: 'Enter' },
  { name: 'paragraph end', source: 'abc', from: 4, key: 'Enter' },
  { name: 'heading end', source: '# abc', from: 4, key: 'Enter' },
  { name: 'heading middle', source: '# abc', from: 2, key: 'Enter' },
  { name: 'list split', source: '- abc', from: 4, key: 'Enter' },
  { name: 'quote split', source: '> abc', from: 3, key: 'Enter' },
  { name: 'code newline', source: '```\nabc\n```', from: 2, key: 'Enter' },
  { name: 'soft break', source: 'abc', from: 2, key: 'Shift+Enter' },
  { name: 'backward merge', source: 'abc\n\ndef', from: 6, key: 'Backspace' },
  { name: 'forward merge', source: 'abc\n\ndef', from: 4, key: 'Delete' },
  { name: 'range replacement', source: 'abc\n\ndef', from: 2, to: 7, text: '日本' },
] as const

// Ignore only source provenance and default MDI attributes absent in CommonMark.
export function comparable(value: any): any {
  if (Array.isArray(value)) return value.map(comparable)
  if (!value || typeof value !== 'object') return value
  const result: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (key === 'span') continue
    if (['mdiBlank', 'mdiIndent', 'mdiBottom'].includes(key) && (child === false || child === null)) continue
    const normalized = comparable(child)
    if (key === 'attrs' && Object.keys(normalized).length === 0) continue
    result[key] = normalized
  }
  return result
}
