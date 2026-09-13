import { editorViewCtx } from '@milkdown/core'
import { TextSelection } from '@milkdown/prose/state'
import { DecorationSet } from '@milkdown/prose/view'
import { afterEach, expect, it, vi } from 'vitest'
import { createEditor } from './harness'
import { getMdi } from '../src/index'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); delete (Range.prototype as unknown as Record<string, unknown>).getBoundingClientRect })

it('lays out semantic leaves as presentation transactions, freezes composition and cleans up', async () => {
  let resize!: () => void
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback }
    observe() {}
    disconnect() {}
  })
  vi.spyOn(window, 'scrollBy').mockImplementation(() => {})
  const frames: FrameRequestCallback[] = []
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) {
    const width = this.tagName === 'P' ? 200 : Math.max(10, (this.textContent?.length ?? 1) * 10)
    return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: 20, width, height: 20, toJSON() {} }
  })
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => ({ left: 0, right: 10, top: 0, bottom: 10, width: 10, height: 10 }) })
  const editor = await createEditor('前[[warichu:一**二**三{東京|とうきょう}^12^[[no-break:四五]][[warichu:六七]]é[[br]]八九]]後')
  editor.action(ctx => {
    const view = ctx.get(editorViewCtx)
    view.coordsAtPos = () => ({ left: 10, right: 10, top: 0, bottom: 20 })
    view.dom.querySelectorAll('p').forEach(paragraph => { paragraph.style.fontSize = '20px' })
    const canonical = getMdi()(ctx)
    const dispatch = vi.spyOn(view, 'dispatch')
    const flush = () => { for (let i = 0; frames.length && i < 10; i += 1) frames.shift()!(0) }
    flush()
    expect(view.dom.querySelectorAll('.mdi-warichu-space').length).toBeGreaterThan(0)
    resize()
    flush()
    const settled = dispatch.mock.calls.length
    const stableWidget = view.dom.querySelector('.mdi-warichu-space')
    resize()
    flush()
    expect(dispatch.mock.calls.length).toBe(settled)
    expect(view.dom.querySelector('.mdi-warichu-space')).toBe(stableWidget)
    view.dom.style.letterSpacing = '1px'
    resize()
    flush()
    expect(dispatch.mock.calls.length).toBeGreaterThan(settled)
    view.dom.style.writingMode = 'vertical-rl'
    resize()
    flush()
    view.dom.style.writingMode = 'horizontal-tb'
    resize()
    flush()
    expect(pluginOutside()).toBe(false)
    function pluginOutside() {
      const plugin = view.state.plugins.find(candidate => candidate.getState(view.state) instanceof DecorationSet && candidate.props.handleKeyDown)!
      return plugin.props.handleDOMEvents?.mousedown?.call(plugin, view, new MouseEvent('mousedown', { clientX: 10000, clientY: 10000 }))
    }
    expect(getMdi()(ctx)).toBe(canonical)
    expect(dispatch.mock.calls.every(([transaction]) => !transaction.docChanged && transaction.getMeta('addToHistory') === false)).toBe(true)
    const plugin = view.state.plugins.find(candidate => candidate.getState(view.state) instanceof DecorationSet && candidate.props.handleKeyDown)!
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 4)))
    expect(plugin.props.handleClick?.call(plugin, view, 0, new MouseEvent('click', { clientX: 1, clientY: 1, detail: 1 }))).toBe(true)
    expect(plugin.props.handleClick?.call(plugin, view, 0, new MouseEvent('click', { clientX: 10000, clientY: 10000, detail: 1 }))).toBe(false)
    expect(plugin.props.handleClick?.call(plugin, view, 0, new MouseEvent('click', { button: 2 }))).toBe(false)
    expect(plugin.props.handleClick?.call(plugin, view, 0, new MouseEvent('click', { clientX: 15, clientY: 1, detail: 1 }))).toBe(false)
    view.posAtCoords = () => ({ pos: 1, inside: 0 })
    expect(plugin.props.handleDOMEvents?.mousedown?.call(plugin, view, new MouseEvent('mousedown', { clientX: 1, clientY: 1, detail: 1 }))).toBe(false)
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 1000, clientY: 1000 }))
    expect(view.state.selection.from).toBe(1)
    document.dispatchEvent(new MouseEvent('mouseup', { clientX: 1000, clientY: 1000 }))
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 4)))
    const arrow = (key: string, shiftKey = false) => plugin.props.handleKeyDown?.call(plugin, view, new KeyboardEvent('keydown', { key, shiftKey }))
    expect(arrow('ArrowRight')).toBe(true)
    expect(arrow('ArrowLeft')).toBe(true)
    expect(arrow('ArrowRight', true)).toBe(true)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 4)))
    const enter = new KeyboardEvent('keydown', { key: 'Enter' })
    expect(plugin.props.handleKeyDown?.call(plugin, view, enter)).toBe(true)
    expect(view.dom.parentElement?.querySelector('[role="status"]')?.textContent).toContain('automatic')
    expect(plugin.props.handleKeyDown?.call(plugin, view, new KeyboardEvent('keydown', { key: 'a' }))).toBe(false)
    plugin.props.handleDOMEvents?.compositionstart?.call(plugin, view, new CompositionEvent('compositionstart'))
    const frozen = view.dom.innerHTML
    expect(plugin.props.handleKeyDown?.call(plugin, view, enter)).toBe(false)
    flush()
    expect(view.dom.innerHTML).toBe(frozen)
    plugin.props.handleDOMEvents?.compositionend?.call(plugin, view, new CompositionEvent('compositionend'))
    view.dispatch(view.state.tr.insertText('注'))
    flush()
    expect(getMdi()(ctx)).toContain('注')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)))
    expect(plugin.props.handleKeyDown?.call(plugin, view, enter)).toBe(false)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)))
    expect(arrow('Delete')).toBe(true)
    const note = view.state.doc.nodeAt(2)!
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2 + note.nodeSize)))
    expect(arrow('Backspace')).toBe(true)
    view.dispatch(view.state.tr.insert(3, view.state.schema.nodes.image!.create({ src: 'https://example.test/x.png', alt: '図' })))
    flush()
    expect(getMdi()(ctx)).toContain('![図]')
    view.dom.style.writingMode = 'vertical-rl'
    view.dom.querySelectorAll('p').forEach(paragraph => { paragraph.style.writingMode = 'vertical-rl' })
    expect(arrow('ArrowUp')).toBe(true)
    view.dispatch(view.state.tr.insertText('縦'))
    flush()
    expect(view.dom.querySelector('.mdi-warichu-space')).not.toBeNull()
    plugin.props.handleClick?.call(plugin, view, 0, new MouseEvent('click', { clientX: 1, clientY: 8, detail: 1 }))
    const firstWidget = view.dom.querySelector('.mdi-warichu-space')
    const end = view.state.doc.content.size
    view.dispatch(view.state.tr.insert(end, view.state.schema.nodes.paragraph!.create(null,
      view.state.schema.nodes.mdiWarichu!.create(null, view.state.schema.text('末尾注')))))
    view.dom.querySelectorAll('p').forEach(paragraph => { paragraph.style.fontSize = '20px' })
    flush()
    expect(view.dom.querySelector('.mdi-warichu-space')).toBe(firstWidget)
    const measured = vi.spyOn(view, 'coordsAtPos')
    view.dispatch(view.state.tr.insertText('続', end + 2))
    flush()
    expect(measured.mock.calls.every(([pos]) => pos >= end)).toBe(true)
    measured.mockRestore()
    view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, view.state.schema.nodes.paragraph!.create(null, view.state.schema.text('plain'))))
    flush()
    expect(view.dom.querySelector('.mdi-warichu-space')).toBeNull()
  })
})

it('does not send nonfinite capacities for an unmeasurable hidden paragraph', async () => {
  const frames: FrameRequestCallback[] = []
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  const editor = await createEditor('[[warichu:注記]]')
  editor.action(ctx => {
    const view = ctx.get(editorViewCtx)
    view.coordsAtPos = () => ({ left: 0, right: 0, top: 0, bottom: 0 })
    const canonical = getMdi()(ctx)
    expect(() => { while (frames.length) frames.shift()!(0) }).not.toThrow()
    expect(view.dom.querySelector('.mdi-warichu-space')).toBeNull()
    expect(getMdi()(ctx)).toBe(canonical)
  })
})
