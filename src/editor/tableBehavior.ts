import { Extension } from '@tiptap/react'
import { Fragment } from '@tiptap/pm/model'
import { Plugin, TextSelection } from '@tiptap/pm/state'
import type { Command } from '@tiptap/pm/state'
import { addRowBefore, addRowAfter, addColumnBefore, addColumnAfter, goToNextCell, isInTable, selectedRect, TableMap } from '@tiptap/pm/tables'

/** Boxed forms copy the neighboring field's presentation, never its value.
 * Other tables keep the existing ProseMirror insertion behavior. */
export function addStyledColumn(after: boolean): Command {
  return (state, dispatch) => {
    const command = after ? addColumnAfter : addColumnBefore
    if (!isInTable(state)) return false
    const rect = selectedRect(state)
    if (rect.table.attrs.pdfSource?.confidence !== 'boxed-form') return command(state, dispatch)
    let merged = false
    rect.table.descendants(node => { if (node.attrs.colspan > 1 || node.attrs.rowspan > 1) merged = true })
    if (merged) return command(state, dispatch)
    const index = after ? rect.right : rect.left, reference = after ? rect.right-1 : rect.left
    return command(state, dispatch ? tr => {
      const table = tr.doc.nodeAt(rect.tableStart-1)!, map = TableMap.get(table)
      const templates = Array.from({length:rect.map.height},(_,row) => rect.table.nodeAt(rect.map.map[row*rect.map.width+reference])!)
      const updated = new Set<number>()
      for (let row=map.height-1;row>=0;row--) {
        const offset = map.map[row*map.width+index]
        if(updated.has(offset)) continue
        updated.add(offset)
        const cell = table.nodeAt(offset)!, template=templates[row]
        const p=template.firstChild
        let marks=p?.attrs.emptyTextMarks || []
        template.descendants(n => {if(n.isText&&!marks.length)marks=n.marks.map(m=>m.toJSON())})
        const empty=state.schema.nodes.paragraph.create({...p?.attrs,pdfSource:null,emptyTextMarks:marks})
        tr.replaceWith(rect.tableStart+offset,rect.tableStart+offset+cell.nodeSize,cell.type.create({...cell.attrs,pdfSource:null,pdfStyle:{...template.attrs.pdfStyle},colwidth:template.attrs.colwidth},empty))
      }
      // Fit one extra field within this form band's current width. Do not
      // enlarge the page or overlap the neighboring form groups.
      const oldWidths=Array.from({length:rect.map.width},(_,c)=>rect.table.nodeAt(rect.map.map[c])!.attrs.colwidth?.[0] || 24)
      const widths=[...oldWidths];widths.splice(index,0,oldWidths[reference])
      const spacing=parseFloat(rect.table.attrs.pdfStyle?.borderSpacing||'0')*4/3
      const available=Math.max(widths.length*24,oldWidths.reduce((a,b)=>a+b,0)-spacing)
      const total=widths.reduce((a,b)=>a+b,0)
      const adjusted=widths.map(w=>Math.max(24,w*available/total))
      const excess=adjusted.reduce((a,b)=>a+b,0)-available
      const flexible=adjusted.reduce((s,w)=>s+Math.max(0,w-24),0)
      const fitted=adjusted.map(w=>w>24&&flexible ? w-excess*(w-24)/flexible : w)
      const result=tr.doc.nodeAt(rect.tableStart-1)!, resultMap=TableMap.get(result)
      result.descendants((node,pos) => {
        if(node.type.spec.tableRole!=='cell'&&node.type.spec.tableRole!=='header_cell')return
        const column=resultMap.findCell(pos).left
        tr.setNodeMarkup(rect.tableStart+pos,undefined,{...node.attrs,colwidth:fitted.slice(column,column+node.attrs.colspan)})
      })
      dispatch(tr.scrollIntoView())
    } : undefined)
  }
}

