import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getSchema } from '@tiptap/react'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { history, undo } from '@tiptap/pm/history'
import { TableMap } from '@tiptap/pm/tables'
import { documentExtensions } from '../src/document-model/schema.ts'
import { addStyledRow, moveTable, TableBehavior } from '../src/editor/tableBehavior.ts'
const schema=getSchema(documentExtensions())
const p=text=>schema.nodes.paragraph.create(null,text?schema.text(text):null)
const row=(color,text)=>schema.nodes.tableRow.create({pdfStyle:{height:18}},[0,1].map(()=>schema.nodes.tableCell.create({colwidth:[90],pdfStyle:{backgroundColor:color,borderBottom:'1pt solid #000000'}},schema.nodes.paragraph.create({pdfStyle:{textAlign:'right'}},schema.text(text,[schema.marks.bold.create(),schema.marks.pdfTextStyle.create({fontSizePt:14,color:'#123456'})])))))
const table=()=>schema.nodes.table.create(null,[row('#ffffff','A'),row('#eeeeee','B'),row('#ffffff','C')])
function setup(content, cellIndex=0){
 let state=EditorState.create({schema,doc:schema.nodes.doc.create(null,schema.nodes.pdfPage.create(null,content)),plugins:[history(),...TableBehavior.config.addProseMirrorPlugins()]})
 const positions=[];state.doc.descendants((node,pos)=>{if(node.type.name==='tableCell')positions.push(pos+2)})
 state=state.apply(state.tr.setSelection(TextSelection.create(state.doc,positions[cellIndex])))
 return {get state(){return state},run:command=>command(state,tr=>{state=state.apply(tr)}),select(pos){state=state.apply(state.tr.setSelection(TextSelection.create(state.doc,pos)))}}
}
test('new rows are empty, continue stripes, preserve cell and text style, undo atomically',()=>{
 const s=setup([table()],5), before=s.state.doc
 assert.ok(s.run(addStyledRow(true)))
 const t=s.state.doc.firstChild.firstChild; t.check()
 assert.equal(t.childCount,4);assert.equal(t.lastChild.textContent,'')
 assert.equal(t.lastChild.firstChild.attrs.pdfStyle.backgroundColor,'#eeeeee')
 assert.deepEqual(t.lastChild.firstChild.attrs.colwidth,[90])
 assert.equal(t.lastChild.firstChild.firstChild.attrs.pdfStyle.textAlign,'right')
 assert.equal(t.lastChild.firstChild.firstChild.attrs.emptyTextMarks[1].attrs.fontSizePt,14)
 assert.equal(TableMap.get(t).problems,null)
 assert.ok(s.run(undo)); assert.ok(s.state.doc.eq(before))
})
test('insert above copies formatting without content',()=>{
 const s=setup([table()]);assert.ok(s.run(addStyledRow(false)))
 const first=s.state.doc.firstChild.firstChild.firstChild
 assert.equal(first.textContent,''); assert.equal(first.attrs.pdfStyle.height,18)
 assert.equal(first.firstChild.attrs.pdfStyle.borderBottom,'1pt solid #000000')
})
test('Tab navigates first, then adds an empty styled row and typing inherits marks',()=>{
 const s=setup([table()],4)
 const shortcuts=TableBehavior.config.addKeyboardShortcuts.call({editor:{view:{get state(){return s.state},dispatch(tr){s.run((_state,dispatch)=>{dispatch(tr);return true})}}}})
 assert.ok(shortcuts.Tab());assert.equal(s.state.doc.firstChild.firstChild.childCount,3)
 assert.ok(shortcuts.Tab());assert.equal(s.state.doc.firstChild.firstChild.childCount,4)
 assert.equal(s.state.doc.firstChild.firstChild.lastChild.textContent,'')
 s.run((state,dispatch)=>{dispatch(state.tr.insertText('Novo'));return true})
 const text=s.state.doc.firstChild.firstChild.lastChild.firstChild.firstChild.firstChild
 assert.equal(text.text,'Novo');assert.ok(text.marks.some(m=>m.type.name==='bold'))
 assert.equal(text.marks.find(m=>m.type.name==='pdfTextStyle').attrs.color,'#123456')
})
test('row insertion keeps merged cell geometry valid',()=>{
 const cell=(text,attrs={})=>schema.nodes.tableCell.create(attrs,p(text))
 const merged=schema.nodes.table.create(null,[schema.nodes.tableRow.create(null,[cell('A',{rowspan:2}),cell('B')]),schema.nodes.tableRow.create(null,[cell('C')])])
 const s=setup([merged],1);assert.ok(s.run(addStyledRow(true)))
 const result=s.state.doc.firstChild.firstChild
 assert.equal(TableMap.get(result).problems,null)
 assert.equal(result.firstChild.firstChild.attrs.rowspan,3)
 assert.equal(result.child(1).textContent,'')
})
test('table exits footer region, moves between blocks and undoes without losing content',()=>{
 const original=table()
 const footer=schema.nodes.pdfRegion.create({pdfStyle:{marginTop:150}},[p('Rodapé'),original])
 const s=setup([p('Antes'),footer]),before=s.state.doc
 assert.ok(s.run(moveTable(-1)))
 let page=s.state.doc.firstChild
 assert.ok(page.child(1).eq(original));assert.equal(page.child(2).textContent,'Rodapé')
 assert.equal(page.child(2).attrs.pdfStyle.marginTop,150)
 assert.ok(s.run(moveTable(-1)));page=s.state.doc.firstChild
 assert.ok(page.firstChild.eq(original));assert.equal(s.run(moveTable(-1)),false)
 assert.ok(s.run(moveTable(1)));assert.ok(s.state.doc.firstChild.child(1).eq(original))
 assert.ok(s.run(undo));assert.ok(s.state.doc.eq(before))
})
