import { Fragment } from '@tiptap/pm/model'
import { Selection, type Command, type EditorState, type Transaction } from '@tiptap/pm/state'

export const pointsPerCm = 72 / 2.54
export type Margins = { marginTopPt: number; marginRightPt: number; marginBottomPt: number; marginLeftPt: number }

type PageEntry = { node: ReturnType<EditorState['doc']['child']>; pos: number; index: number }

function pageEntries(doc: EditorState['doc']): PageEntry[] {
  const pages: PageEntry[] = []
  let index = 0
  doc.forEach((node, pos) => {
    if (node.type.name === 'pdfPage') pages.push({ node, pos, index: index++ })
  })
  return pages
}

export function currentPage(state: EditorState) {
  const { $from } = state.selection
  let pos: number | null = null
  let node = null as ReturnType<EditorState['doc']['child']> | null
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === 'pdfPage') {
      node = $from.node(depth)
      pos = $from.before(depth)
      break
    }
  }
  if (!node) {
    const direct = state.doc.nodeAt(state.selection.from)
    if (direct?.type.name === 'pdfPage') { node = direct; pos = state.selection.from }
  }
  if (!node || pos === null) return null
  const index = pageEntries(state.doc).findIndex(page => page.pos === pos)
  return { node, pos, index }
}

export function pageInfo(state: EditorState) {
  const pages = pageEntries(state.doc)
  const active = currentPage(state)
  return {
    index: active?.index ?? -1,
    count: pages.length,
    canMoveUp: Boolean(active && active.index > 0),
    canMoveDown: Boolean(active && active.index >= 0 && active.index < pages.length - 1),
    canDelete: pages.length > 1 && Boolean(active),
  }
}

function selectInsidePage(tr: Transaction, pagePos: number) {
  const pos = Math.min(tr.doc.content.size, pagePos + 1)
  tr.setSelection(Selection.near(tr.doc.resolve(pos), 1))
  tr.scrollIntoView()
}

function renumberPages(tr: Transaction) {
  const pages: { pos: number; attrs: Record<string, unknown> }[] = []
  tr.doc.forEach((node, pos) => {
    if (node.type.name === 'pdfPage') pages.push({ pos, attrs: node.attrs })
  })
  const numbered = pages.find(page => page.attrs.pageNumber !== null)
  if (!numbered) return
  const start = Number(numbered.attrs.pageNumber)
  const alignment = numbered.attrs.pageNumberAlignment
  if (!Number.isInteger(start)) return
  pages.forEach((page, index) => {
    const node = tr.doc.nodeAt(page.pos)
    if (node?.type.name === 'pdfPage') tr.setNodeMarkup(page.pos, undefined, { ...node.attrs, pageNumber: start + index, pageNumberAlignment: alignment })
  })
}

export function duplicateCurrentPage(): Command {
  return (state, dispatch) => {
    const active = currentPage(state)
    if (!active) return false
    const insertPos = active.pos + active.node.nodeSize
    const tr = state.tr.insert(insertPos, active.node.copy(active.node.content))
    renumberPages(tr)
    selectInsidePage(tr, insertPos)
    if (dispatch) dispatch(tr)
    return true
  }
}

export function deleteCurrentPage(): Command {
  return (state, dispatch) => {
    const active = currentPage(state)
    const pages = pageEntries(state.doc)
    if (!active || pages.length <= 1) return false
    const tr = state.tr.delete(active.pos, active.pos + active.node.nodeSize)
    renumberPages(tr)
    const remaining = pageEntries(tr.doc)
    const destination = remaining[Math.min(active.index, remaining.length - 1)]
    if (destination) selectInsidePage(tr, destination.pos)
    if (dispatch) dispatch(tr)
    return true
  }
}

