import type { JSONContent } from '@tiptap/react'
import type { Box, ExtractedPage, PdfRun, PdfShape } from './extractPage.ts'
import { borderlessTables } from './borderlessTables.ts'
import { layoutBlocks } from './flowLayout.ts'
import { boxedForms } from './boxedForms.ts'
import { ruledGrid } from './ruledGrid.ts'
import { printerReport } from './printerReport.ts'

type Line = { runs: PdfRun[]; baseline: number }
type Block = Box & { node: JSONContent; flexibleText?: boolean }
type TableRegion = { edges: number[]; lines: Line[]; top: number; confidence: 'graphics' | 'alignment' }
export type ImportSummary = { rows: number; columns: number; tables: number; notice: string }
const end = (box: Box) => box.x + box.width
const bottom = (box: Box) => box.y + box.height
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] || 0
const near = (a: number, b: number, tolerance = 1.5) => Math.abs(a - b) <= tolerance
const inside = (a: Box, b: Box) => a.x >= b.x - 1 && end(a) <= end(b) + 1 && a.y >= b.y - 2 && bottom(a) <= bottom(b) + 2
function bounds(runs: Box[]): Box {
  const x = Math.min(...runs.map(r => r.x)), y = Math.min(...runs.map(r => r.y))
  return { x, y, width: Math.max(...runs.map(end)) - x, height: Math.max(...runs.map(bottom)) - y }
}
function linesOf(runs: PdfRun[]): Line[] {
  const lines: Line[] = []
  for (const run of [...runs].sort((a, b) => a.baseline - b.baseline || a.x - b.x)) {
    const line = lines.find(l => Math.abs(l.baseline - run.baseline) < Math.max(1.5, run.size * 0.22))
    if (line) { line.runs.push(run); line.baseline = median(line.runs.map(r => r.baseline)) }
    else lines.push({ runs: [run], baseline: run.baseline })
  }
  lines.forEach(l => l.runs.sort((a, b) => a.x - b.x))
  return lines.sort((a, b) => a.baseline - b.baseline)
}
function source(runs: PdfRun[]) { return { page: 1, itemIndexes: runs.map(r => r.source), inferred: true,
  ...(runs.some(r => r.recognition) ? { recognition: runs.filter(r => r.recognition).map(r => ({ itemIndex: r.source, ...r.recognition })) } : {}) } }
function paragraph(runs: PdfRun[], style: Record<string, unknown> = {}): JSONContent {
  const size = Math.max(...runs.map(r => r.size), 9)
  return { type: 'paragraph', attrs: { pdfSource: source(runs), pdfStyle: { lineHeight: size * 1.18, ...style } },
    content: runs.filter(run => run.text).map((run, index, visible) => ({ type: 'text', text: (index && (run.baseline - visible[index - 1].baseline > run.size * 0.4 || run.x - end(visible[index - 1]) > run.size * 0.12) ? ' ' : '') + run.text,
      marks: [{ type: 'pdfTextStyle', attrs: { fontSizePt: run.size, fontFamily: run.family, color: run.color, sourceWidthPt: run.width } },
        ...(run.bold ? [{ type: 'bold' }] : []), ...(run.italic ? [{ type: 'italic' }] : [])] })) }
}

