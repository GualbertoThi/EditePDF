import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getSchema } from '@tiptap/react'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { CellSelection } from '@tiptap/pm/tables'
import { history, undo, redo } from '@tiptap/pm/history'
import { documentExtensions } from '../src/document-model/schema.ts'
import { setTextStyle, setAlignment, selectionFormatting } from '../src/editor/formatting.ts'

const schema = getSchema(documentExtensions())
const paragraph = () => schema.nodeFromJSON({ type: 'paragraph', attrs: { pdfStyle: { marginTop: 5, lineHeight: 12, textAlign: 'left' } }, content: [
  { type: 'text', text: 'Alpha', marks: [{ type: 'bold' }, { type: 'pdfTextStyle', attrs: { color: '#ff0000', fontSizePt: 10, fontFamily: 'Arial, sans-serif' } }] },
  { type: 'text', text: 'Beta', marks: [{ type: 'italic' }, { type: 'pdfTextStyle', attrs: { color: '#0000ff', fontSizePt: 14, fontFamily: 'Georgia, serif' } }] },
] })
function session(doc, from, to = from) {
  let state = EditorState.create({ schema, doc, plugins: [history()] })
  state = state.apply(state.tr.setSelection(TextSelection.create(doc, from, to)))
  return { get state() { return state }, apply(command) { return command(state, tr => { state = state.apply(tr) }) } }
}
test('partial selection changes only requested style; undo and redo preserve imported runs', () => {
  const doc = schema.node('doc', null, [paragraph()])
  const s = session(doc, 3, 8)
  assert.equal(selectionFormatting(s.state).fontFamily, '')
  assert.ok(s.apply(setTextStyle({ fontFamily: 'Verdana, sans-serif' })))
  const runs = []
  s.state.doc.firstChild.forEach(node => runs.push(node))
  assert.deepEqual(runs.map(n => n.text), ['Al', 'pha', 'Be', 'ta'])
  assert.equal(runs[1].marks.find(m => m.type.name === 'pdfTextStyle').attrs.color, '#ff0000')
  assert.equal(runs[2].marks.find(m => m.type.name === 'pdfTextStyle').attrs.color, '#0000ff')
  assert.ok(runs[1].marks.some(m => m.type.name === 'bold'))
  assert.ok(runs[2].marks.some(m => m.type.name === 'italic'))
  const changed = s.state.doc.toJSON()
  assert.ok(s.apply(undo))
  assert.deepEqual(s.state.doc.toJSON(), doc.toJSON())
  assert.ok(s.apply(redo))
  assert.deepEqual(s.state.doc.toJSON(), changed)
})
test('cursor formatting applies to new text and grows the imported line height', () => {
  const s = session(schema.node('doc', null, [paragraph()]), 3)
  s.apply(setTextStyle({ fontSizePt: 24 }))
  s.apply(setTextStyle({ color: '#00ff00' }))
  assert.equal(selectionFormatting(s.state).fontSizePt, 24)
  s.apply((state, dispatch) => { dispatch(state.tr.insertText('X')); return true })
  const inserted = s.state.doc.firstChild.child(1)
  assert.equal(inserted.text, 'X')
  assert.equal(inserted.marks.find(m => m.type.name === 'pdfTextStyle').attrs.color, '#00ff00')
  assert.ok(inserted.marks.some(m => m.type.name === 'bold'))
  assert.ok(s.state.doc.firstChild.attrs.pdfStyle.lineHeight >= 28.8 - 0.001)
  assert.equal(s.state.doc.firstChild.attrs.pdfStyle.marginTop, 5)
  assert.equal(s.apply(setTextStyle({ fontSizePt: NaN })), false)
})
test('alignment preserves paragraph geometry and applies across selected cells', () => {
  const cell = () => schema.nodes.tableCell.createAndFill(null, paragraph())
  const table = schema.nodes.table.create(null, schema.nodes.tableRow.create(null, [cell(), cell()]))
  const doc = schema.node('doc', null, table)
  let state = EditorState.create({ schema, doc })
  const cells = []
  doc.descendants((node, pos) => { if (node.type.name === 'tableCell') cells.push(pos) })
  state = state.apply(state.tr.setSelection(CellSelection.create(doc, cells[0], cells[1])))
  assert.ok(setAlignment('center')(state, tr => { state = state.apply(tr) }))
  assert.ok(setTextStyle({ color: '#123456' })(state, tr => { state = state.apply(tr) }))
  state.doc.descendants(node => {
    if (node.type.name === 'paragraph') {
      assert.equal(node.attrs.pdfStyle.textAlign, 'center')
      assert.equal(node.attrs.pdfStyle.marginTop, 5)
    }
    if (node.isText) assert.equal(node.marks.find(m => m.type.name === 'pdfTextStyle').attrs.color, '#123456')
  })
  assert.equal(selectionFormatting(state).alignment, 'center')
  state.doc.check()
})
