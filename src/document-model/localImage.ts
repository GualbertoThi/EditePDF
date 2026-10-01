import { Node, mergeAttributes } from '@tiptap/react'

const minWidthPt = 18

function imageStyle(node: { attrs: Record<string, unknown> }) {
  const widthPt = Number(node.attrs.widthPt) || 144
  const aspectRatio = Number(node.attrs.aspectRatio) || null
  const floating = node.attrs.floating === true
  const xPt = Number(node.attrs.xPt) || 0
  const yPt = Number(node.attrs.yPt) || 0
  const offsetXPt = Number(node.attrs.offsetXPt) || 0
  const offsetYPt = Number(node.attrs.offsetYPt) || 0
  const placement = floating
    ? `;position:absolute;left:${xPt}pt;top:${yPt}pt;z-index:1`
    : `;transform:translate(${offsetXPt}pt,${offsetYPt}pt)`
  return `width:${widthPt}pt;max-width:100%;height:auto${aspectRatio ? `;aspect-ratio:${aspectRatio};object-fit:fill` : ''}${placement}`
}

function pointScale(page: HTMLElement | null) {
  if (!page) return 0.75
  const rect = page.getBoundingClientRect()
  const widthPt = Number.parseFloat(page.style.width) || 0
  return rect.width > 0 && widthPt > 0 ? widthPt / rect.width : 0.75
}

