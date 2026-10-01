import type { Node as DocumentNode } from '@tiptap/pm/model'
import type { Command, EditorState } from '@tiptap/pm/state'
import { CellSelection, isInTable, selectedRect, selectionCell } from '@tiptap/pm/tables'

export const selectWholeRow: Command = (state, dispatch) => {
  if (!isInTable(state)) return false
  if (dispatch) dispatch(state.tr.setSelection(CellSelection.rowSelection(selectionCell(state))))
  return true
}

export function captureRow(state: EditorState): DocumentNode | undefined {
  if (!(state.selection instanceof CellSelection) || !state.selection.isRowSelection()) return
  const rect = selectedRect(state)
  if (rect.bottom - rect.top !== 1) return
  return rect.table.child(rect.top)
}

export function rowBackground(state: EditorState) {
  if (!isInTable(state)) return null
  const rect = selectedRect(state)
  return rect.table.child(rect.top).firstChild?.attrs.pdfStyle?.backgroundColor || 'transparent'
}

export function copyRow(source: DocumentNode): Command {
  return (state, dispatch) => {
    if (!isInTable(state)) return false
    const rect = selectedRect(state)
    const targets = Array.from({ length: rect.bottom - rect.top }, (_, i) => rect.top + i)
    // Do not silently reshape a table or overwrite neighbouring merged cells.
    const compatible = (row: DocumentNode) => row.childCount === source.childCount && Array.from({ length: row.childCount }, (_, i) => {
      const from = source.child(i), to = row.child(i)
      return from.attrs.rowspan === 1 && to.attrs.rowspan === 1 && from.attrs.colspan === to.attrs.colspan
    }).every(Boolean)
    if (!targets.every(row => compatible(rect.table.child(row)))) return false
    const tr = state.tr
    const replacements: { pos: number; old: DocumentNode; next: DocumentNode }[] = []
    rect.table.forEach((row, offset, index) => {
      if (!targets.includes(index)) return
      const cells = Array.from({ length: row.childCount }, (_, i) => {
        const from = source.child(i), to = row.child(i)
        // Keep destination column widths and cell types; copy all visual cell
        // attributes and the full content, including empty cells and text marks.
        return to.type.create({ ...to.attrs, pdfStyle: { ...from.attrs.pdfStyle } }, from.content)
      })
      replacements.push({ pos: rect.tableStart + offset, old: row, next: row.type.create({ ...row.attrs, pdfStyle: { ...source.attrs.pdfStyle } }, cells) })
    })
    for (const replacement of replacements.reverse()) tr.replaceWith(replacement.pos, replacement.pos + replacement.old.nodeSize, replacement.next)
    if (dispatch) dispatch(tr)
    return true
  }
}

export function paintRowBackground(color: string): Command {
  return (state, dispatch) => {
    if (!isInTable(state) || (color !== 'transparent' && !/^#[\da-f]{6}$/i.test(color))) return false
    const rect = selectedRect(state), tr = state.tr
    rect.table.forEach((row, offset, index) => {
      if (index < rect.top || index >= rect.bottom) return
      const pos = rect.tableStart + offset
      tr.setNodeMarkup(pos, undefined, { ...row.attrs, pdfStyle: { ...row.attrs.pdfStyle, backgroundColor: color } })
      row.forEach((cell, cellOffset) => {
        tr.setNodeMarkup(pos + 1 + cellOffset, undefined, { ...cell.attrs, pdfStyle: { ...cell.attrs.pdfStyle, backgroundColor: color } })
      })
    })
    if (dispatch) dispatch(tr)
    return true
  }
}