function detectTables(page: ExtractedPage, lines: Line[]): TableRegion[] {
  // Adjacent filled cell rectangles constitute stronger evidence than text counts.
  const bands: PdfShape[][] = []
  for (const shape of page.shapes.filter(s => s.fill && s.fill !== '#ffffff' && s.width > 10 && s.height > 4 && s.width < page.width * 0.9)) {
    const band = bands.find(b => near(b[0].y, shape.y) && near(b[0].height, shape.height))
    if (band) band.push(shape)
    else bands.push([shape])
  }
  const seeds: { edges: number[]; top: number; last: number }[] = []
  for (const band of bands) {
    band.sort((a, b) => a.x - b.x)
    if (band.length < 2 || band.some((s, i) => i > 0 && !near(s.x, end(band[i - 1])))) continue
    const edges = [...band.map(s => s.x), end(band[band.length - 1])]
    const seed = seeds.find(s => s.edges.length === edges.length && s.edges.every((x, i) => near(x, edges[i])))
    if (seed) { seed.top = Math.min(seed.top, band[0].y); seed.last = Math.max(seed.last, bottom(band[0])) }
    else seeds.push({ edges, top: band[0].y, last: bottom(band[0]) })
  }
  // Ruled tables, including unfilled and empty cells.
  const vertical = page.shapes.filter(s => s.width < 2 && s.height > 20)
  const groups: PdfShape[][] = []
  for (const line of vertical) {
    const group = groups.find(g => near(g[0].y, line.y, 3) && near(bottom(g[0]), bottom(line), 3))
    if (group) group.push(line); else groups.push([line])
  }
  for (const group of groups) {
    const edges = [...new Set(group.map(s => Math.round(s.x * 10) / 10))].sort((a, b) => a - b)
    if (edges.length >= 3) seeds.push({ edges, top: group[0].y, last: bottom(group[0]) })
  }
  const tables: TableRegion[] = []
  const used = new Set<Line>()
  for (const seed of seeds.sort((a, b) => a.top - b.top)) {
    const candidates = lines.filter(l => !used.has(l) && l.baseline >= seed.top && l.baseline <= seed.last + median(l.runs.map(r => r.size)) * 2.5
      && l.runs.every(r => r.x >= seed.edges[0] - 1 && end(r) <= seed.edges[seed.edges.length - 1] + 1))
    const selected: Line[] = []
    for (const line of candidates) {
      if (selected.length && line.baseline - selected[selected.length - 1].baseline > Math.max(...line.runs.map(r => r.size)) * 3.2) break
      // Never force a run crossing a detected boundary into one cell.
      if (line.runs.some(r => seed.edges.slice(1, -1).some(x => r.x < x - 1 && end(r) > x + 1))) break
      selected.push(line)
    }
    if (selected.length >= 2) {
      selected.forEach(l => used.add(l))
      tables.push({ edges: seed.edges, lines: selected, top: seed.top, confidence: 'graphics' })
    }
  }
  return tables
}

function tableBlock(region: TableRegion, page: ExtractedPage): Block {
  const { edges, lines } = region
  const size = median(lines.flatMap(l => l.runs.map(r => r.size)))
  const backgrounds = page.shapes.filter(s => s.fill && s.height > 3 && s.x >= edges[0] - 1 && end(s) <= edges[edges.length - 1] + 1)
  const baselineOffsets = lines.flatMap(l => backgrounds.filter(s => l.baseline > s.y && l.baseline < bottom(s)).map(s => l.baseline - s.y))
  const offset = median(baselineOffsets) || size * 1.2
  const tops = lines.map((l, i) => i ? l.baseline - offset : region.top)
  const normalHeight = median(tops.slice(1).map((y, i) => y - tops[i])) || size * 1.6
  const horizontal = page.shapes.filter(s => s.height <= 2 && s.width > 3)
  const vertical = page.shapes.filter(s => s.width <= 2 && s.height > 3)
  const header = lines[0].runs.filter(r => r.bold).length > lines[0].runs.length / 2
    && lines.slice(1).some(l => l.runs.some(r => !r.bold))
  const alignments = edges.slice(0, -1).map((x, c) => {
    const samples = lines.slice(1).map(l => l.runs.filter(r => r.x >= x - 1 && end(r) <= edges[c + 1] + 1)).filter(r => r.length)
    const left = median(samples.map(r => bounds(r).x - x)), right = median(samples.map(r => edges[c + 1] - end(bounds(r))))
    return right + 2 < left ? 'right' : Math.abs(left - right) < 2 && left > size * 0.7 ? 'center' : 'left'
  })
  return { x: edges[0], y: tops[0], width: edges[edges.length - 1] - edges[0], height: tops[tops.length - 1] + normalHeight - tops[0],
    node: { type: 'table', attrs: { pdfSource: { page: 1, inferred: true, confidence: region.confidence } },
      content: lines.map((line, row) => ({ type: 'tableRow', attrs: { pdfStyle: { height: (tops[row + 1] ?? tops[row] + normalHeight) - tops[row] } },
        content: edges.slice(0, -1).map((x, column) => {
          const right = edges[column + 1], y = tops[row], height = (tops[row + 1] ?? y + normalHeight) - y
          const runs = line.runs.filter(r => r.x >= x - 1 && end(r) <= right + 1)
          const fill = backgrounds.filter(s => s.x <= x + 1 && end(s) >= right - 1 && line.baseline >= s.y && line.baseline <= bottom(s)).at(-1)?.fill
          const rule = (shapes: PdfShape[], coordinate: number, axis: 'x' | 'y') => shapes.find(s => near(s[axis], coordinate, 1.8)
            && (axis === 'y' ? s.x <= x + 1 && end(s) >= right - 1 : s.y <= y + 1 && bottom(s) >= y + height - 1))
          const border = (shape?: PdfShape) => shape ? `${Math.max(0.3, Math.min(shape.width, shape.height) || shape.lineWidth)}pt solid ${shape.fill || shape.stroke}` : 'none'
          const padding = Math.max(1, Math.min(6, runs.length ? Math.min(bounds(runs).x - x, right - end(bounds(runs))) : 4))
          return { type: row === 0 && header ? 'tableHeader' : 'tableCell',
            attrs: { colspan: 1, rowspan: 1, colwidth: [Math.round((right - x) * 96 / 72 * 100) / 100], pdfSource: source(runs),
              pdfStyle: { backgroundColor: fill || 'transparent', paddingLeft: padding, paddingRight: padding,
                paddingTop: Math.max(0, (height - size * 1.2) / 2), paddingBottom: Math.max(0, (height - size * 1.2) / 2),
                borderTop: border(rule(horizontal, y, 'y')), borderBottom: border(rule(horizontal, y + height, 'y')),
                borderLeft: border(rule(vertical, x, 'x')), borderRight: border(rule(vertical, right, 'x')) } },
            content: [paragraph(runs, { textAlign: row === 0 && header ? 'left' : alignments[column], lineHeight: size * 1.2 })] }
        }) })) } }
}