export function addStyledRow(after: boolean): Command {
  return (state, dispatch) => {
    if (!isInTable(state)) return false
    const rect = selectedRect(state)
    const index = after ? rect.bottom : rect.top
    const reference = after ? rect.bottom - 1 : rect.top
    let source = rect.table.child(reference)
    let sourceIndex = reference
    // Continue an established A/B/A stripe sequence; never infer from a header.
    const step = after ? -1 : 1
    const previous = reference + step, earlier = reference + 2 * step
    const signature = (row: typeof source) => JSON.stringify([row.attrs.pdfStyle, ...Array.from({ length: row.childCount }, (_, i) => row.child(i).attrs.pdfStyle)])
    if (earlier >= 0 && earlier < rect.table.childCount) {
      const other = rect.table.child(previous), same = rect.table.child(earlier)
      const body = [source, other, same].every(row => Array.from({ length: row.childCount }, (_, i) => row.child(i).type.name === 'tableCell').every(Boolean))
      if (body && signature(source) === signature(same) && signature(source) !== signature(other)) { source = other; sourceIndex = previous }
    }
    return (after ? addRowAfter : addRowBefore)(state, dispatch ? tr => {
      const table = tr.doc.nodeAt(rect.tableStart - 1)!
      let rowPos = rect.tableStart
      for (let i = 0; i < index; i++) rowPos += table.child(i).nodeSize
      const row = table.child(index)
      tr.setNodeMarkup(rowPos, undefined, { ...row.attrs, pdfSource: null, pdfStyle: { ...source.attrs.pdfStyle } })
      // Match by visual column, including colspans. Keep the library's merge geometry.
      let offset = 0
      const newMap = TableMap.get(table)
      row.forEach((cell, oldOffset) => {
        const column = newMap.findCell(rowPos - rect.tableStart + 1 + oldOffset).left
        const template = rect.table.nodeAt(rect.map.map[sourceIndex * rect.map.width + column])!
        const paragraph = template.firstChild
        let marks = paragraph?.attrs.emptyTextMarks || []
        template.descendants(node => { if (node.isText && !marks.length) marks = node.marks.map(mark => mark.toJSON()) })
        const empty = state.schema.nodes.paragraph.create({ ...paragraph?.attrs, pdfSource: null, emptyTextMarks: marks })
        const replacement = cell.type.create({ ...cell.attrs, pdfSource: null, pdfStyle: { ...template.attrs.pdfStyle }, colwidth: template.attrs.colspan === cell.attrs.colspan ? template.attrs.colwidth : cell.attrs.colwidth }, Fragment.from(empty))
        tr.replaceWith(rowPos + 1 + offset, rowPos + 1 + offset + cell.nodeSize, replacement)
        offset += replacement.nodeSize
      })
      tr.setSelection(TextSelection.near(tr.doc.resolve(rowPos + 2)))
      dispatch(tr.scrollIntoView())
    } : undefined)
  }
}

/** Move the actual table between page blocks, keeping its content and styles. */
export function moveTable(direction: -1 | 1): Command {
  return (state, dispatch) => {
    if (!isInTable(state)) return false
    const rect = selectedRect(state), pos = rect.tableStart - 1
    const $pos = state.doc.resolve(pos)
    let pageDepth = $pos.depth
    while (pageDepth > 0 && $pos.node(pageDepth).type.name !== 'pdfPage') pageDepth--
    if (!pageDepth) return false
    const page = $pos.node(pageDepth), index = $pos.index(pageDepth)
    const nested = $pos.depth > pageDepth
    const targetIndex = nested ? index + (direction === 1 ? 1 : 0) : index + (direction === 1 ? 2 : -1)
    if (targetIndex < 0 || targetIndex > page.childCount) return false
    let target = $pos.start(pageDepth)
    for (let i = 0; i < targetIndex; i++) target += page.child(i).nodeSize
    if (dispatch) {
      const tr = state.tr.delete(pos, pos + rect.table.nodeSize)
      const destination = tr.mapping.map(target, direction)
      tr.insert(destination, rect.table)
      tr.setSelection(TextSelection.near(tr.doc.resolve(destination + 1)))
      dispatch(tr.scrollIntoView())
    }
    return true
  }
}

export const TableBehavior = Extension.create({
  name: 'tableBehavior', priority: 1000,
  addGlobalAttributes() {
    return [{ types: ['paragraph'], attributes: { emptyTextMarks: { default: [], rendered: false } } }]
  },
  addKeyboardShortcuts() {
    return { Tab: () => {
      const { state, dispatch } = this.editor.view
      if (!isInTable(state)) return false
      if (goToNextCell(1)(state, dispatch)) return true
      return addStyledRow(true)(state, dispatch)
    } }
  },
  addProseMirrorPlugins() {
    return [new Plugin({ appendTransaction(transactions, _old, state) {
      if (!transactions.some(tr => tr.selectionSet || tr.docChanged) || state.storedMarks) return null
      const { $from, empty } = state.selection
      const marks = $from.parent.attrs.emptyTextMarks
      if (!empty || $from.parent.content.size || !marks?.length) return null
      return state.tr.setStoredMarks(marks.map((mark: Parameters<typeof state.schema.markFromJSON>[0]) => state.schema.markFromJSON(mark)))
    } })]
  },
})