export function moveCurrentPage(direction: -1 | 1): Command {
  return (state, dispatch) => {
    const active = currentPage(state)
    const pages = pageEntries(state.doc)
    if (!active) return false
    const target = pages[active.index + direction]
    if (!target) return false
    const tr = state.tr
    let movedPos = active.pos
    if (direction < 0) {
      tr.replaceWith(target.pos, active.pos + active.node.nodeSize, Fragment.fromArray([active.node, target.node]))
      movedPos = target.pos
    } else {
      tr.replaceWith(active.pos, target.pos + target.node.nodeSize, Fragment.fromArray([target.node, active.node]))
      movedPos = active.pos + target.node.nodeSize
    }
    renumberPages(tr)
    selectInsidePage(tr, movedPos)
    if (dispatch) dispatch(tr)
    return true
  }
}

export function insertBlankPage(after: boolean): Command {
  return (state, dispatch) => {
    const active = currentPage(state)
    if (!active) return false
    const paragraph = state.schema.nodes.paragraph?.create()
    const pageType = state.schema.nodes.pdfPage
    if (!paragraph || !pageType) return false
    const blank = pageType.create({
      ...active.node.attrs,
      sourcePage: 0,
      pdfBackgrounds: [],
      pdfVisibilityArchive: [],
      pageNumber: null,
    }, paragraph)
    const insertPos = after ? active.pos + active.node.nodeSize : active.pos
    const tr = state.tr.insert(insertPos, blank)
    renumberPages(tr)
    selectInsidePage(tr, insertPos)
    if (dispatch) dispatch(tr)
    return true
  }
}

export function setPageMargins(margins: Margins, allPages: boolean): Command {
  return (state, dispatch) => {
    if (Object.values(margins).some(value => !Number.isFinite(value) || value < 0)) return false
    const active = currentPage(state)
    const pages: NonNullable<ReturnType<typeof currentPage>>[] = []
    state.doc.forEach((node, pos) => { if (node.type.name === 'pdfPage' && (allPages || pos === active?.pos)) pages.push({ node, pos, index: pages.length }) })
    if (!pages.length || pages.some(({ node }) =>
      node.attrs.pageWidthPt - margins.marginLeftPt - margins.marginRightPt < 72 ||
      node.attrs.pageHeightPt - margins.marginTopPt - Math.max(margins.marginBottomPt, node.attrs.pageNumber === null ? 0 : 24) < 72)) return false
    const tr = state.tr
    for (const { node, pos } of pages) {
      const oldWidth = node.attrs.pageWidthPt - node.attrs.marginLeftPt - node.attrs.marginRightPt
      const newWidth = node.attrs.pageWidthPt - margins.marginLeftPt - margins.marginRightPt
      const ratio = oldWidth > 0 ? newWidth / oldWidth : 1
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...margins })
      // Imported regions and table columns have explicit widths. Adapt these to
      // the new content area while leaving text sizes and vertical flow intact.
      if (Math.abs(ratio - 1) > 0.00001) node.descendants((child, offset) => {
        const attrs = { ...child.attrs }
        let changed = false
        if (attrs.pdfStyle && ('width' in attrs.pdfStyle || 'marginLeft' in attrs.pdfStyle)) {
          attrs.pdfStyle = { ...attrs.pdfStyle }
          for (const key of ['width', 'marginLeft']) if (typeof attrs.pdfStyle[key] === 'number') attrs.pdfStyle[key] *= ratio
          changed = true
        }
        if (Array.isArray(attrs.colwidth)) { attrs.colwidth = attrs.colwidth.map((width: number) => width * ratio); changed = true }
        if (changed) tr.setNodeMarkup(pos + 1 + offset, undefined, attrs)
      })
    }
    if (dispatch) dispatch(tr)
    return true
  }
}

export function setPageNumbers(enabled: boolean, start: number, alignment: 'left' | 'center' | 'right'): Command {
  return (state, dispatch) => {
    if (!Number.isInteger(start) || start < 1 || start > 9999) return false
    const tr = state.tr
    let index = 0
    state.doc.forEach((node, pos) => {
      if (node.type.name === 'pdfPage') tr.setNodeMarkup(pos, undefined, { ...node.attrs, pageNumber: enabled ? start + index++ : null, pageNumberAlignment: alignment })
    })
    if (dispatch) dispatch(tr)
    return true
  }
}
