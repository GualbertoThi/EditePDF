import type { Command, EditorState } from '@tiptap/pm/state'

export type TextStyle = { fontFamily: string; fontSizePt: number; color: string }
export type Alignment = 'left' | 'center' | 'right' | 'justify'
const defaults: TextStyle = { fontFamily: 'Arial, sans-serif', fontSizePt: 9, color: '#000000' }

export function selectionFormatting(state: EditorState) {
  const styles: TextStyle[] = []
  const alignments: string[] = []
  const { selection } = state
  if (selection.empty) styles.push({ ...defaults, ...state.schema.marks.pdfTextStyle.isInSet(state.storedMarks ?? selection.$from.marks())?.attrs })
  for (const range of selection.ranges) {
    state.doc.nodesBetween(range.$from.pos, range.$to.pos, node => {
      if (node.isText && !selection.empty) styles.push({ ...defaults, ...node.marks.find(mark => mark.type.name === 'pdfTextStyle')?.attrs })
      if (node.type.name === 'paragraph' || node.type.name === 'heading') alignments.push(node.attrs.pdfStyle?.textAlign || 'left')
    })
  }
  if (selection.empty && selection.$from.parent.isTextblock) alignments.push(selection.$from.parent.attrs.pdfStyle?.textAlign || 'left')
  const common = <K extends keyof TextStyle>(key: K): TextStyle[K] | '' => styles.length && styles.every(s => s[key] === styles[0][key]) ? styles[0][key] : ''
  return { fontFamily: common('fontFamily'), fontSizePt: common('fontSizePt'), color: common('color'), alignment: alignments.length && alignments.every(a => a === alignments[0]) ? alignments[0] : '' }
}

/** Update only requested attributes, preserving each run's other formatting. */
export function setTextStyle(patch: Partial<TextStyle>): Command {
  return (state, dispatch) => {
    if (patch.fontSizePt !== undefined && (!Number.isFinite(patch.fontSizePt) || patch.fontSizePt < 1 || patch.fontSizePt > 200)) return false
    if (patch.color !== undefined && !/^#[\da-f]{6}$/i.test(patch.color)) return false
    const type = state.schema.marks.pdfTextStyle
    const tr = state.tr
    if (state.selection.empty) {
      const marks = state.storedMarks ?? state.selection.$from.marks()
      tr.addStoredMark(type.create({ ...type.isInSet(marks)?.attrs, ...patch }))
    } else {
      for (const range of state.selection.ranges) {
        state.doc.nodesBetween(range.$from.pos, range.$to.pos, (node, pos) => {
          if (!node.isText) return
          tr.addMark(Math.max(pos, range.$from.pos), Math.min(pos + node.nodeSize, range.$to.pos), type.create({ ...type.isInSet(node.marks)?.attrs, ...patch }))
        })
      }
    }
    // Imported line heights are fixed in points. Grow them with larger text.
    if (patch.fontSizePt !== undefined) {
      const positions = new Set<number>()
      for (const range of state.selection.ranges) {
        state.doc.nodesBetween(range.$from.pos, range.$to.pos, (node, pos) => {
          if (node.type.name === 'paragraph' || node.type.name === 'heading') positions.add(pos)
        })
      }
      if (state.selection.empty && state.selection.$from.depth && state.selection.$from.parent.isTextblock) positions.add(state.selection.$from.before())
      for (const pos of positions) {
        const node = tr.doc.nodeAt(pos)!
        let size = patch.fontSizePt
        node.descendants(child => { if (child.isText) size = Math.max(size, Number(type.isInSet(child.marks)?.attrs.fontSizePt) || 9) })
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, pdfStyle: { ...node.attrs.pdfStyle, lineHeight: Math.max(Number(node.attrs.pdfStyle?.lineHeight) || 0, size * 1.2) } })
      }
      // Node attribute steps clear stored marks; restore typing formatting.
      if (state.selection.empty) tr.setStoredMarks(type.create({ ...type.isInSet(state.storedMarks ?? state.selection.$from.marks())?.attrs, ...patch }).addToSet(state.storedMarks ?? state.selection.$from.marks()))
    }
    if (dispatch) dispatch(tr)
    return true
  }
}

export function setAlignment(alignment: Alignment): Command {
  return (state, dispatch) => {
    const tr = state.tr
    const positions = new Set<number>()
    for (const range of state.selection.ranges) {
      state.doc.nodesBetween(range.$from.pos, range.$to.pos, (node, pos) => {
        if (node.type.name === 'paragraph' || node.type.name === 'heading') positions.add(pos)
      })
    }
    if (state.selection.empty && state.selection.$from.depth && state.selection.$from.parent.isTextblock) positions.add(state.selection.$from.before())
    for (const pos of positions) {
      const node = state.doc.nodeAt(pos)!
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, pdfStyle: { ...node.attrs.pdfStyle, textAlign: alignment } })
    }
    if (!positions.size) return false
    tr.setStoredMarks(state.storedMarks)
    if (dispatch) dispatch(tr)
    return true
  }
}
