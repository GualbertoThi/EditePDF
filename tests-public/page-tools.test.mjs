import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getSchema } from '@tiptap/react'
import { EditorState, TextSelection, NodeSelection } from '@tiptap/pm/state'
import { history, undo } from '@tiptap/pm/history'
import { documentExtensions } from '../src/document-model/schema.ts'
import { currentPage, setPageMargins, setPageNumbers } from '../src/editor/pageCommands.ts'
import { captureFormat, paintFormat } from '../src/editor/formatPainter.ts'

const schema = getSchema(documentExtensions())
const paragraph = (text, styled = false) => ({ type: 'paragraph', attrs: { pdfStyle: { lineHeight: 12, textAlign: styled ? 'right' : 'left' } }, content: [{ type: 'text', text, marks: styled ? [{ type: 'bold' }, { type: 'pdfTextStyle', attrs: { fontFamily: 'Georgia, serif', fontSizePt: 16, color: '#123456' } }] : [{ type: 'italic' }] }] })
function document() {
  return schema.nodeFromJSON({ type: 'doc', content: [1, 2].map(sourcePage => ({ type: 'pdfPage', attrs: { sourcePage, pageWidthPt: 500, pageHeightPt: 700, marginLeftPt: 50, marginRightPt: 50, marginTopPt: 30, marginBottomPt: 40 }, content: [{ type: 'pdfRegion', attrs: { pdfStyle: { width: 400 } }, content: [paragraph('Source', true), paragraph('Target')] }] })) })
}
function session(doc = document()) {
  let state = EditorState.create({ schema, doc, plugins: [history()] })
  const dispatch = tr => { state = state.apply(tr) }
  const select = (from, to = from) => dispatch(state.tr.setSelection(TextSelection.create(state.doc, from, to)))
  return { get state() { return state }, dispatch, select, run: command => command(state, dispatch) }
}
test('margins change only the active page, adapt content widths and undo atomically', () => {
  const s = session()
  s.select(4)
  assert.equal(currentPage(s.state).node.attrs.sourcePage, 1)
  const before = s.state.doc.toJSON()
  const margins = { marginLeftPt: 100, marginRightPt: 100, marginTopPt: 20, marginBottomPt: 30 }
  assert.ok(s.run(setPageMargins(margins, false)))
  assert.equal(s.state.doc.firstChild.firstChild.attrs.pdfStyle.width, 300)
  assert.equal(s.state.doc.child(1).attrs.marginLeftPt, 50)
  assert.ok(s.run(undo))
  assert.deepEqual(s.state.doc.toJSON(), before)
  assert.ok(s.run(setPageMargins(margins, true)))
  assert.equal(s.state.doc.child(1).attrs.marginLeftPt, 100)
  assert.equal(s.run(setPageMargins({ ...margins, marginLeftPt: 450 }, true)), false)
})
test('numbering is sequential, removable, serializable, with footer space', () => {
  const s = session()
  assert.ok(s.run(setPageNumbers(true, 7, 'right')))
  assert.equal(s.state.doc.firstChild.attrs.pageNumber, 7)
  assert.equal(s.state.doc.child(1).attrs.pageNumber, 8)
  const output = schema.nodes.pdfPage.spec.toDOM(s.state.doc.firstChild)
  assert.equal(output[1]['data-page-number'], '7')
  assert.ok(output[1].style.includes('--page-number-align:right'))
  assert.deepEqual(schema.nodeFromJSON(s.state.doc.toJSON()).toJSON(), s.state.doc.toJSON())
  assert.ok(s.run(setPageNumbers(false, 1, 'center')))
  assert.equal(s.state.doc.firstChild.attrs.pageNumber, null)
})
test('painter copies text formatting and alignment without copying layout; undo restores target', () => {
  const s = session()
  const paragraphs = []
  s.state.doc.descendants((node, pos) => { if (node.type.name === 'paragraph') paragraphs.push(pos) })
  s.select(paragraphs[0] + 1)
  const format = captureFormat(s.state)
  s.select(paragraphs[1] + 1, paragraphs[1] + 7)
  const before = s.state.doc.toJSON()
  assert.ok(s.run(paintFormat(format)))
  const target = s.state.doc.nodeAt(paragraphs[1])
  assert.equal(target.attrs.pdfStyle.textAlign, 'right')
  assert.ok(target.firstChild.marks.some(mark => mark.type.name === 'bold'))
  assert.ok(!target.firstChild.marks.some(mark => mark.type.name === 'italic'))
  assert.equal(target.firstChild.marks.find(mark => mark.type.name === 'pdfTextStyle').attrs.color, '#123456')
  assert.ok(s.run(undo))
  assert.deepEqual(s.state.doc.toJSON(), before)
  s.select(paragraphs[1] + 2)
  s.run(paintFormat(format))
  s.dispatch(s.state.tr.insertText('X'))
  assert.equal(s.state.doc.nodeAt(paragraphs[1]).child(1).marks.find(mark => mark.type.name === 'pdfTextStyle').attrs.fontSizePt, 16)
})
test('local image is a document node that can be resized, serialized, deleted and undone', () => {
  const s = session()
  s.select(4)
  const src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNn8AAAAASUVORK5CYII='
  const image = schema.nodes.localImage.create({ src, alt: 'test.png', widthPt: 120 })
  s.dispatch(s.state.tr.replaceSelectionWith(image))
  s.state.doc.check()
  let position
  s.state.doc.descendants((node, pos) => { if (node.type.name === 'localImage') position = pos })
  assert.notEqual(position, undefined)
  s.dispatch(s.state.tr.setNodeMarkup(position, undefined, { ...image.attrs, widthPt: 200 }))
  assert.equal(schema.nodeFromJSON(s.state.doc.toJSON()).nodeAt(position).attrs.src, src)
  s.dispatch(s.state.tr.setSelection(NodeSelection.create(s.state.doc, position)).deleteSelection())
  assert.ok(s.run(undo))
  s.state.doc.check()
})
