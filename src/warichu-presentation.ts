import * as mdiRuntime from '@illusions-lab/mdi'
import type { Node as ProseNode } from '@milkdown/prose/model'
import { Plugin, PluginKey, TextSelection } from '@milkdown/prose/state'
import { Decoration, DecorationSet, type EditorView } from '@milkdown/prose/view'
import { $prose } from '@milkdown/utils'

type Source = { group: number; path: number[]; startUtf8: number; endUtf8: number }
type Layout = (children: Record<string, unknown>[], options: { firstCapacity: number; continuationCapacity: number }) => Array<{
  sources: [Source[], Source[]]; widths: [number, number]; overflow: boolean; hardBreakAfter: boolean
}>
const key = new PluginKey<DecorationSet>('mdiWarichuPresentation')

// Build semantic wrapper runs before assigning paths. Atomic no-break runs may
// span multiple ProseMirror text nodes with different formatting marks.
const inlineIR = (node: ProseNode, position: number) => {
  type Tree = { ir: Record<string, unknown>; children?: Tree[]; from: number; to: number; text: string; textNode?: boolean }
  const kinds: Record<string, string> = { strong: 'strong', emphasis: 'emphasis', mdiGfmDelete: 'delete', mdiBoten: 'em', mdiKern: 'kern', mdiNoBreak: 'noBreak', mdiTcy: 'tcy' }
  const build = (parent: ProseNode, start: number): Tree[] => {
    const result: Tree[] = []
    parent.forEach((child, offset) => {
      const from = start + offset
      let siblings = result
      const marks = [...child.marks].filter(mark => kinds[mark.type.name]).sort((a, b) =>
        Number(!['mdiNoBreak', 'mdiTcy'].includes(a.type.name)) - Number(!['mdiNoBreak', 'mdiTcy'].includes(b.type.name)))
      const text = child.text ?? (child.type.name === 'mdiRuby' ? String(child.attrs.base) : child.type.name === 'image' ? String(child.attrs.alt ?? '') : child.textContent)
      for (const mark of marks) {
        const ir = { type: kinds[mark.type.name], ...mark.attrs }
        let wrapper = siblings.at(-1)
        if (!wrapper?.children || JSON.stringify(wrapper.ir) !== JSON.stringify(ir)) {
          wrapper = { ir, children: [], from, to: from + child.nodeSize, text: '' }
          siblings.push(wrapper)
        }
        wrapper.to = from + child.nodeSize
        wrapper.text += text
        siblings = wrapper.children!
      }
      const ir = child.isText ? { type: 'text', value: child.text }
        : child.type.name === 'mdiRuby' ? { type: 'ruby', ...child.attrs }
        : child.type.name === 'mdiBreak' ? { type: 'break' }
        : child.type.name === 'image' ? { type: 'image', url: child.attrs.src, alt: child.attrs.alt ?? '', title: child.attrs.title }
        : { type: 'warichu' }
      siblings.push({ ir, from, to: from + child.nodeSize, text,
        textNode: child.isText,
        ...(!child.isLeaf ? { children: build(child, from + 1) } : {}) })
    })
    return result
  }
  const leaves = new Map<string, { from: number; to: number; text: string; textNode: boolean }>()
  const serialize = (trees: Tree[], path: number[] = []): Record<string, unknown>[] => trees.map((tree, index) => {
    const current = [...path, index]
    leaves.set(current.join('.'), { from: tree.from, to: tree.to, text: tree.text, textNode: tree.textNode === true })
    return { ...tree.ir, ...(tree.children ? { children: serialize(tree.children, current) } : {}) }
  })
  const children = serialize(build(node, position + 1))
  return { children, leaves }
}
const utf16Offset = (text: string, bytes: number) => {
  let consumed = 0
  let units = 0
  for (const character of text) {
    if (consumed >= bytes) break
    consumed += new TextEncoder().encode(character).length
    units += character.length
  }
  return units
}

