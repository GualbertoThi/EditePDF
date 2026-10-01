import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getSchema } from '@tiptap/react'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { history, undo } from '@tiptap/pm/history'
import { documentExtensions } from '../src/document-model/schema.ts'
import { captureFormat, paintFormat } from '../src/editor/formatPainter.ts'
import { selectWholeRow, paintRowBackground } from '../src/editor/rowFormatting.ts'

const schema = getSchema(documentExtensions())
function fixture() {
  const row = (texts, color) => ({ type: 'tableRow', attrs: { pdfStyle: { height: 22 } }, content: texts.map(text => ({ type: 'tableCell', attrs: { colwidth: [120], pdfStyle: { backgroundColor: color, borderBottom: '0.5pt solid #aabbcc', paddingLeft: 5 } }, content: [{ type: 'paragraph', attrs: { pdfStyle: { textAlign: 'right', lineHeight: 12 } }, content: text ? [{ type: 'text', text, marks: [{ type: 'bold' }, { type: 'pdfTextStyle', attrs: { color: '#123456', fontSizePt: 10 } }] }] : undefined }] })) })
  const doc = schema.nodeFromJSON({ type: 'doc', content: [{ type: 'table', content: [row(['Origem', ''], '#eeeeff'), row(['Destino', 'Apagar'], '#ffffff'), row(['Vizinha', 'Intacta'], '#dddddd')] }] })
  let state = EditorState.create({ schema, doc, plugins: [history()] })
  const positions = []
  doc.descendants((node, pos) => { if (node.type.name === 'tableCell') positions.push(pos + 2) })
  const dispatch = tr => { state = state.apply(tr) }
  return { doc, positions, get state() { return state }, select: pos => dispatch(state.tr.setSelection(TextSelection.create(state.doc, pos))), run: command => command(state, dispatch) }
}
test('whole-row painter copies content, empty cells, backgrounds, borders and paragraph/text styles with undo', () => {
  const s = fixture()
  s.select(s.positions[0])
  assert.equal(captureFormat(s.state).row, undefined, 'ordinary text painter remains unchanged')
  assert.ok(s.run(selectWholeRow))
  const format = captureFormat(s.state)
  assert.ok(format.row)
  const source = s.state.doc.firstChild.child(0).toJSON()
  const neighbour = s.state.doc.firstChild.child(2).toJSON()
  s.select(s.positions[2])
  assert.ok(s.run(paintFormat(format)))
  assert.deepEqual(s.state.doc.firstChild.child(1).toJSON(), source)
  assert.deepEqual(s.state.doc.firstChild.child(0).toJSON(), source)
  assert.deepEqual(s.state.doc.firstChild.child(2).toJSON(), neighbour)
  s.state.doc.check()
  assert.deepEqual(schema.nodeFromJSON(s.state.doc.toJSON()).toJSON(), s.state.doc.toJSON())
  assert.ok(s.run(undo))
  assert.deepEqual(s.state.doc.toJSON(), s.doc.toJSON())
})
test('row background changes only the selected row and keeps borders and content', () => {
  const s = fixture()
  s.select(s.positions[2])
  assert.ok(s.run(paintRowBackground('#ffaabb')))
  const table = s.state.doc.firstChild
  assert.deepEqual(table.child(0).toJSON(), s.doc.firstChild.child(0).toJSON())
  assert.deepEqual(table.child(2).toJSON(), s.doc.firstChild.child(2).toJSON())
  table.child(1).forEach(cell => {
    assert.equal(cell.attrs.pdfStyle.backgroundColor, '#ffaabb')
    assert.equal(cell.attrs.pdfStyle.borderBottom, '0.5pt solid #aabbcc')
  })
  assert.equal(table.textContent, s.doc.firstChild.textContent)
  assert.ok(s.run(paintRowBackground('transparent')))
  assert.equal(s.state.doc.firstChild.child(1).firstChild.attrs.pdfStyle.backgroundColor, 'transparent')
})
test('incompatible destination is rejected without changing any content', () => {
  const s = fixture()
  s.select(s.positions[0]); s.run(selectWholeRow)
  const format = captureFormat(s.state)
  const source = format.row
  format.row = source.type.create(source.attrs, source.firstChild)
  s.select(s.positions[2])
  const before = s.state.doc.toJSON()
  assert.equal(s.run(paintFormat(format)), false)
  assert.deepEqual(s.state.doc.toJSON(), before)
})
