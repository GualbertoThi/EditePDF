import type { JSONContent } from '@tiptap/react'
import type { ExtractedPage, PdfRun } from './extractPage.ts'
import type { RebuiltBlock } from './borderlessTables.ts'

/** Fixed-pitch printouts encode column gaps as spaces and borders as text.
 * Preserve those characters instead of guessing unrelated table cells. */
export function printerReport(page:ExtractedPage, paragraph:(runs:PdfRun[],style?:Record<string,unknown>)=>JSONContent){
  const runs=page.runs.filter(r=>/courier|monospace/i.test(r.family)&&!r.rotation)
  if(runs.filter(r=>/[-=+]{15,}/.test(r.text)).length<3)return null
  const lines:PdfRun[][]=[]
  for(const run of [...runs].sort((a,b)=>a.baseline-b.baseline||a.x-b.x)){
    const last=lines.at(-1)
    if(last&&Math.abs(last[0].baseline-run.baseline)<1)last.push(run);else lines.push([run])
  }
  const blocks:RebuiltBlock[]=lines.map((line,i)=>{
    line.sort((a,b)=>a.x-b.x)
    const size=Math.max(...line.map(r=>r.size)),y=Math.min(...line.map(r=>r.y))
    const height=Math.min(size*1.2,(lines[i+1]?.[0].y ?? y+size*1.2)-y)
    const node=paragraph(line,{fontSize:size,fontFamily:line[0].family,lineHeight:height})
    for(let j=1;j<(node.content?.length || 0);j++){
      const previous=line[j-1],run=line[j],gap=run.x-previous.x-previous.width
      const advance=run.size*.6,spaces=Math.max(0,Math.round(gap/advance))
      node.content![j].text=' '.repeat(spaces)+run.text
    }
    return {x:line[0].x,y,width:Math.max(...line.map(r=>r.x+r.width))-line[0].x+2,height,flexibleText:true,node}
  })
  return {blocks,used:new Set(runs.map(r=>r.source))}
}
