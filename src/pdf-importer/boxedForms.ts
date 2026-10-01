import type { JSONContent } from '@tiptap/react'
import type { Box, ExtractedPage, PdfRun, PdfShape } from './extractPage.ts'
import type { RebuiltBlock } from './borderlessTables.ts'

type CellBox = Box & { borders: Record<string, string>; borderWidths: number[] }
const right = (b: Box) => b.x + b.width
const bottom = (b: Box) => b.y + b.height
const near = (a: number, b: number, tolerance = 0.8) => Math.abs(a - b) < tolerance
const contains = (a: Box, b: Box) => b.x >= a.x - 0.1 && b.y >= a.y - 0.1 && right(b) <= right(a) + 0.1 && bottom(b) <= bottom(a) + 0.1
const median = (values: number[]) => [...values].sort((a,b) => a-b)[Math.floor(values.length/2)] || 0
const sides = ['borderTop', 'borderRight', 'borderBottom', 'borderLeft']

/** Repeated, closed form fields. This path deliberately requires many nested
 * outlined rectangles; ordinary ledger/table heuristics remain unchanged. */
export function boxedForms(page: ExtractedPage, paragraph: (runs: PdfRun[], style?: Record<string, unknown>) => JSONContent) {
  const empty = { blocks: [] as RebuiltBlock[], used: new Set<number>(), shapes: new Set<PdfShape>(), rows: 0, columns: 0 }
  const outlines = page.shapes.filter(s => s.stroke && !s.rounded && s.width > 5 && s.height > 4)
  const leaves = outlines.filter(s => !outlines.some(other => other !== s && contains(s, other) && other.width * other.height < s.width * s.height - 1))
  if (leaves.length < 20 || outlines.length - leaves.length < 10) return empty
  const cells: CellBox[] = leaves.map(s => {
    const w = s.lineWidth
    const parent = outlines.filter(p => p !== s && contains(p,s) && p.width*p.height > s.width*s.height+1)
      .sort((a,b) => a.width*a.height-b.width*b.height)[0]
    const extra = parent ? [s.y-parent.y, right(parent)-right(s), bottom(parent)-bottom(s), s.x-parent.x].map(d => d > 0 && d <= 1 ? d : 0) : [0,0,0,0]
    const widths = extra.map(d => w+d)
    return { x: s.x-w/2-extra[3], y: s.y-w/2-extra[0], width: s.width+w+extra[1]+extra[3], height: s.height+w+extra[0]+extra[2],
      borders: Object.fromEntries(sides.map((side,i) => [side, `${widths[i]}pt solid ${s.stroke}`])), borderWidths: widths }
  })
  // Some HTML-to-PDF generators paint the four sides as thin filled rectangles.
  for (const box of page.shapes.filter(s => s.fill === '#ffffff' && s.width > 5 && s.height > 4)) {
    const h = page.shapes.filter(s => s.fill && s.fill !== '#ffffff' && s.height <= 2 && near(s.x,box.x,0.1) && near(s.width,box.width,0.1))
    const v = page.shapes.filter(s => s.fill && s.fill !== '#ffffff' && s.width <= 2 && near(s.y,box.y,0.1) && near(s.height,box.height,0.1))
    const edges = [h.find(s => near(s.y,box.y,0.1)),v.find(s => near(right(s),right(box),0.1)),h.find(s => near(bottom(s),bottom(box),0.1)),v.find(s => near(s.x,box.x,0.1))]
    if (edges.some(e => !e)) continue
    const widths = edges.map((s,i) => i%2 ? s!.width : s!.height)
    cells.push({ ...box, borderWidths: widths, borders: Object.fromEntries(edges.map((s,i) => [sides[i],`${widths[i]}pt solid ${s!.fill}`])) })
  }
  const horizontal = page.shapes.filter(s => s.fill && s.fill !== '#ffffff' && s.height <= 2 && s.width > 5)
  const vertical = page.shapes.filter(s => s.fill && s.fill !== '#ffffff' && s.width <= 2 && s.height > 4)
  for (const top of horizontal) {
    const left = vertical.find(s => near(s.x,top.x,0.1) && near(s.y,top.y,0.1))
    if (!left) continue
    const r = vertical.find(s => near(right(s),right(top),0.1) && near(s.y,top.y,0.1) && near(s.height,left.height,0.1))
    const b = horizontal.find(s => near(s.x,top.x,0.1) && near(s.width,top.width,0.1) && near(bottom(s),bottom(left),0.1))
    if (!r || !b || cells.some(c => near(c.x,top.x,0.1) && near(c.y,top.y,0.1) && near(c.width,top.width,0.1) && near(c.height,left.height,0.1))) continue
    const edges = [top,r,b,left], widths = [top.height,r.width,b.height,left.width]
    cells.push({x:top.x,y:top.y,width:top.width,height:left.height,borderWidths:widths,borders:Object.fromEntries(edges.map((s,i)=>[sides[i],`${widths[i]}pt solid ${s.fill}`]))})
  }
  // Drop surrounding grid frames, keeping all actual cells, including blanks.
  const inners = cells.filter(c => !cells.some(other => other !== c && contains(c,other) && other.width*other.height < c.width*c.height-1))
  const bands: CellBox[][] = []
  for (const cell of inners.sort((a,b) => a.y-b.y || a.x-b.x)) {
    const band = bands.find(b => near(b[0].y,cell.y,1) && near(bottom(b[0]),bottom(cell),1))
    if (band) band.push(cell); else bands.push([cell])
  }
  bands.forEach(b => b.sort((a,b) => a.x-b.x))
  // A valid band must have nonoverlapping cells and a consistent intercell gap.
  const valid = bands.filter(b => b.every((c,i) => !i || c.x >= right(b[i-1])-0.1) && b.slice(1).every((c,i) => near(c.x-right(b[i]), b[1].x-right(b[0]),1)))
  const groups: CellBox[][][] = []
  for (const band of valid) {
    const previous = [...groups].reverse().find(g => {
      const last = g.at(-1)!
      return band.length === last.length && band.every((c,i) => near(c.x,last[i].x) && near(c.width,last[i].width)) && band[0].y-bottom(last[0]) >= -0.1 && band[0].y-bottom(last[0]) < 3
    })
    if (previous) previous.push(band)
    else groups.push([band])
  }
  const used = new Set<number>(), shapes = new Set<PdfShape>(), blocks: RebuiltBlock[] = []
  let rows = 0, columns = 0
  for (const group of groups) {
    const first = group[0], x = first[0].x, y = Math.min(...first.map(c => c.y))
    const clean = (n: number) => Math.max(0,Math.round(n*1000000)/1000000)
    const gapX = clean(first.length > 1 ? median(first.slice(1).map((c,i) => c.x-right(first[i]))) : 0)
    const gapY = clean(group.length > 1 ? median(group.slice(1).map((b,i) => b[0].y-bottom(group[i][0]))) : 0)
    const width = right(first.at(-1)!)-x, height = Math.max(...group.at(-1)!.map(bottom))-y
    const items = group.map(b => b.map(c => page.runs.filter(r => !used.has(r.source) && contains(c,r))))
    if (!items.flat(2).length) continue
    const sample = items.flat(2)[0]
    const table: JSONContent = { type:'table',attrs:{pdfSource:{page:1,inferred:true,confidence:'boxed-form'},pdfStyle:{borderCollapse:'separate',borderSpacing:`${gapX}pt ${gapY}pt`}},content:group.map((band,row) => ({type:'tableRow',attrs:{pdfStyle:{height:Math.max(...band.map(c => c.height))}},content:band.map((c,col) => {
      const runs = items[row][col].sort((a,b) => a.baseline-b.baseline || a.x-b.x)
      const lines: PdfRun[][] = []
      for (const run of runs) {
        const last = lines.at(-1)
        if (last && Math.abs(last[0].baseline-run.baseline) < run.size*0.3) last.push(run); else lines.push([run])
      }
      const size = Math.max(...runs.map(r => r.size), sample.size)
      const l = runs.length ? Math.min(...runs.map(r => r.x))-c.x : 1.5
      const r = runs.length ? right(c)-Math.max(...runs.map(right)) : 1.5
      const align = Math.abs(l-r)<2 ? 'center' : l>r ? 'right' : 'left'
      const inset = align === 'center' ? 0 : Math.max(0,Math.min(l,r)-c.borderWidths[align==='right'?1:3])
      const lineHeight = runs.length ? Math.max(...runs.map(r => r.height)) : size
      const top = runs.length ? Math.max(0,Math.min(...runs.map(r => r.y))-c.y-c.borderWidths[0]) : 0
      const content = lines.map(line => paragraph(line,{textAlign:align,lineHeight,fontSize:size}))
      if (!content.length) content.push(paragraph([], {textAlign:'center',lineHeight:size,fontSize:size}))
      // A blank field must type in the same face and size as populated fields.
      content.forEach(p => { p.attrs = {...p.attrs,emptyTextMarks:[{type:'pdfTextStyle',attrs:{fontSizePt:size,fontFamily:sample.family,color:sample.color}}]} })
      runs.forEach(r => used.add(r.source))
      return {type:'tableCell',attrs:{colwidth:[c.width*4/3],pdfSource:{page:1,itemIndexes:runs.map(r => r.source),inferred:true},pdfStyle:{...c.borders,backgroundColor:'#ffffff',paddingLeft:inset,paddingRight:inset,paddingTop:top,paddingBottom:0}},content}
    })}))}
    // border-spacing also occurs at the outside of an HTML table. Counter it
    // with a local inset, leaving the source cell edges in document coordinates.
    const surround = cells.filter(c => contains(c,{x,y,width,height}) && c.width > width+1 && c.height > height+1 && c.width-width < 8 && c.height-height < 8)
      .sort((a,b) => a.width*a.height-b.width*b.height)[0]
    if (surround) {
      Object.assign(table.attrs!.pdfStyle,surround.borders)
      blocks.push({...surround,node:table})
    } else blocks.push({x:x-gapX,y:y-gapY,width:width+gapX*2,height:height+gapY*2,node:table})
    for (const shape of page.shapes) if (contains({x:x-2,y:y-2,width:width+4,height:height+4},shape)) shapes.add(shape)
    rows += group.length; columns = Math.max(columns,first.length)
  }
  if (blocks.length < 5 || used.size < page.runs.length*0.6) return empty
  return { blocks, used, shapes, rows, columns }
}