const hitPosition = (view: EditorView, event: Pick<MouseEvent, 'clientX' | 'clientY'>): number | null => {
          const line = Array.from(view.dom.querySelectorAll<HTMLElement>('.mdi-warichu-editable-line')).find(element => {
            const rect = element.getBoundingClientRect()
            return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom
          })
          if (!line) return null
          const vertical = getComputedStyle(line).writingMode.startsWith('vertical')
          const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
          let text = walker.nextNode()
          while (text) {
            if (!text.parentElement?.closest('rt,rp')) {
              for (const segment of new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(text.textContent ?? '')) {
                const range = document.createRange()
                range.setStart(text, segment.index)
                range.setEnd(text, segment.index + segment.segment.length)
                const rect = range.getBoundingClientRect()
                if (event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom) {
                  const after = vertical ? event.clientY >= (rect.top + rect.bottom) / 2 : event.clientX >= (rect.left + rect.right) / 2
                  const pos = view.posAtDOM(text, segment.index + (after ? segment.segment.length : 0))
                  return pos
                }
              }
            }
            text = walker.nextNode()
          }
          return null
}

/** One editable DOM tree. Decorations hold geometry; widgets contain no text. */
export const mdiWarichuPresentation = $prose(() => {
  let composing = false
  let frame = 0
  let disposed = false
  let currentView: EditorView
  let notePositions = new Set<number>()
  let announcement: HTMLElement | undefined
  let dragCleanup: (() => void) | undefined
  let dirtyFrom = 0
  const measuredUnits = new WeakMap<ProseNode, { signature: string; unit: number; attempts: number }>()
  const layout = 'layoutMdiWarichu' in mdiRuntime ? (mdiRuntime as unknown as { layoutMdiWarichu?: Layout }).layoutMdiWarichu : undefined
  const schedule = () => {
    if (!layout || !notePositions.size || disposed || composing || frame || typeof requestAnimationFrame !== 'function') return
    frame = requestAnimationFrame(() => {
      frame = 0
      if (disposed || composing) return
      if (currentView.composing) { schedule(); return }
      const view = currentView
      const hadFocus = view.hasFocus()
      const decorate = (from: number, to: number, attrs: Record<string, string>) => {
        const node = view.state.doc.nodeAt(from)
        return node && !node.isText && node.nodeSize === to - from
          ? Decoration.node(from, to, attrs) : Decoration.inline(from, to, attrs)
      }
      const threshold = dirtyFrom
      dirtyFrom = Infinity
      const retained = key.getState(view.state)?.find().filter(decoration => decoration.to < threshold) ?? []
      const decorations: Decoration[] = []
      const editable: Array<{ from: number; to: number; attrs: Record<string, string> }> = []
      const widgets: Array<{ start: number; id: string; font: number; vertical: boolean; width: number; blockSize: number; rowHeights: number[]; units: number; node: ProseNode; signature: string }> = []
      const widgetDecoration = (item: typeof widgets[number]) => Decoration.widget(item.start, () => {
        const widget = document.createElement('span')
        widget.className = 'mdi-warichu-space'
        widget.dataset.mdiFragment = item.id
        widget.setAttribute('aria-hidden', 'true')
        widget.contentEditable = 'false'
        widget.style.inlineSize = `${item.width}px`
        widget.style.blockSize = `${item.blockSize}px`
        return widget
      }, { side: -1, key: `warichu-${item.id}-${item.width}-${item.blockSize}-${item.font}-${item.vertical}` })
      let sequence = 0
      notePositions.forEach(pos => {
        if (pos < threshold) return
        const node = view.state.doc.nodeAt(pos)
        if (!node) return
        const dom = view.nodeDOM(pos) as HTMLElement | null
        const paragraph = dom?.closest('p,li,h1,h2,h3,h4,h5,h6') as HTMLElement | null
        if (!dom || !paragraph || !node.content.size) return false
        const style = getComputedStyle(paragraph)
        const vertical = style.writingMode.startsWith('vertical')
        const font = Number.parseFloat(style.fontSize)
        const box = paragraph.getBoundingClientRect()
        if (!Number.isFinite(font) || font <= 0 || !Number.isFinite(box.width) || !Number.isFinite(box.height) || !(box.width > 0) || !(box.height > 0)) {
          retained.push(...(key.getState(view.state)?.find(pos, pos + node.nodeSize) ?? []))
          return
        }
        const cursor = view.coordsAtPos(pos)
        const scale = vertical ? box.height / (paragraph.offsetHeight || box.height) : box.width / (paragraph.offsetWidth || box.width)
        const paddingStart = Number.parseFloat(vertical ? style.paddingTop : style.paddingLeft) || 0
        const paddingEnd = Number.parseFloat(vertical ? style.paddingBottom : style.paddingRight) || 0
        const available = (vertical ? box.bottom - cursor.top : box.right - cursor.left) / scale - paddingEnd
        const extent = (vertical ? paragraph.clientHeight || box.height : paragraph.clientWidth || box.width) - paddingStart - paddingEnd
        const signature = `${font}|${style.writingMode}|${style.fontFamily}|${style.letterSpacing}`
        const measured = measuredUnits.get(node)
        const unit = measured?.signature === signature ? measured.unit : font / 4
        if (![scale, extent, unit].every(value => Number.isFinite(value) && value > 0) || !Number.isFinite(available)) {
          retained.push(...(key.getState(view.state)?.find(pos, pos + node.nodeSize) ?? []))
          return
        }
        const { children, leaves } = inlineIR(node, pos)
        const fragments = layout!(children, { firstCapacity: Math.max(1, Math.floor(available / unit)), continuationCapacity: Math.max(1, Math.floor(extent / unit)) })
        const breaks: number[] = []
        node.descendants((child, offset) => {
          if (child.type.name === 'mdiWarichu') return false
          if (child.type.name === 'mdiBreak') breaks.push(pos + 1 + offset)
        })
        let sourceCursor = pos + 1
        fragments.forEach(fragment => {
          const id = `${pos}-${sequence++}`
          const ranges = fragment.sources.map(line => line.flatMap(source => {
            const leaf = leaves.get(source.path.join('.'))
            if (!leaf) return []
            const from = leaf.from + (leaf.textNode ? utf16Offset(leaf.text, source.startUtf8) : 0)
            const to = leaf.textNode ? leaf.from + utf16Offset(leaf.text, source.endUtf8) : leaf.to
            return to > from ? [{ from, to, leaf: source.path.join('.'), group: source.group }] : []
          }))
          const sourceRanges = ranges.flat()
          const start = sourceRanges[0]?.from ?? breaks.find(position => position >= sourceCursor) ?? pos + node.nodeSize - 1
          sourceCursor = sourceRanges.at(-1)?.to ?? start
          if (fragment.hardBreakAfter) sourceCursor = (breaks.find(position => position >= sourceCursor) ?? sourceCursor) + 1
          const widget = { start, id, font, vertical, blockSize: font, rowHeights: [font / 2, font / 2], width: Math.max(...fragment.widths) * unit,
            units: Math.max(...fragment.widths), node, signature }
          widgets.push(widget)
          decorations.push(widgetDecoration(widget))
          ranges.forEach((line, row) => {
            const groups: Array<{ from: number; to: number; leaf: string; group: number }> = []
            for (const range of line) {
              const previous = groups.at(-1)
              if (previous?.to === range.from && (previous.leaf === range.leaf || previous.group === range.group)) previous.to = range.to
              else groups.push({ ...range })
            }
            groups.forEach((range, group) => {
              const attrs = {
                class: 'mdi-warichu-editable-line', 'data-mdi-fragment-line': id,
                'data-mdi-row': String(row), 'data-mdi-group': String(group),
                style: `font-size:${font / 2}px;line-height:1;position:absolute;white-space:nowrap;`,
              }
              editable.push({ ...range, attrs })
              decorations.push(decorate(range.from, range.to, attrs))
            })
          })
        })
        return false
      })
      view.dispatch(view.state.tr.setMeta(key, DecorationSet.create(view.state.doc, [...retained, ...decorations])).setMeta('addToHistory', false))
      // Measure actual advances, including inherited tracking and formatted runs.
      // Retry Rust with a measured half-unit when its nominal units under-reserve.
      for (const widget of widgets) {
        const rows = [0, 0]
        view.dom.querySelectorAll<HTMLElement>(`[data-mdi-fragment-line="${widget.id}"]`).forEach(line => {
          const rect = line.getBoundingClientRect()
          const scale = widget.vertical ? rect.height / (line.offsetHeight || rect.height) : rect.width / (line.offsetWidth || rect.width)
          const row = Number(line.dataset.mdiRow)
          widget.rowHeights[row] = Math.max(widget.rowHeights[row]!, (widget.vertical ? rect.width : rect.height) / (scale || 1))
          rows[row]! += (widget.vertical ? rect.height : rect.width) / (scale || 1)
        })
        widget.blockSize = widget.rowHeights[0]! + widget.rowHeights[1]!
        const actual = Math.max(...rows)
        if (actual > 0) widget.width = actual
        if (widget.units > 0) {
          const observed = actual / widget.units
          const prior = measuredUnits.get(widget.node)
          const baseline = prior?.signature === widget.signature ? prior.unit : widget.font / 4
          if (observed > baseline + 0.01 && (prior?.attempts ?? 0) < 4) {
            measuredUnits.set(widget.node, { signature: widget.signature, unit: observed * 1.01, attempts: (prior?.attempts ?? 0) + 1 })
            dirtyFrom = 0
          }
        }
      }
      const sizedWidgets = widgets.map(widgetDecoration)
      view.dispatch(view.state.tr.setMeta(key, DecorationSet.create(view.state.doc, [...retained, ...sizedWidgets, ...editable.map(item => decorate(item.from, item.to, item.attrs))])).setMeta('addToHistory', false))
      // All reservations now reflect measured rows; read their resulting locations.
      const placements = Array.from(view.dom.querySelectorAll<HTMLElement>('.mdi-warichu-space')).filter(widget => editable.some(item => item.attrs['data-mdi-fragment-line'] === widget.dataset.mdiFragment)).map(widget => ({
        id: widget.dataset.mdiFragment, rect: widget.getBoundingClientRect(),
        vertical: getComputedStyle(widget).writingMode.startsWith('vertical'),
      }))
      const origins = new Map<HTMLElement, DOMRect>()
      const positionedLines: Decoration[] = []
      for (const placement of placements) {
        const lines = view.dom.querySelectorAll<HTMLElement>(`[data-mdi-fragment-line="${placement.id}"]`)
        const offsets = [0, 0]
        const fragment = widgets.find(widget => widget.id === placement.id)!
        for (const line of Array.from(lines)) {
          const row = Number(line.dataset.mdiRow)
          const size = Number.parseFloat(line.style.fontSize)
          const containingBlock = line.offsetParent as HTMLElement | null ?? view.dom
          let origin = origins.get(containingBlock)
          if (!origin) { origin = containingBlock.getBoundingClientRect(); origins.set(containingBlock, origin) }
          const scaleX = origin.width / (containingBlock.offsetWidth || origin.width) || 1
          const scaleY = origin.height / (containingBlock.offsetHeight || origin.height) || 1
          const left = (placement.rect.left - origin.left) / scaleX + containingBlock.scrollLeft - containingBlock.clientLeft + (placement.vertical ? row === 0 ? fragment.rowHeights[1]! : 0 : offsets[row]!)
          const top = (placement.rect.top - origin.top) / scaleY + containingBlock.scrollTop - containingBlock.clientTop + (placement.vertical ? offsets[row]! : row === 0 ? 0 : fragment.rowHeights[0]!)
          const item = editable.find(item => item.attrs['data-mdi-fragment-line'] === placement.id
            && item.attrs['data-mdi-row'] === String(row) && item.attrs['data-mdi-group'] === line.dataset.mdiGroup)
          if (item) {
            const node = view.state.doc.nodeAt(item.from)
            const atomic = node && !node.isText && node.nodeSize === item.to - item.from
            const from = atomic ? item.from : Math.max(item.from, view.posAtDOM(line, 0))
            const to = atomic ? item.to : Math.min(item.to, view.posAtDOM(line, line.childNodes.length))
            if (to > from) positionedLines.push(decorate(from, to, { ...item.attrs, style: `${item.attrs.style}left:${left}px;top:${top}px;` }))
          }
          offsets[row]! += placement.vertical ? line.getBoundingClientRect().height / scaleY : line.getBoundingClientRect().width / scaleX
        }
      }
      const positioned = [...retained, ...sizedWidgets]
      positioned.push(...positionedLines)
      view.dispatch(view.state.tr.setMeta(key, DecorationSet.create(view.state.doc, positioned)).setMeta('addToHistory', false))
      if (hadFocus) view.focus()
      if (dirtyFrom !== Infinity) schedule()
    })
  }
  const invalidateAll = () => { dirtyFrom = 0; schedule() }
  return new Plugin<DecorationSet>({
    key,
    state: {
      init: (_config, state) => {
        state.doc.descendants((node, pos) => { if (node.type.name === 'mdiWarichu') { notePositions.add(pos) } })
        return DecorationSet.empty
      },
      apply: (tr, previous) => {
        if (tr.docChanged) {
          const mapped = new Set<number>()
          for (const pos of notePositions) {
            const next = tr.mapping.mapResult(pos)
            if (!next.deleted && tr.doc.nodeAt(next.pos)?.type.name === 'mdiWarichu') mapped.add(next.pos)
          }
          tr.mapping.maps.forEach((map, index) => map.forEach((_oldFrom, _oldTo, newFrom, newTo) => {
            const after = tr.mapping.slice(index + 1)
            const from = Math.max(0, after.map(newFrom, -1))
            const to = Math.min(tr.doc.content.size, after.map(newTo, 1))
            const resolved = tr.doc.resolve(from)
            let paragraphStart = from
            for (let depth = resolved.depth; depth > 0; depth -= 1) {
              if (resolved.node(depth).isTextblock) { paragraphStart = resolved.before(depth); break }
            }
            dirtyFrom = Math.min(dirtyFrom, paragraphStart)
            tr.doc.nodesBetween(from, to, (node, pos) => {
              if (node.type.name === 'mdiWarichu') { mapped.add(pos) }
            })
          }))
          notePositions = mapped
          if (!notePositions.size) return DecorationSet.empty
        }
        return tr.getMeta(key) ?? previous.map(tr.mapping, tr.doc)
      },
    },
    appendTransaction: (transactions, _oldState, state) => {
      if (!notePositions.size || !transactions.some(transaction => transaction.docChanged || transaction.selectionSet) || composing) return null
      const empty: number[] = []
      state.doc.descendants((node, pos) => {
        if (node.type.name === 'mdiWarichu' && node.content.size === 0
          && state.selection.from !== pos + 1) empty.push(pos)
      })
      if (!empty.length) return null
      const tr = state.tr
      for (const pos of empty.reverse()) tr.delete(pos, pos + 2)
      return tr
    },
    props: {
      decorations: state => key.getState(state),
      handleClick: (view, _pos, event) => {
          if (composing || event.button !== 0 || event.detail > 1) return false
          const pos = hitPosition(view, event)
          if (pos === null) return false
          view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, event.shiftKey ? view.state.selection.anchor : pos, pos)))
          view.focus()
          event.preventDefault()
          return true
      },
      handleDOMEvents: {
        mousedown: (view, event) => {
          if (composing || !notePositions.size || event.button !== 0 || event.detail > 1) return false
          const start = hitPosition(view, event) ?? view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
          if (start === undefined) return false
          const anchor = event.shiftKey ? view.state.selection.anchor : start
          let dragging = false
          const select = (next: MouseEvent) => {
            const head = hitPosition(view, next) ?? view.posAtCoords({ left: next.clientX, top: next.clientY })?.pos
            if (head !== undefined && !disposed) view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, anchor, head)))
          }
          const move = (next: MouseEvent) => {
            if (Math.hypot(next.clientX - event.clientX, next.clientY - event.clientY) > 3) dragging = true
            if (dragging) select(next)
          }
          const up = (next: MouseEvent) => {
            dragCleanup?.()
            if (dragging) queueMicrotask(() => select(next))
          }
          dragCleanup?.()
          const document = view.dom.ownerDocument
          dragCleanup = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); dragCleanup = undefined }
          document.addEventListener('mousemove', move)
          document.addEventListener('mouseup', up)
          return false
        },
        compositionstart: () => { composing = true; return false },
        compositionend: () => { composing = false; schedule(); return false },
      },
      handleKeyDown: (view, event) => {
        if (event.isComposing || composing || view.composing) return false
        const selection = view.state.selection
        const head = view.state.doc.resolve(selection.head)
        const vertical = getComputedStyle(view.dom).writingMode.startsWith('vertical')
        const direction = event.key === (vertical ? 'ArrowDown' : 'ArrowRight') ? 1 : event.key === (vertical ? 'ArrowUp' : 'ArrowLeft') ? -1 : 0
        if (direction && (selection.empty || event.shiftKey) && !event.altKey && !event.metaKey && !event.ctrlKey) {
          const adjacent = direction > 0 ? head.nodeAfter : head.nodeBefore
          const inside = head.parent.type.name === 'mdiWarichu'
          if (inside || adjacent?.type.name === 'mdiWarichu') {
            let distance = 1
            if (inside && adjacent && adjacent.type.name !== 'mdiWarichu') {
              if (adjacent.isText) {
                const segments = [...new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(adjacent.text!)]
                distance = (direction > 0 ? segments[0] : segments.at(-1))!.segment.length
              } else distance = adjacent.nodeSize
            }
            const position = selection.head + direction * distance
            view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, event.shiftKey ? selection.anchor : position, position)).scrollIntoView())
            return true
          }
        }
        if (selection.empty && (event.key === 'Backspace' || event.key === 'Delete')) {
          const backward = event.key === 'Backspace'
          const adjacent = backward ? head.nodeBefore : head.nodeAfter
          if (adjacent?.type.name === 'mdiWarichu') {
            let edge = backward ? selection.head - 1 : selection.head + 1
            let child = backward ? adjacent.lastChild : adjacent.firstChild
            while (child?.type.name === 'mdiWarichu') { edge += backward ? -1 : 1; child = backward ? child.lastChild : child.firstChild }
            if (!child) return false
            const segments = child.isText ? [...new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(child.text!)] : []
            const length = child.isText ? (backward ? segments.at(-1) : segments[0])!.segment.length : child.nodeSize
            const from = backward ? edge - length : edge
            const tr = view.state.tr.delete(from, from + length)
            view.dispatch(tr.setSelection(TextSelection.create(tr.doc, from)).scrollIntoView())
            return true
          }
        }
        if (event.key !== 'Enter') return false
        const { $from } = selection
        for (let depth = $from.depth; depth > 0; depth -= 1) {
          if ($from.node(depth).type.name !== 'mdiWarichu') continue
          if (!announcement) {
            announcement = document.createElement('div')
            announcement.className = 'mdi-warichu-status'
            announcement.setAttribute('role', 'status')
            announcement.setAttribute('aria-live', 'polite')
            view.dom.parentElement?.append(announcement)
          }
          announcement.textContent = 'Warichu uses automatic two-line layout.'
          view.dom.dispatchEvent(new CustomEvent('mdi-warichu-auto-layout', { bubbles: true, detail: { message: 'Warichu uses automatic two-line layout.' } }))
          return true
        }
        return false
      },
    },
    view: view => {
      currentView = view
      const attributes = typeof MutationObserver === 'function' ? new MutationObserver(invalidateAll) : null
      const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(invalidateAll) : null
      let observing = false
      const activate = () => {
        if (notePositions.size && !observing) {
          observer?.observe(view.dom)
          let ancestor: HTMLElement | null = view.dom
          while (ancestor) {
            attributes?.observe(ancestor, { attributes: true, attributeFilter: ['style', 'class', 'dir', 'data-writing-mode'] })
            ancestor = ancestor.parentElement
          }
          document.fonts?.addEventListener('loadingdone', invalidateAll)
          observing = true
        } else if (!notePositions.size && observing) {
          observer?.disconnect()
          attributes?.disconnect()
          document.fonts?.removeEventListener('loadingdone', invalidateAll)
          observing = false
        }
      }
      activate()
      schedule()
      return {
        update: (next, previous) => { currentView = next; activate(); if (!next.state.doc.eq(previous.doc)) schedule() },
        destroy: () => { disposed = true; if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame); observer?.disconnect(); attributes?.disconnect(); announcement?.remove(); dragCleanup?.(); document.fonts?.removeEventListener('loadingdone', invalidateAll) },
      }
    },
  })
})
