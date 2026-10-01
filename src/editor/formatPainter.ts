import type { Command, EditorState, Transaction } from '@tiptap/pm/state'
import type { Node as DocumentNode, ResolvedPos } from '@tiptap/pm/model'
import { selectedRect, TableMap } from '@tiptap/pm/tables'
import { captureRow, copyRow } from './rowFormatting.ts'
import { setAlignment, setTextStyle, type Alignment, type TextStyle } from './formatting.ts'
import { normalizeExcelPaste } from './excelPaste.ts'

type ExcelCellFormat = {
  pdfStyle: Record<string, unknown>
  text: TextStyle
  alignment: Alignment
  bold: boolean
  italic: boolean
  underline: boolean
}
type ExcelRangeFormat = { rows: number; columns: number; cells: (ExcelCellFormat | null)[][] }
export type PaintFormat = {
  text: TextStyle
  alignment: Alignment
  bold: boolean
  italic: boolean
  underline: boolean
  row?: DocumentNode
  excelCell?: Pick<ExcelCellFormat, 'pdfStyle'>
  excelRange?: ExcelRangeFormat
}

function cellAround($pos: ResolvedPos) {
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth)
    if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') return { node, pos: $pos.before(depth) }
  }
}

function excelCellAtSelection(state: EditorState) {
  const cell = cellAround(state.selection.$from)
  if (!cell || cell.node.attrs.pdfStyle?.excelPaste !== true) return
  return cell
}

function colorToHex(value: string | null | undefined) {
  if (!value) return '#000000'
  const text = value.trim().toLowerCase()
  if (/^#[\da-f]{6}$/i.test(text)) return text
  if (/^#[\da-f]{3}$/i.test(text)) return '#' + text.slice(1).split('').map(c => c + c).join('')
  const rgb = text.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i)
  if (rgb) return '#' + rgb.slice(1, 4).map(n => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, '0')).join('')
  return '#000000'
}

function sizePt(value: string | null | undefined) {
  const text = value?.trim() || ''
  const n = Number.parseFloat(text)
  if (!Number.isFinite(n) || n <= 0) return 11
  return /pt$/i.test(text) ? n : /px$/i.test(text) || !/[a-z]/i.test(text) ? n * 0.75 : n
}

