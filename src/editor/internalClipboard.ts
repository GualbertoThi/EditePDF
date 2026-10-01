import { Extension } from '@tiptap/react'
import { Slice } from '@tiptap/pm/model'
import { Plugin } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

const mime = 'application/x-pdf-editor-slice+json'

type FloatingImage = {
  src: string
  alt: string
  widthPt: number
  aspectRatio: number | null
  floating: true
  xPt: number
  yPt: number
  offsetXPt: 0
  offsetYPt: 0
}

function elementAt(node: globalThis.Node | null) {
  return node instanceof Element ? node : node?.parentElement || null
}

function selectionRect() {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  const rects = Array.from(selection.getRangeAt(0).getClientRects()).filter(rect => rect.width > 0 || rect.height > 0)
  if (!rects.length) return null
  return {
    left: Math.min(...rects.map(rect => rect.left)),
    right: Math.max(...rects.map(rect => rect.right)),
    top: Math.min(...rects.map(rect => rect.top)),
    bottom: Math.max(...rects.map(rect => rect.bottom)),
  }
}

function visualImages(view: EditorView) {
  const { state } = view
  if (state.selection.empty || state.selection.to - state.selection.from < 20) return []
  const dom = elementAt(view.domAtPos(state.selection.from).node)
  const page = dom?.closest<HTMLElement>('.document-sheet')
  const selected = selectionRect()
  if (!page || !selected) return []
  const pageRect = page.getBoundingClientRect()
  const pageWidthPt = Number.parseFloat(page.style.width) || 0
  const ptPerPx = pageRect.width > 0 && pageWidthPt > 0 ? pageWidthPt / pageRect.width : 0.75
  const serialized = state.selection.content()
  const existingSources = new Set<string>()
  serialized.content.descendants(node => {
    if (node.type.name === 'localImage' && typeof node.attrs.src === 'string') existingSources.add(node.attrs.src)
  })

  const result: FloatingImage[] = []
  for (const wrapper of Array.from(page.querySelectorAll<HTMLElement>('.local-image-wrapper'))) {
    if (wrapper.closest('.pdf-image-stack')) continue
    const image = wrapper.querySelector<HTMLImageElement>('img.local-image')
    if (!image || !/^data:image\/(png|jpeg|webp|gif);base64,/i.test(image.src) || existingSources.has(image.src)) continue
    const rect = wrapper.getBoundingClientRect()
    const nearVertically = rect.bottom >= selected.top - 42 && rect.top <= selected.bottom + 24
    const nearHorizontally = rect.right >= selected.left - 36 && rect.left <= selected.right + 36
    if (!nearVertically || !nearHorizontally) continue
    const widthPt = Number(image.getAttribute('data-width-pt')) || rect.width * ptPerPx
    const ratio = Number(image.getAttribute('data-aspect-ratio')) || (image.naturalWidth > 0 && image.naturalHeight > 0 ? image.naturalWidth / image.naturalHeight : null)
    result.push({
      src: image.src,
      alt: image.alt || '',
      widthPt,
      aspectRatio: ratio,
      floating: true,
      xPt: (rect.left - pageRect.left) * ptPerPx,
      yPt: (rect.top - pageRect.top) * ptPerPx,
      offsetXPt: 0,
      offsetYPt: 0,
    })
  }
  return result
}

function pageContentStart(state: EditorState) {
  const $from = state.selection.$from
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === 'pdfPage') return $from.before(depth) + 1
  }
  return null
}

export const InternalClipboard = Extension.create({
  name: 'internalClipboard',
  addProseMirrorPlugins() {
    return [new Plugin({
      props: {
        handleDOMEvents: {
          copy(view, rawEvent) {
            const event = rawEvent as ClipboardEvent
            if (!event.clipboardData || view.state.selection.empty) return false
            const slice = view.state.selection.content()
            const serialized = view.serializeForClipboard(slice)
            const payload = { version: 1, slice: slice.toJSON(), extraImages: visualImages(view) }
            event.clipboardData.clearData()
            event.clipboardData.setData('text/html', serialized.dom.innerHTML)
            event.clipboardData.setData('text/plain', serialized.text)
            event.clipboardData.setData(mime, JSON.stringify(payload))
            event.preventDefault()
            return true
          },
        },
        handlePaste(view, event) {
          const raw = event.clipboardData?.getData(mime)
          if (!raw) return false
          try {
            const payload = JSON.parse(raw) as { version?: number; slice?: unknown; extraImages?: FloatingImage[] }
            if (payload.version !== 1 || !payload.slice) return false
            const state = view.state
            const start = pageContentStart(state)
            const slice = Slice.fromJSON(state.schema, payload.slice)
            let tr = state.tr.replaceSelection(slice)
            if (start !== null && Array.isArray(payload.extraImages)) {
              let insertAt = tr.mapping.map(start, 1)
              for (const attrs of payload.extraImages) {
                if (!attrs || !/^data:image\/(png|jpeg|webp|gif);base64,/i.test(attrs.src || '')) continue
                const image = state.schema.nodes.localImage.create(attrs)
                tr = tr.insert(insertAt, image)
                insertAt += image.nodeSize
              }
            }
            view.dispatch(tr.scrollIntoView())
            return true
          } catch {
            return false
          }
        },
      },
    })]
  },
})