// Flowing regions and columns, never absolute text overlays.
function textRegion(runs: PdfRun[], frame: Box, shapes: PdfShape[], background?: PdfShape, flexible = false): JSONContent {
  const lines = linesOf(runs)
  // Find gutters across the whole region, including columns whose baselines differ.
  const intervals: { left: number; right: number }[] = []
  for (const run of [...runs].sort((a, b) => a.x - b.x)) {
    const previous = intervals.at(-1)
    if (previous && run.x <= previous.right) previous.right = Math.max(previous.right, end(run))
    else intervals.push({ left: run.x, right: end(run) })
  }
  const candidateGaps = intervals.slice(1).map((interval, i) => ({ left: intervals[i].right, right: interval.left }))
    .filter(g => g.right - g.left > 30)
  const gap = candidateGaps.sort((a, b) => (b.right - b.left) - (a.right - a.left))
    .find(g => runs.every(r => end(r) <= g.left + 1 || r.x >= g.right - 1))
  let content: JSONContent[]
  if (gap) {
    const split = (gap.left + gap.right) / 2
    const left = runs.filter(r => r.x < split), right = runs.filter(r => r.x >= split)
    const leftFrame = { x: frame.x, y: frame.y, width: split - frame.x, height: frame.height }
    const rightFrame = { x: split, y: frame.y, width: end(frame) - split, height: frame.height }
    content = [{ type: 'pdfColumns', content: [left, right].map((items, index) => {
      const box = index ? rightFrame : leftFrame
      const badge = shapes.filter(s => s.fill && inside(bounds(items), s) && inside(s, frame) && s.width < frame.width * 0.5 && s.height < frame.height)
        .sort((a, b) => a.width * a.height - b.width * b.height)[0]
      return { type: 'pdfColumn', attrs: { pdfStyle: flexible
        ? { flexGrow: index ? 1 : 0, flexBasis: index ? 0 : leftFrame.width }
        : { flexGrow: index ? rightFrame.width : leftFrame.width, flexBasis: 0 } },
        content: [{ type: 'pdfRegion', attrs: { pdfStyle: badge ? { marginTop: Math.max(0, badge.y - box.y), marginLeft: Math.max(0, badge.x - box.x), width: badge.width } : {} },
          content: [textRegion(items, badge || box, [], badge, flexible && !badge)] }] }
    }) }]
  } else {
    let cursor = frame.y
    content = lines.map(line => {
      const box = bounds(line.runs)
      const lineHeight = Math.max(...line.runs.map(r => r.size)) * 1.1
      const marginTop = Math.max(0, box.y - cursor)
      cursor = box.y + lineHeight
      const groups: PdfRun[][] = []
      for (const run of line.runs) {
        const previous = groups.at(-1)
        if (previous && run.x - end(previous.at(-1)!) < run.size * 1.5) previous.push(run)
        else groups.push([run])
      }
      if (groups.length > 1) {
        // Separate labels on a common baseline retain their horizontal gaps.
        return { type: 'pdfRegion', attrs: { pdfStyle: { marginTop } }, content: layoutBlocks(groups.map(items => {
          const area = bounds(items)
          area.width = Math.min(end(frame) - area.x, area.width + 2)
          return { ...area, flexibleText: flexible, node: paragraph(items, { lineHeight }) }
        }), frame.x, box.y) }
      }
      return paragraph(line.runs, { marginTop, marginLeft: Math.max(0, box.x - frame.x), lineHeight })
    })
  }
  return { type: 'pdfRegion', attrs: { pdfSource: source(runs), pdfStyle: {
    backgroundColor: background?.fill || 'transparent', borderRadius: background?.rounded ? 3 : 0,
    minHeight: frame.height, paddingBottom: background && !gap ? Math.max(0, bottom(frame) - bottom(bounds(runs))) : 0,
  } }, content }
}

