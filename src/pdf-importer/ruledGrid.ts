import type { JSONContent } from '@tiptap/react'
import type { ExtractedPage, PdfRun, PdfShape } from './extractPage.ts'
import type { RebuiltBlock } from './borderlessTables.ts'

type Rule = { start: number; end: number; at: number; color: string; width: number }
const unique=(values:number[])=>values.sort((a,b)=>a-b).filter((v,i,a)=>!i||v-a[i-1]>1)
/** Recover closed grid faces, including empty cells and real row/column
 * merges. Ordinary uniform tables and borderless ledgers keep their path. */
export function ruledGrid(page:ExtractedPage, paragraph:(runs:PdfRun[],style?:Record<string,unknown>)=>JSONContent){
  const empty={blocks:[] as RebuiltBlock[],used:new Set<number>(),shapes:new Set<PdfShape>(),rows:0,columns:0}
  const h:Rule[]=[],v:Rule[]=[]
  for(const s of page.shapes){
    const color=s.stroke||s.fill
    if(!color||color==='#ffffff'||s.rounded)continue
    const width=s.stroke?s.lineWidth:Math.min(s.width,s.height)
    if(s.stroke&&s.width>3&&s.height>3){
      h.push(...[s.y,s.y+s.height].map(at=>({at,start:s.x,end:s.x+s.width,color,width})))
      v.push(...[s.x,s.x+s.width].map(at=>({at,start:s.y,end:s.y+s.height,color,width})))
    }else if(s.height<=2&&s.width>5)h.push({at:s.y+s.height/2,start:s.x,end:s.x+s.width,color,width})
    else if(s.width<=2&&s.height>.1)v.push({at:s.x+s.width/2,start:s.y,end:s.y+s.height,color,width})
  }
  // PDF borders are frequently painted in short, touching fragments.
  for(const rules of [h,v]){
    rules.sort((a,b)=>a.at-b.at||a.start-b.start)
    for(let i=0;i<rules.length;i++)for(let j=i+1;j<rules.length;j++){
      const a=rules[i],b=rules[j]
      if(a.color===b.color && Math.abs(a.at-b.at)<1 && b.start<=a.end+1.5 && b.end>=a.start-1.5){a.start=Math.min(a.start,b.start);a.end=Math.max(a.end,b.end);rules.splice(j,1);j=i}
    }
  }
  const covers=(rules:Rule[],at:number,start:number,end:number)=>rules.find(r=>Math.abs(r.at-at)<1.1&&r.start<=start+1.1&&r.end>=end-1.1)
  const ys=unique(h.map(r=>r.at))
  type Cell={x:number;right:number;top:number;bottom:number;edges:(Rule|undefined)[]}
  const faces:Cell[]=[]
  for(let a=0;a<ys.length;a++)for(let b=a+1;b<ys.length;b++){
    const top=ys[a],bottom=ys[b]
    if(bottom-top<3)continue
    const xs=unique(v.filter(r=>r.start<=top+1.1&&r.end>=bottom-1.1).map(r=>r.at))
    for(let j=1;j<xs.length;j++){
      const x=xs[j-1],right=xs[j],upper=covers(h,top,x,right),lower=covers(h,bottom,x,right)
      if(!upper||!lower||right-x<4)continue
      if(h.some(rule=>rule.at>top+1.1&&rule.at<bottom-1.1&&rule.start<=x+1.1&&rule.end>=right-1.1))continue
      faces.push({x,right,top,bottom,edges:[upper,covers(v,right,top,bottom),lower,covers(v,x,top,bottom)]})
    }
  }
  // A face must not contain another closed face. Partial rules may belong to
  // a smaller form, rather than being an empty enclosing table cell.
  const cells=faces.filter(a=>!faces.some(b=>a!==b&&b.x>=a.x-1&&b.right<=a.right+1&&b.top>=a.top-1&&b.bottom<=a.bottom+1&&(b.right-b.x)*(b.bottom-b.top)<(a.right-a.x)*(a.bottom-a.top)-2))
  const groups:Cell[][]=[]
  const touches=(a:Cell,b:Cell)=>
    Math.max(a.x,b.x)<Math.min(a.right,b.right)-1&&(Math.abs(a.top-b.bottom)<1.6||Math.abs(a.bottom-b.top)<1.6)||
    Math.max(a.top,b.top)<Math.min(a.bottom,b.bottom)-1&&(Math.abs(a.x-b.right)<1.6||Math.abs(a.right-b.x)<1.6)
  for(const cell of cells){
    const adjacent=groups.filter(group=>group.some(other=>touches(cell,other)))
    if(!adjacent.length)groups.push([cell])
    else {adjacent[0].push(cell);for(const group of adjacent.slice(1)){adjacent[0].push(...group);groups.splice(groups.indexOf(group),1)}}
  }
  const hasComplexGrid=groups.some(group=>group.length>=6&&group.some(a=>group.some(b=>
    b.x>a.x+1&&b.x<a.right-1||b.top>a.top+1&&b.top<a.bottom-1)))
  for(const group of groups){
    if(group.length<(hasComplexGrid?1:6))continue
    const xs=unique(group.flatMap(c=>[c.x,c.right])), rows=unique(group.flatMap(c=>[c.top,c.bottom]))
    if(xs.length>40||rows.length<2)continue
    const edgeIndex=(values:number[],value:number)=>values.findIndex(v=>Math.abs(v-value)<1.1)
    const indexed=group.map(cell=>({...cell,col:edgeIndex(xs,cell.x),endCol:edgeIndex(xs,cell.right),row:edgeIndex(rows,cell.top),endRow:edgeIndex(rows,cell.bottom)}))
    if(indexed.some(c=>c.col<0||c.row<0||c.endCol<=c.col||c.endRow<=c.row))continue
    const merged=indexed.some(c=>c.endCol-c.col>1||c.endRow-c.row>1)
    // A closed cell containing several baselines is one table cell, not
    // several rows. Keep the old path for ordinary single-line tables.
    const multiline=group.some(cell=>{
      const baselines=page.runs.filter(r=>r.x>=cell.x-1&&r.x+r.width<=cell.right+1&&r.baseline>cell.top&&r.baseline<cell.bottom).map(r=>r.baseline)
      return baselines.length>1&&Math.max(...baselines)-Math.min(...baselines)>2
    })
    if(!merged&&!page.recoveredRules&&!page.encodedText&&!hasComplexGrid&&!multiline)continue
    const slots=Array.from({length:rows.length-1},()=>Array(xs.length-1).fill(null) as (typeof indexed[number]|null)[])
    let overlap=false
    for(const cell of indexed)for(let r=cell.row;r<cell.endRow;r++)for(let c=cell.col;c<cell.endCol;c++){
      if(slots[r][c])overlap=true
      slots[r][c]=cell
    }
    if(overlap)continue
    const used=new Set<number>()
    const content:JSONContent[]=rows.slice(0,-1).map((top,row)=>({type:'tableRow',attrs:{pdfStyle:{height:rows[row+1]-top}},content:xs.slice(0,-1).flatMap((x,col)=>{
      const cell=slots[row][col]
      if(cell&&(cell.row!==row||cell.col!==col))return []
      const right=cell?.right??xs[col+1],bottom=cell?.bottom??rows[row+1],span=cell?cell.endCol-col:1,rowspan=cell?cell.endRow-row:1
      const runs=cell?page.runs.filter(r=>!empty.used.has(r.source)&&!used.has(r.source)&&r.x>=x-1.5&&r.x+r.width<=right+2&&r.baseline>=top&&r.baseline<=bottom+1):[]
      runs.forEach(r=>used.add(r.source))
      const lines:PdfRun[][]=[]
      for(const r of runs.sort((a,b)=>a.baseline-b.baseline||a.x-b.x)){
        const line=lines.find(l=>Math.abs(l[0].baseline-r.baseline)<1.2)
        if(line)line.push(r);else lines.push([r])
      }
      const size=runs.length?Math.max(...runs.map(r=>r.size)):Math.min(5,(bottom-top)*.5)
      const fill=page.shapes.filter(s=>s.fill&&s.fill!=='#ffffff'&&s.x<=x+1&&s.x+s.width>=right-1&&s.y<=top+1&&s.y+s.height>=bottom-1).at(-1)?.fill
      const border=Object.fromEntries(['borderTop','borderRight','borderBottom','borderLeft'].map((side,i)=>[side,cell?.edges[i]?`${Math.max(.12,cell.edges[i]!.width)}pt solid ${cell.edges[i]!.color}`:'none']))
      let cursor=top
      const paragraphs=lines.map((line,i)=>{
        line.sort((a,b)=>a.x-b.x)
        const leftGap=Math.max(0,line[0].x-x),rightGap=Math.max(0,right-Math.max(...line.map(r=>r.x+r.width)))
        const align=rightGap<2&&leftGap>size?'right':Math.abs(leftGap-rightGap)<2&&leftGap>size?'center':'left'
        const y=Math.min(...line.map(r=>r.y)),next=lines[i+1]?Math.min(...lines[i+1].map(r=>r.y)):bottom
        const fontSize=Math.max(...line.map(r=>r.size)),lineHeight=Math.max(1,Math.min(fontSize,next-y))
        // Separate distant fields inside a merged cell without inventing text
        // spaces. Each field remains a flowing, editable paragraph.
        const fields:PdfRun[][]=[]
        for(const run of line){
          const previous=fields.at(-1)
          const end=previous?Math.max(...previous.map(r=>r.x+r.width)):0
          if(previous&&run.x-end<=Math.max(fontSize*1.5,4))previous.push(run)
          else fields.push([run])
        }
        if(fields.length>1){
          const node:JSONContent={type:'pdfRegion',attrs:{pdfStyle:{marginTop:Math.max(0,y-cursor),marginLeft:leftGap}},content:[{
            type:'pdfColumns',content:fields.map((field,index)=>({type:'pdfColumn',attrs:{pdfStyle:{
              flexGrow:index===fields.length-1?1:0,flexBasis:index===fields.length-1?0:fields[index+1][0].x-field[0].x,
            }},content:[paragraph(field,{fontSize,fontFamily:field[0].family,lineHeight,marginTop:0,marginLeft:0,textAlign:'left'})]})),
          }]}
          cursor=y+lineHeight;return node
        }
        const p=paragraph(line,{fontSize,fontFamily:line[0].family,lineHeight,marginTop:Math.max(0,y-cursor),marginLeft:align==='left'?leftGap:0,textAlign:align})
        cursor=y+lineHeight;return p
      })
      return [{type:'tableCell',attrs:{colspan:span,rowspan,colwidth:xs.slice(col,col+span).map((value,i)=>(xs[col+i+1]-value)*4/3),pdfStyle:{...border,backgroundColor:fill||'transparent',height:bottom-top,paddingLeft:0,paddingRight:0,paddingTop:0,paddingBottom:0,fontSize:size,minWidth:0},pdfSource:{inferred:true,itemIndexes:runs.map(r=>r.source)}},content:paragraphs.length?paragraphs:[paragraph([],{fontSize:size,lineHeight:size})]}]
    })}))
    used.forEach(id=>empty.used.add(id))
    const top=rows[0],bottom=rows.at(-1)!,left=xs[0],right=xs.at(-1)!
    page.shapes.filter(s=>s.x>=left-2&&s.x+s.width<=right+2&&s.y>=top-2&&s.y+s.height<=bottom+2).forEach(s=>empty.shapes.add(s))
    empty.blocks.push({x:left,y:top,width:right-left+2,height:bottom-top,node:{type:'table',attrs:{pdfSource:{confidence:'ruled-grid',inferred:true},pdfStyle:{width:right-left}},content}})
    empty.rows+=rows.length-1;empty.columns=Math.max(empty.columns,xs.length-1)
  }
  return empty
}
