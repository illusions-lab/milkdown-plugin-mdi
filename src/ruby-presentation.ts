import { DOMSerializer } from '@milkdown/prose/model'
import { Plugin } from '@milkdown/prose/state'
import { $prose } from '@milkdown/utils'

// Keep the native ruby layout inside an ordinary inline atom. Chromium can
// otherwise normalize a click beyond a non-editable <ruby> back into its base
// text, turning the intended trailing caret into a NodeSelection.
export const mdiRubyPresentation = $prose(() => new Plugin({
  props: {
    nodeViews: {
      mdiRuby: (node, view) => {
        const document = view.dom.ownerDocument
        const dom = document.createElement('span')
        dom.className = 'mdi-ruby-atom'
        dom.appendChild(DOMSerializer.renderSpec(document, node.type.spec.toDOM!(node)).dom)
        return { dom }
      },
    },
  },
}))