export function reconstructPage(page: ExtractedPage): { content: JSONContent; summary: ImportSummary } {
  const fixedPitch = page.runs.length > 30 && page.runs.filter(r=>/courier|monospace/i.test(r.family)).length > page.runs.length*.8
  let compactFlow = Boolean(page.encodedText || page.recoveredRules || fixedPitch || page.runs.some(r => r.rotation))
  const stamps = page.runs.filter(r=>!r.rotation&&r.y>page.height*.9&&page.runs.some(other=>other!==r&&!other.rotation&&Math.abs(r.baseline-other.baseline)<2&&Math.min(end(r),end(other))-Math.max(r.x,other.x)>2))
  const rotated = page.runs.filter(r => r.rotation && Math.abs(Math.abs(r.rotation)-90) < 0.1 || stamps.includes(r))
  if (rotated.length) page = { ...page, runs: page.runs.filter(r => !rotated.includes(r)) }
  if (!page.runs.length && !page.images?.length && !rotated.length) return {
    content: { type: 'doc', attrs: { schemaVersion: 2, sourcePage: 1, pageWidthPt: page.width, pageHeightPt: page.height, marginLeftPt: 0, marginRightPt: 0, marginTopPt: 0, marginBottomPt: 0 }, content: [{ type: 'paragraph' }] },
    summary: { rows: 0, columns: 0, tables: 0, notice: page.warnings.join(' ') },
  }
  const boxed = boxedForms(page, paragraph)
  const forms = boxed.blocks.length ? boxed : ruledGrid(page, paragraph)
  const ruled = forms.blocks.some(b=>b.node.attrs?.pdfSource?.confidence==='ruled-grid')
  if(ruled)compactFlow=true
  const printer = !forms.blocks.length ? printerReport(page, paragraph) : null
  const lines = linesOf(page.runs.filter(r => !forms.used.has(r.source) && !printer?.used.has(r.source)))
  const regions = detectTables({ ...page, shapes: page.shapes.filter(s => !forms.shapes.has(s)) }, lines)
  const used = new Set([...forms.used, ...printer?.used || [], ...regions.flatMap(r => r.lines.flatMap(l => l.runs.map(run => run.source)))])
  const blocks: Block[] = [...forms.blocks, ...printer?.blocks || [], ...regions.map(r => tableBlock(r, page))]
  const inferred = borderlessTables(page.runs.filter(r => !used.has(r.source)), paragraph, page.shapes)
  inferred.used.forEach(id => used.add(id))
  blocks.push(...inferred.blocks)
  const imageBlocks: Block[] = []
  for(const image of (page.images || []).filter(image=>!image.background&&!image.preserved)){
    const node:JSONContent={type:'localImage',attrs:{src:image.src,widthPt:image.width,aspectRatio:image.width/image.height,alt:'Imagem importada do PDF',pdfSource:{page:1,operationIndex:image.source}}}
    const coincident=imageBlocks.find(b=>near(b.x,image.x,.01)&&near(b.y,image.y,.01)&&near(b.width,image.width,.01)&&near(b.height,image.height,.01))
    if(coincident){
      if(coincident.node.type==='pdfImageStack')coincident.node.content!.push(node)
      else coincident.node={type:'pdfImageStack',attrs:{widthPt:image.width,heightPt:image.height},content:[coincident.node,node]}
    }else imageBlocks.push({...image,node})
  }
  const usedImages = new Set<Block>()
  const remaining = page.runs.filter(r => !used.has(r.source))
  const backgrounds = page.shapes.filter(s => !forms.shapes.has(s) && (s.fill && s.fill !== '#ffffff' || ruled && s.stroke) && s.width > 20 && s.height > 10 && s.width * s.height < page.width * page.height * 0.6)
    .sort((a, b) => b.width * b.height - a.width * a.height)
  for (const shape of backgrounds) {
    const runs = remaining.filter(r => !used.has(r.source) && inside(r, shape))
    if (!runs.length) continue
    runs.forEach(r => used.add(r.source))
    const containedImages = imageBlocks.filter(image => !usedImages.has(image) && inside(image, shape))
    if (containedImages.length) {
      containedImages.forEach(image => usedImages.add(image))
      // The background is a container, not a competing block preceding its logo.
      const children = linesOf(runs).map(line => {
        const box = bounds(line.runs)
        box.width = Math.min(end(shape) - box.x, box.width + 2)
        // Text beside a logo must use the containing frame/column, just like
        // free text. Its original glyph width is not an editing boundary.
        return { ...box, height: Math.max(...line.runs.map(r => r.size)) * 1.1, flexibleText: true,
          node: textRegion(line.runs, box, [], undefined, true) }
      })
      blocks.push({ ...shape, node: { type: 'pdfRegion', attrs: { pdfStyle: { backgroundColor: shape.fill, minHeight: shape.height } }, content: layoutBlocks([...children, ...containedImages], shape.x, shape.y) } })
    } else {
      const node = textRegion(runs, shape, backgrounds, shape)
      // A narrow filled accent adjoining a text panel is its left border.
      const accent = page.shapes.find(s => s.fill && s.fill !== '#ffffff' && s.width > 0 && s.width <= 4
        && near(s.x,shape.x,.1) && near(s.y,shape.y,.1) && near(s.height,shape.height,.1))
      if (accent) {
        node.attrs!.pdfStyle.borderLeft = `${accent.width}pt solid ${accent.fill}`
        // Border-box consumes this width; retain the imported text inset.
        for (const child of node.content || []) {
          const style = child.attrs?.pdfStyle
          if (style && style.marginLeft >= accent.width) style.marginLeft -= accent.width
        }
      }
      if (forms.blocks.length) {
        const outline = page.shapes.find(s => s.stroke && near(s.x,shape.x,0.1) && near(s.y,shape.y,0.1) && near(s.width,shape.width,0.1) && near(s.height,shape.height,0.1))
        if (outline) for (const edge of ['borderTop','borderBottom','borderLeft','borderRight']) node.attrs!.pdfStyle[edge] = `${outline.lineWidth}pt solid ${outline.stroke}`
      }
      blocks.push({ ...shape, node })
    }
  }
  blocks.push(...imageBlocks.filter(image => !usedImages.has(image)))
  // Standalone horizontal separators remain in document flow. Table rules
  // are already represented by cell borders and must not be duplicated.
  for (const shape of page.shapes.filter(s => s.stroke && s.height === 0 && s.width > 20 && !forms.shapes.has(s))) {
    if (blocks.some(b => shape.x >= b.x-1 && end(shape) <= end(b)+1 && shape.y >= b.y-1 && shape.y <= bottom(b)+1)) continue
    if (page.runs.some(r => shape.y >= r.y && shape.y <= bottom(r) && r.x < end(shape) && end(r) > shape.x)) continue
    const height = Math.max(.1,shape.lineWidth)
    blocks.push({ ...shape, y:shape.y-height/2, height, node:{type:'pdfRegion',attrs:{pdfStyle:{height,backgroundColor:shape.stroke}},
      content:[paragraph([],{fontSize:0,lineHeight:0})]} })
  }
  // Ungrouped text remains editable; no invented table for ambiguous content.
  for (const line of linesOf(remaining.filter(r => !used.has(r.source)))) {
    const box = bounds(line.runs)
    // Leave a small rounding allowance for browser font measurement.
    box.width = Math.min(page.width - box.x, box.width + 2)
    const node = textRegion(line.runs, box, [], undefined, true)
    // Free text uses its containing page/column width, not the original glyph
    // bounds. Column starts remain fixed; the last column uses remaining space.
    // Graphical frames, tables and badges retain their explicit bounds.
    blocks.push({ ...box, node, flexibleText: true })
  }
  blocks.sort((a, b) => a.y - b.y || a.x - b.x)
  const left = blocks.length ? Math.max(0, Math.min(...blocks.map(b => b.x))) : 0
  const right = blocks.length ? Math.max(0, page.width - Math.max(...blocks.map(end))) : 0
  const top = blocks.length ? Math.max(0, Math.min(...blocks.map(b => b.y))) : 0
  const bottomMargin = blocks.length ? Math.max(0, page.height - Math.max(...blocks.map(bottom))) : 0
  const content = layoutBlocks(blocks, left, top, true)
  if (compactFlow) {
    // Imported printer forms often use leading equal to the font size. The
    // default 9pt paragraph strut and extra leading accumulated on every line.
    const compact = (node: JSONContent) => {
      if(node.type==='table'&&node.attrs?.pdfSource?.confidence==='ruled-grid')return
      if (node.type === 'paragraph') {
        const sizes = (node.content || []).flatMap(n => n.marks?.filter(m=>m.type==='pdfTextStyle').map(m=>Number(m.attrs?.fontSizePt)||9) || [])
        const size = sizes.length ? Math.max(...sizes) : Number(node.attrs?.pdfStyle?.fontSize)||6
        const family = node.content?.find(n=>n.marks?.some(m=>m.type==='pdfTextStyle'))?.marks?.find(m=>m.type==='pdfTextStyle')?.attrs?.fontFamily
        node.attrs = { ...node.attrs, pdfStyle: { ...node.attrs?.pdfStyle, fontSize:size, lineHeight:size, ...(family?{fontFamily:family}:{}) } }
      }
      node.content?.forEach(compact)
      if(node.type==='table' && node.attrs?.pdfSource?.confidence==='alignment') {
        for(const row of node.content || []) {
          const rowRuns = (row.content || []).flatMap(c=>(c.attrs?.pdfSource?.itemIndexes || []).flatMap((id:number)=>page.runs.filter(r=>r.source===id)))
          if(!rowRuns.length)continue
          const rowTop = Math.min(...rowRuns.map(r=>r.y))-1
          const rowHeight = Number(row.attrs?.pdfStyle?.height) || Math.max(...rowRuns.map(r=>r.y+r.height))-rowTop
          for(const cell of row.content || []){
            const paragraphs=cell.content || []
            const tops=paragraphs.map(p=>{
              const ids=p.attrs?.pdfSource?.itemIndexes || []
              return Math.min(...page.runs.filter(r=>ids.includes(r.source)).map(r=>r.y))
            })
            let cursor=rowTop
            paragraphs.forEach((p,i)=>{
              if(!Number.isFinite(tops[i]))return
              const lineHeight=Math.max(1,Math.min(p.attrs!.pdfStyle.fontSize,(tops[i+1] ?? rowTop+rowHeight)-tops[i]))
              p.attrs!.pdfStyle={...p.attrs!.pdfStyle,lineHeight,marginTop:Math.max(0,tops[i]-cursor)}
              cursor=tops[i]+lineHeight
            })
          }
        }
      }
    }
    content.forEach(compact)
  }
  // Marginal signatures are editable text boxes belonging to the page, not
  // paragraphs in the body reading order. They must not displace body tables.
  content.push(...rotated.map(run=>({type:'pdfRotatedText',attrs:{angle:run.rotation||0,widthPt:run.rotation?run.height:run.width+1,sizePt:run.size,xPt:run.x,yPt:run.y},
    content:[paragraph([{...run,width:run.rotation?run.height:run.width}],{fontSize:run.size,fontFamily:run.family,lineHeight:run.size})]})))
  const warnings = [...page.warnings]
  if (!forms.blocks.length && !regions.length && !inferred.blocks.length) warnings.push('Nenhuma tabela reconhecida com segurança; o texto foi mantido em blocos editáveis.')
  if (inferred.blocks.length) warnings.push('Há tabelas inferidas por alinhamento; confira suas células com o original.')
  warnings.push('Reconstrução editável; confira o layout com o original. Sem paginação automática. Edições nesta sessão.')
  return { content: { type: 'doc', attrs: { schemaVersion: 2, sourcePage: 1, pageWidthPt: page.width, pageHeightPt: page.height, marginLeftPt: left, marginRightPt: right, marginTopPt: top, marginBottomPt: bottomMargin, pdfBackgrounds: (page.images || []).filter(image => image.background || image.preserved) }, content },
    summary: { rows: forms.rows + inferred.rows + regions.reduce((sum, r) => sum + r.lines.length, 0), columns: Math.max(forms.columns, inferred.columns, ...regions.map(r => r.edges.length - 1)), tables: forms.blocks.length + regions.length + inferred.blocks.length, notice: warnings.join(' ') } }
}
