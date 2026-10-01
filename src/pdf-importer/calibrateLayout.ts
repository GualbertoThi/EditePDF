import { getSchema, type JSONContent } from '@tiptap/react'
import { DOMSerializer } from '@tiptap/pm/model'
import { documentExtensions } from '../document-model/schema.ts'

/** One-time import calibration, before publishing the model to the editor.
 * Browser font metrics/border rounding must not accumulate between sections.
 * Only positive blank gaps are adjusted; never clip, shrink text or overlap
 * content. Subsequent user edits follow ordinary document flow. */
export async function calibrateBrowserLayout(model: JSONContent) {
  const pages=(model.content || []).filter(p=>p.type==='pdfPage')
  const anchors=(node:JSONContent):JSONContent[]=>[
    ...(Number.isFinite(node.attrs?.pdfSource?.importTop)?[node]:[]),
    ...node.content?.flatMap(anchors)||[],
  ]
  if(!pages.some(p=>anchors(p).length))return
  const schema=getSchema(documentExtensions())
  const host=document.createElement('div')
  host.className='document-stack'
  host.style.cssText='position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none'
  const root=document.createElement('div');root.className='tiptap'
  root.style.whiteSpace='break-spaces'
  host.append(root);document.body.append(host)
  try{
    for(const page of pages){
      const nodes=anchors(page)
      if(!nodes.length)continue
      root.replaceChildren(DOMSerializer.fromSchema(schema).serializeNode(schema.nodeFromJSON(page)))
      root.querySelectorAll('p').forEach(p=>{if(!p.childNodes.length)p.append(document.createElement('br'))})
      await Promise.all([...root.querySelectorAll('img')].map(i=>i.decode().catch(()=>{})))
      void root.offsetHeight;await document.fonts.ready
      const sheet=root.firstElementChild as HTMLElement
      const elements=[...sheet.querySelectorAll<HTMLElement>('[data-import-top]')]
      elements.forEach((element,i)=>{
        const node=nodes[i]
        if(!node)return
        const expected=Number(node.attrs!.pdfSource.importTop)
        const current=(element.getBoundingClientRect().top-sheet.getBoundingClientRect().top)*.75
        const before=Number(node.attrs!.pdfStyle.marginTop)||0
        const margin=Math.abs(expected-current)>1 ? Math.max(0,before+expected-current) : before
        node.attrs!.pdfStyle.marginTop=margin
        element.style.marginTop=`${margin}pt`
        // Remove temporary import geometry; it must never reposition edits.
        delete node.attrs!.pdfSource.importTop
      })
    }
  }finally{host.remove()}
}