function parsePdfStyle(element: Element): Record<string, unknown> {
  try {
    const value = JSON.parse(element.getAttribute('data-pdf-style') || '{}')
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch { return {} }
}

/** Read formatting only from Excel clipboard HTML. Cell values are never retained. */
export function captureExcelClipboardFormat(html: string): PaintFormat | null {
  if (!html || !/(?:urn:schemas-microsoft-com:office:excel|mso-|class\s*=\s*["']?xl\d)/i.test(html)) return null
  const normalized = normalizeExcelPaste(html)
  const doc = new DOMParser().parseFromString(normalized, 'text/html')
  const table = doc.querySelector('table')
  if (!table) return null

  const sourceRows = Array.from(table.rows)
  if (!sourceRows.length) return null
  const matrix: (ExcelCellFormat | null)[][] = []
  const occupied: number[] = []
  let maxColumns = 0

  sourceRows.forEach((row, rowIndex) => {
    matrix[rowIndex] ||= []
    let column = 0
    for (const cell of Array.from(row.cells)) {
      while ((occupied[column] || 0) > rowIndex) column++
      const pdfStyle = parsePdfStyle(cell)
      const span = cell.querySelector('span[style]') as HTMLElement | null
      const style = span?.style
      const paragraph = cell.querySelector('p')
      const paragraphStyle = parsePdfStyle(paragraph || cell)
      const alignment = String(pdfStyle.textAlign || paragraphStyle.textAlign || cell.style.textAlign || 'left') as Alignment
      const first: ExcelCellFormat = {
        pdfStyle: { ...pdfStyle, excelPaste: true },
        text: {
          fontFamily: style?.fontFamily || 'Calibri, Arial, sans-serif',
          fontSizePt: sizePt(style?.fontSize),
          color: colorToHex(style?.color),
        },
        alignment: ['left', 'center', 'right', 'justify'].includes(alignment) ? alignment : 'left',
        bold: Boolean(cell.querySelector('strong,b')) || style?.fontWeight === 'bold' || Number(style?.fontWeight || 0) >= 600,
        italic: Boolean(cell.querySelector('em,i')) || style?.fontStyle === 'italic',
        underline: Boolean(cell.querySelector('u')) || Boolean(style?.textDecorationLine?.includes('underline')),
      }
      for (let r = 0; r < Math.max(1, cell.rowSpan); r++) {
        const rowTarget = matrix[rowIndex + r] || (matrix[rowIndex + r] = [])
        for (let c = 0; c < Math.max(1, cell.colSpan); c++) rowTarget[column + c] = first
      }
      for (let c = 0; c < Math.max(1, cell.colSpan); c++) occupied[column + c] = rowIndex + Math.max(1, cell.rowSpan)
      column += Math.max(1, cell.colSpan)
      maxColumns = Math.max(maxColumns, column)
    }
  })
  const rows = matrix.length
  const cells = Array.from({ length: rows }, (_, row) => Array.from({ length: maxColumns }, (_, column) => matrix[row]?.[column] || null))
  const first = cells.flat().find(Boolean)
  if (!first) return null
  return {
    text: first.text,
    alignment: first.alignment,
    bold: first.bold,
    italic: first.italic,
    underline: first.underline,
    excelRange: { rows, columns: maxColumns, cells },
  }
}

export function captureFormat(state: EditorState): PaintFormat {
  let marks = state.storedMarks ?? state.selection.$from.marks()
  if (!state.selection.empty) {
    let found = false
    state.doc.nodesBetween(state.selection.from, state.selection.to, node => {
      if (!found && node.isText) { marks = node.marks; found = true }
    })
  }
  const text = state.schema.marks.pdfTextStyle.isInSet(marks)?.attrs
  const row = captureRow(state)
  const excelCell = row ? undefined : excelCellAtSelection(state)
  return {
    row,
    excelCell: excelCell ? { pdfStyle: { ...excelCell.node.attrs.pdfStyle } } : undefined,
    text: { fontFamily: text?.fontFamily || 'Arial, sans-serif', fontSizePt: text?.fontSizePt || 9, color: text?.color || '#000000' },
    alignment: state.selection.$from.parent.attrs.pdfStyle?.textAlign || 'left',
    bold: Boolean(state.schema.marks.bold.isInSet(marks)), italic: Boolean(state.schema.marks.italic.isInSet(marks)), underline: Boolean(state.schema.marks.underline.isInSet(marks)),
  }
}

function applyCellVisual(format: ExcelCellFormat, tr: Transaction, cellPos: number, state: EditorState) {
  const cell = tr.doc.nodeAt(cellPos)
  if (!cell || (cell.type.name !== 'tableCell' && cell.type.name !== 'tableHeader')) return false
  tr.setNodeMarkup(cellPos, undefined, {
    ...cell.attrs,
    pdfStyle: { ...cell.attrs.pdfStyle, ...format.pdfStyle, excelPaste: true },
  })
  const updated = tr.doc.nodeAt(cellPos)
  if (!updated) return false
  const textStyle = state.schema.marks.pdfTextStyle
  const markTypes = { bold: state.schema.marks.bold, italic: state.schema.marks.italic, underline: state.schema.marks.underline }
  updated.descendants((node, relativePos) => {
    const pos = cellPos + 1 + relativePos
    if (node.type.name === 'paragraph' || node.type.name === 'heading') {
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, pdfStyle: { ...node.attrs.pdfStyle, textAlign: format.alignment } })
    }
    if (!node.isText) return
    const end = pos + node.nodeSize
    tr.removeMark(pos, end, textStyle)
    tr.addMark(pos, end, textStyle.create(format.text))
    for (const name of ['bold', 'italic', 'underline'] as const) {
      tr.removeMark(pos, end, markTypes[name])
      if (format[name]) tr.addMark(pos, end, markTypes[name].create())
    }
  })
  return true
}

function paintExcelCell(format: PaintFormat, state: EditorState, dispatch?: (tr: Transaction) => void) {
  if (!format.excelCell) return false
  const destination = excelCellAtSelection(state)
  if (!destination) return false
  const cellFormat: ExcelCellFormat = {
    pdfStyle: format.excelCell.pdfStyle,
    text: format.text,
    alignment: format.alignment,
    bold: format.bold,
    italic: format.italic,
    underline: format.underline,
  }
  const tr = state.tr
  if (!applyCellVisual(cellFormat, tr, destination.pos, state)) return false
  if (dispatch) dispatch(tr)
  return true
}

function paintExcelRange(format: PaintFormat, state: EditorState, dispatch?: (tr: Transaction) => void) {
  const source = format.excelRange
  if (!source) return false
  try {
    const rect = selectedRect(state)
    const table = rect.table
    const map = TableMap.get(table)
    const startRow = rect.top
    const startColumn = rect.left
    const tr = state.tr
    const applied = new Set<number>()
    let changed = false
    for (let row = 0; row < source.rows; row++) {
      for (let column = 0; column < source.columns; column++) {
        const sourceCell = source.cells[row]?.[column]
        const targetRow = startRow + row
        const targetColumn = startColumn + column
        if (!sourceCell || targetRow >= map.height || targetColumn >= map.width) continue
        const offset = map.map[targetRow * map.width + targetColumn]
        if (applied.has(offset)) continue
        applied.add(offset)
        const cellPos = rect.tableStart + offset
        changed = applyCellVisual(sourceCell, tr, cellPos, state) || changed
      }
    }
    if (!changed) return false
    if (dispatch) dispatch(tr.scrollIntoView())
    return true
  } catch { return false }
}

export function paintFormat(format: PaintFormat): Command {
  return (state, dispatch) => {
    if (format.row) return copyRow(format.row)(state, dispatch)
    if (format.excelRange) return paintExcelRange(format, state, dispatch)
    // Excel-pasted cells need cell-level visual formatting (fill/borders/
    // alignment) in addition to text marks. This path is deliberately limited
    // to source+destination cells tagged by ExcelPaste, leaving the validated
    // painter behavior everywhere else unchanged.
    if (format.excelCell && excelCellAtSelection(state)) return paintExcelCell(format, state, dispatch)

    let tr = state.tr
    if (!setTextStyle(format.text)(state, next => { tr = next })) return false
    setAlignment(format.alignment)(state.apply(tr), next => { next.steps.forEach(step => tr.step(step)) })
    for (const name of ['bold', 'italic', 'underline'] as const) {
      const type = state.schema.marks[name]
      if (state.selection.empty) {
        const existing = tr.storedMarks ?? state.storedMarks ?? state.selection.$from.marks()
        tr.setStoredMarks(format[name] ? type.create().addToSet(existing) : type.removeFromSet(existing))
      } else for (const range of state.selection.ranges) {
        if (format[name]) tr.addMark(range.$from.pos, range.$to.pos, type.create())
        else tr.removeMark(range.$from.pos, range.$to.pos, type)
      }
    }
    // Alignment steps can clear the stored text style at an empty selection.
    if (state.selection.empty) tr.addStoredMark(state.schema.marks.pdfTextStyle.create(format.text))
    if (dispatch) dispatch(tr)
    return true
  }
}
