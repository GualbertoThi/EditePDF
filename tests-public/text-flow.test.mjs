import {test} from 'node:test'
import assert from 'node:assert/strict'
import {layoutBlocks} from '../src/pdf-importer/flowLayout.ts'
import {reconstructPage} from '../src/pdf-importer/reconstructPage.ts'
const block=(x,y,width,flexibleText=true)=>({x,y,width,height:12,flexibleText,node:{type:'paragraph',content:[{type:'text',text:'Teste'}]}})
test('free paragraphs keep their indent but use the available containing width',()=>{
 const result=layoutBlocks([block(80,20,100)],40,0)
 assert.equal(result[0].attrs.pdfStyle.marginLeft,40)
 assert.equal(result[0].attrs.pdfStyle.marginTop,20)
 assert.equal(result[0].attrs.pdfStyle.width,undefined)
})
test('tables and frames retain their bounds; text columns keep starts and use spare width',()=>{
 assert.equal(layoutBlocks([block(80,20,100,false)],40,0)[0].attrs.pdfStyle.width,100)
 const columns=layoutBlocks([block(40,20,60),block(180,20,100)],40,0)[0]
 assert.equal(columns.attrs.pdfStyle.width,undefined)
 assert.equal(columns.content[0].type,'pdfColumns')
 assert.equal(columns.content[0].content.length,2)
 assert.equal(columns.content[0].content[0].content[0].attrs.pdfStyle.width,undefined)
 assert.deepEqual(columns.content[0].content.map(c=>c.attrs.pdfStyle),[{flexGrow:0,flexBasis:100},{flexGrow:1,flexBasis:0}])
 const framed=layoutBlocks([block(40,20,60,false),block(180,20,100,false)],40,0)[0]
 assert.equal(framed.attrs.pdfStyle.width,240)
 assert.deepEqual(framed.content[0].content.map(c=>c.attrs.pdfStyle),[{flexGrow:100,flexBasis:0},{flexGrow:140,flexBasis:0}])
})
test('imported free text preserves every character and does not lock its glyph width',()=>{
 const result=reconstructPage({width:600,height:800,shapes:[],warnings:[],images:[],runs:[{text:'Banco: 001 BRASIL',x:40,y:70,width:110,height:12,baseline:80,size:12,family:'Arial',color:'#000000',bold:false,italic:false,source:0},{text:'Outra linha maior para estabelecer a margem do documento',x:40,y:130,width:500,height:12,baseline:140,size:12,family:'Arial',color:'#000000',bold:false,italic:false,source:1}]})
 assert.equal(result.content.content[0].attrs.pdfStyle.width,undefined)
 assert.ok(JSON.stringify(result.content).includes('Banco: 001 BRASIL'))
 assert.equal(result.content.attrs.marginLeftPt,40)
 assert.equal(result.content.attrs.marginRightPt,58)
})