export const LocalImage = Node.create({
  name: 'localImage', group: 'block', atom: true, draggable: true,
  addAttributes() {
    return {
      pdfSource: { default: null, rendered: false },
      aspectRatio: { default: null, parseHTML: element => Number(element.getAttribute('data-aspect-ratio')) || null, rendered: false },
      src: { default: '', parseHTML: element => element.getAttribute('src') || '' },
      alt: { default: '' },
      widthPt: { default: 144, parseHTML: element => Number(element.getAttribute('data-width-pt')) || 144, rendered: false },
      offsetXPt: { default: 0, parseHTML: element => Number(element.getAttribute('data-offset-x-pt')) || 0, rendered: false },
      offsetYPt: { default: 0, parseHTML: element => Number(element.getAttribute('data-offset-y-pt')) || 0, rendered: false },
      floating: { default: false, parseHTML: element => element.getAttribute('data-floating') === 'true', rendered: false },
      xPt: { default: 0, parseHTML: element => Number(element.getAttribute('data-x-pt')) || 0, rendered: false },
      yPt: { default: 0, parseHTML: element => Number(element.getAttribute('data-y-pt')) || 0, rendered: false },
    }
  },
  parseHTML() { return [{ tag: 'img[src^="data:image/"]', getAttrs: element => /^data:image\/(png|jpeg|webp|gif);base64,/i.test(element.getAttribute('src') || '') ? {} : false }] },
  renderHTML({ node, HTMLAttributes }) {
    return ['img', mergeAttributes(HTMLAttributes, {
      class: 'local-image', 'data-width-pt': node.attrs.widthPt,
      'data-aspect-ratio': node.attrs.aspectRatio,
      'data-offset-x-pt': node.attrs.offsetXPt,
      'data-offset-y-pt': node.attrs.offsetYPt,
      'data-floating': node.attrs.floating ? 'true' : 'false',
      'data-x-pt': node.attrs.xPt,
      'data-y-pt': node.attrs.yPt,
      style: imageStyle(node),
    })]
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      let currentNode = node
      const wrapper = document.createElement('span')
      wrapper.className = 'local-image-wrapper'
      wrapper.style.display = 'inline-block'
      wrapper.style.lineHeight = '0'
      wrapper.style.verticalAlign = 'top'
      wrapper.style.transformOrigin = 'top left'

      const dom = document.createElement('img')
      dom.className = 'local-image'
      dom.draggable = false
      dom.style.cursor = 'move'
      dom.style.display = 'block'
      wrapper.append(dom)

      type Corner = 'nw' | 'ne' | 'sw' | 'se'
      const handles = new Map<Corner, HTMLSpanElement>()
      const handlePositions: Record<Corner, Partial<CSSStyleDeclaration>> = {
        nw: { left: '-5px', top: '-5px', cursor: 'nwse-resize' },
        ne: { right: '-5px', top: '-5px', cursor: 'nesw-resize' },
        sw: { left: '-5px', bottom: '-5px', cursor: 'nesw-resize' },
        se: { right: '-5px', bottom: '-5px', cursor: 'nwse-resize' },
      }
      for (const corner of ['nw', 'ne', 'sw', 'se'] as Corner[]) {
        const handle = document.createElement('span')
        Object.assign(handle.style, {
          position: 'absolute', width: '9px', height: '9px', boxSizing: 'border-box',
          border: '1px solid #e8653b', background: '#ffffff', display: 'none',
          zIndex: '3', touchAction: 'none', ...handlePositions[corner],
        })
        handle.dataset.resizeCorner = corner
        wrapper.append(handle)
        handles.set(corner, handle)
      }

      const sync = () => {
        dom.src = String(currentNode.attrs.src || '')
        dom.alt = String(currentNode.attrs.alt || '')
        dom.setAttribute('data-width-pt', String(currentNode.attrs.widthPt ?? 144))
        if (currentNode.attrs.aspectRatio != null) dom.setAttribute('data-aspect-ratio', String(currentNode.attrs.aspectRatio))
        else dom.removeAttribute('data-aspect-ratio')
        dom.setAttribute('data-offset-x-pt', String(currentNode.attrs.offsetXPt ?? 0))
        dom.setAttribute('data-offset-y-pt', String(currentNode.attrs.offsetYPt ?? 0))
        dom.setAttribute('data-floating', currentNode.attrs.floating ? 'true' : 'false')
        dom.setAttribute('data-x-pt', String(currentNode.attrs.xPt ?? 0))
        dom.setAttribute('data-y-pt', String(currentNode.attrs.yPt ?? 0))

        const widthPt = Number(currentNode.attrs.widthPt) || 144
        const aspectRatio = Number(currentNode.attrs.aspectRatio) || null
        const floating = currentNode.attrs.floating === true
        const offsetXPt = Number(currentNode.attrs.offsetXPt) || 0
        const offsetYPt = Number(currentNode.attrs.offsetYPt) || 0
        const xPt = Number(currentNode.attrs.xPt) || 0
        const yPt = Number(currentNode.attrs.yPt) || 0
        dom.style.cssText = `width:${widthPt}pt;max-width:100%;height:auto${aspectRatio ? `;aspect-ratio:${aspectRatio};object-fit:fill` : ''};display:block;cursor:move`
        wrapper.style.position = floating ? 'absolute' : 'relative'
        wrapper.style.left = floating ? `${xPt}pt` : 'auto'
        wrapper.style.top = floating ? `${yPt}pt` : 'auto'
        wrapper.style.transform = floating ? 'none' : `translate(${offsetXPt}pt,${offsetYPt}pt)`
        wrapper.style.zIndex = floating ? '1' : 'auto'
      }
      sync()

      const selectSelf = () => {
        const pos = typeof getPos === 'function' ? getPos() : undefined
        if (typeof pos === 'number') editor.commands.setNodeSelection(pos)
      }

      let dragging = false
      let resizing = false
      let pointerId = -1
      let startX = 0
      let startY = 0
      let startOffsetX = 0
      let startOffsetY = 0
      let previewOffsetX = 0
      let previewOffsetY = 0
      let startFloating = false
      let startXP = 0
      let startYP = 0
      let previewXP = 0
      let previewYP = 0
      let resizeCorner: Corner = 'se'
      let startWidthPt = 144
      let startHeightPt = 144
      let previewWidthPt = 144
      let previewHeightPt = 144
      let startAspectRatio = 1
      let ptPerPx = 0.75

      const pageElement = () => wrapper.closest<HTMLElement>('.document-sheet')
      const imageRatio = () => {
        const attr = Number(currentNode.attrs.aspectRatio)
        if (Number.isFinite(attr) && attr > 0) return attr
        if (dom.naturalWidth > 0 && dom.naturalHeight > 0) return dom.naturalWidth / dom.naturalHeight
        const rect = dom.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 1
      }
      const currentVisualPosition = () => {
        const page = pageElement()
        const pageRect = page?.getBoundingClientRect()
        const rect = wrapper.getBoundingClientRect()
        const scale = pointScale(page)
        return pageRect ? { x: (rect.left - pageRect.left) * scale, y: (rect.top - pageRect.top) * scale, scale } : { x: 0, y: 0, scale }
      }
      const applyPreview = () => {
        dom.style.width = `${previewWidthPt}pt`
        if (startFloating) {
          wrapper.style.position = 'absolute'
          wrapper.style.left = `${previewXP}pt`
          wrapper.style.top = `${previewYP}pt`
          wrapper.style.transform = 'none'
        } else {
          wrapper.style.transform = `translate(${previewOffsetX}pt,${previewOffsetY}pt)`
        }
      }

      const onImagePointerDown = (event: PointerEvent) => {
        if (event.button !== 0 || wrapper.closest('.pdf-image-stack')) return
        selectSelf()
        dragging = true
        pointerId = event.pointerId
        startX = event.clientX
        startY = event.clientY
        startFloating = currentNode.attrs.floating === true
        const visual = currentVisualPosition()
        ptPerPx = visual.scale
        startXP = startFloating ? Number(currentNode.attrs.xPt) || visual.x : visual.x
        startYP = startFloating ? Number(currentNode.attrs.yPt) || visual.y : visual.y
        previewXP = startXP
        previewYP = startYP
        startOffsetX = Number(currentNode.attrs.offsetXPt) || 0
        startOffsetY = Number(currentNode.attrs.offsetYPt) || 0
        previewOffsetX = startOffsetX
        previewOffsetY = startOffsetY
        wrapper.setPointerCapture(pointerId)
        event.preventDefault()
      }

      const onHandlePointerDown = (event: PointerEvent) => {
        if (event.button !== 0 || wrapper.closest('.pdf-image-stack')) return
        const target = event.currentTarget as HTMLElement
        resizeCorner = (target.dataset.resizeCorner as Corner) || 'se'
        selectSelf()
        resizing = true
        pointerId = event.pointerId
        startX = event.clientX
        startY = event.clientY
        startFloating = currentNode.attrs.floating === true
        const visual = currentVisualPosition()
        ptPerPx = visual.scale
        startXP = startFloating ? Number(currentNode.attrs.xPt) || visual.x : visual.x
        startYP = startFloating ? Number(currentNode.attrs.yPt) || visual.y : visual.y
        previewXP = startXP
        previewYP = startYP
        startOffsetX = Number(currentNode.attrs.offsetXPt) || 0
        startOffsetY = Number(currentNode.attrs.offsetYPt) || 0
        previewOffsetX = startOffsetX
        previewOffsetY = startOffsetY
        startWidthPt = Number(currentNode.attrs.widthPt) || 144
        startAspectRatio = imageRatio()
        startHeightPt = startWidthPt / startAspectRatio
        previewWidthPt = startWidthPt
        previewHeightPt = startHeightPt
        target.setPointerCapture(pointerId)
        event.preventDefault()
        event.stopPropagation()
      }

      const onPointerMove = (event: PointerEvent) => {
        if (event.pointerId !== pointerId) return
        if (dragging) {
          const dxPt = (event.clientX - startX) * ptPerPx
          const dyPt = (event.clientY - startY) * ptPerPx
          if (startFloating) {
            previewXP = startXP + dxPt
            previewYP = startYP + dyPt
            wrapper.style.left = `${previewXP}pt`
            wrapper.style.top = `${previewYP}pt`
          } else {
            previewOffsetX = startOffsetX + dxPt
            previewOffsetY = startOffsetY + dyPt
            wrapper.style.transform = `translate(${previewOffsetX}pt,${previewOffsetY}pt)`
          }
          event.preventDefault()
          return
        }
        if (!resizing) return

        const dxPt = (event.clientX - startX) * ptPerPx
        const dyPt = (event.clientY - startY) * ptPerPx
        const horizontalDelta = resizeCorner.includes('w') ? -dxPt : dxPt
        const verticalDelta = (resizeCorner.includes('n') ? -dyPt : dyPt) * startAspectRatio
        const widthDelta = Math.abs(horizontalDelta) >= Math.abs(verticalDelta) ? horizontalDelta : verticalDelta
        previewWidthPt = Math.max(minWidthPt, startWidthPt + widthDelta)
        previewHeightPt = previewWidthPt / startAspectRatio
        if (startFloating) {
          previewXP = startXP + (resizeCorner.includes('w') ? startWidthPt - previewWidthPt : 0)
          previewYP = startYP + (resizeCorner.includes('n') ? startHeightPt - previewHeightPt : 0)
        } else {
          previewOffsetX = startOffsetX + (resizeCorner.includes('w') ? startWidthPt - previewWidthPt : 0)
          previewOffsetY = startOffsetY + (resizeCorner.includes('n') ? startHeightPt - previewHeightPt : 0)
        }
        applyPreview()
        event.preventDefault()
      }

      const finishPointer = (event: PointerEvent) => {
        if (event.pointerId !== pointerId) return
        const pos = typeof getPos === 'function' ? getPos() : undefined
        if (dragging) {
          dragging = false
          if (wrapper.hasPointerCapture(pointerId)) wrapper.releasePointerCapture(pointerId)
          if (typeof pos === 'number') {
            if (startFloating) {
              if (Math.abs(previewXP - startXP) > 0.01 || Math.abs(previewYP - startYP) > 0.01) {
                editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...currentNode.attrs, xPt: previewXP, yPt: previewYP }))
              } else sync()
            } else if (Math.abs(previewOffsetX - startOffsetX) > 0.01 || Math.abs(previewOffsetY - startOffsetY) > 0.01) {
              // First real drag turns the image into a page-anchored floating object.
              // That removes its old line/block from the document flow, so text can sit
              // directly underneath it just as in the original PDF.
              const visual = currentVisualPosition()
              editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, {
                ...currentNode.attrs,
                floating: true,
                xPt: visual.x,
                yPt: visual.y,
                offsetXPt: 0,
                offsetYPt: 0,
              }))
            } else sync()
          }
          event.preventDefault()
          return
        }
        if (!resizing) return
        resizing = false
        const target = event.currentTarget as HTMLElement
        if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId)
        if (typeof pos === 'number' && (Math.abs(previewWidthPt - startWidthPt) > 0.01 || Math.abs(previewXP - startXP) > 0.01 || Math.abs(previewYP - startYP) > 0.01 || Math.abs(previewOffsetX - startOffsetX) > 0.01 || Math.abs(previewOffsetY - startOffsetY) > 0.01)) {
          editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, startFloating ? {
            ...currentNode.attrs,
            widthPt: previewWidthPt,
            xPt: previewXP,
            yPt: previewYP,
          } : {
            ...currentNode.attrs,
            widthPt: previewWidthPt,
            offsetXPt: previewOffsetX,
            offsetYPt: previewOffsetY,
          }))
        } else sync()
        event.preventDefault()
      }

      dom.addEventListener('pointerdown', onImagePointerDown)
      wrapper.addEventListener('pointermove', onPointerMove)
      wrapper.addEventListener('pointerup', finishPointer)
      wrapper.addEventListener('pointercancel', finishPointer)
      for (const handle of handles.values()) handle.addEventListener('pointerdown', onHandlePointerDown)

      return {
        dom: wrapper,
        update(updatedNode) {
          if (updatedNode.type !== currentNode.type) return false
          currentNode = updatedNode
          if (!dragging && !resizing) sync()
          return true
        },
        selectNode() {
          wrapper.classList.add('ProseMirror-selectednode')
          for (const handle of handles.values()) handle.style.display = 'block'
        },
        deselectNode() {
          wrapper.classList.remove('ProseMirror-selectednode')
          for (const handle of handles.values()) handle.style.display = 'none'
        },
        stopEvent(event) { return event.type.startsWith('pointer') },
        destroy() {
          dom.removeEventListener('pointerdown', onImagePointerDown)
          wrapper.removeEventListener('pointermove', onPointerMove)
          wrapper.removeEventListener('pointerup', finishPointer)
          wrapper.removeEventListener('pointercancel', finishPointer)
          for (const handle of handles.values()) handle.removeEventListener('pointerdown', onHandlePointerDown)
        },
      }
    }
  },
})
