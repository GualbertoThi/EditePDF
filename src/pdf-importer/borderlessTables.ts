import type { JSONContent } from '@tiptap/react'
import type { Box, PdfRun, PdfShape } from './extractPage.ts'

type Band = { runs: PdfRun[]; baseline: number }
type Group = { left: number; right: number; runs: PdfRun[] }
export type RebuiltBlock = Box & { node: JSONContent; flexibleText?: boolean }
const right = (r: Box) => r.x + r.width
const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] || 0

function groups(runs: PdfRun[]): Group[] {
  const result: Group[] = []
  for (const run of [...runs].sort((a, b) => a.x - b.x)) {
    const previous = result.at(-1)
    if (previous && run.x - previous.right < run.size * 0.65) {
      previous.right = Math.max(previous.right, right(run)); previous.runs.push(run)
    } else result.push({ left: run.x, right: right(run), runs: [run] })
  }
  return result
}

/** Detect repeated columns independently of exact baseline/item counts. A
 * logical row can contain several baselines and empty cells. No header names. */
export function borderlessTables(runs: PdfRun[], paragraph: (runs: PdfRun[], style?: Record<string, unknown>) => JSONContent, shapes: PdfShape[] = []) {
  const bands: Band[] = []
  for (const run of [...runs].sort((a, b) => a.baseline - b.baseline)) {
    const band = bands.at(-1)
    if (band && Math.abs(run.baseline - band.baseline) <= run.size * 0.85) {
      band.runs.push(run); band.baseline = median(band.runs.map(r => r.baseline))
    } else bands.push({ runs: [run], baseline: run.baseline })
  }
  const used = new Set<number>(), blocks: RebuiltBlock[] = []
  let rows = 0, columns = 0
  const seeds = bands.map((band, index) => ({ band, index, columns: groups(band.runs) }))
    .filter(seed => seed.columns.length >= 3 && seed.columns.every(c => c.right - c.left > 1))
    .sort((a, b) => a.index - b.index)
  for (const seed of seeds) {
    if (seed.band.runs.some(r => used.has(r.source))) continue
    const cols = seed.columns
    const edges = [cols[0].left - 4, ...cols.slice(1).map((c, i) => (cols[i].right + c.left) / 2), cols.at(-1)!.right + 4]
    const cell = (r: PdfRun) => {
      const center = r.x + r.width / 2
      const c = Math.max(0, Math.min(cols.length - 1, edges.findIndex((x, i) => i < edges.length - 1 && center >= x && center < edges[i + 1]) >= 0 ? edges.findIndex((x, i) => i < edges.length - 1 && center >= x && center < edges[i + 1]) : center < edges[0] ? 0 : cols.length - 1))
      return r.x >= edges[c] - r.size * 2.1 && right(r) <= edges[c + 1] + r.size * 2.1 ? c : -1
    }
    const compatible = (band: Band) => !band.runs.some(r => used.has(r.source)) && band.runs.every(r => cell(r) >= 0)
    let start = seed.index, finish = seed.index
    const gap = Math.max(...seed.band.runs.map(r => r.size)) * 5
    while (start > 0 && bands[start].baseline - bands[start - 1].baseline < gap && compatible(bands[start - 1])) {
      if (new Set(bands[start - 1].runs.map(cell)).size < 3 && bands[start].baseline - bands[start - 1].baseline > Math.max(...bands[start - 1].runs.map(r => r.size)) * 1.5) break
      start--
    }
    while (finish + 1 < bands.length && bands[finish + 1].baseline - bands[finish].baseline < gap && compatible(bands[finish + 1])) finish++
    const region = bands.slice(start, finish + 1)
    const anchors = region.filter(b => new Set(b.runs.map(cell)).size >= 3)
    if (anchors.length < 3) continue
    // Confirm repeated edges, rather than accepting any text that fits a box.
    const aligned = anchors.filter(b => groups(b.runs).filter(g => cols.some(c => Math.abs(c.left - g.left) < 4 || Math.abs(c.right - g.right) < 4)).length >= 2)
    if (aligned.length < 3) continue
    const all = region.flatMap(b => b.runs)
    const assignments = new Map(all.map(run => [run.source, cell(run)]))
    const lefts = cols.map((col, c) => Math.min(col.left, ...all.filter(r => assignments.get(r.source) === c).map(r => r.x)))
    const rights = cols.map((col, c) => Math.max(col.right, ...all.filter(r => assignments.get(r.source) === c).map(right)))
    if (rights.slice(0, -1).some((edge, c) => edge > lefts[c + 1])) continue
    edges[0] = lefts[0] - 2
    edges[edges.length - 1] = rights.at(-1)! + 2
    for (let c = 1; c < cols.length; c++) edges[c] = (rights[c - 1] + lefts[c]) / 2
    const rowRuns = anchors.map(() => [] as PdfRun[])
    for (const run of all) {
      // At a midpoint prefer the preceding record. A small tolerance prevents
      // PDF rounding from attaching a continuation to the next transaction.
      let owner = 0
      anchors.forEach((a, i) => { if (Math.abs(run.baseline - a.baseline) < Math.abs(run.baseline - anchors[owner].baseline) - 0.5) owner = i })
      rowRuns[owner].push(run)
    }
    const tops = rowRuns.map(rr => Math.min(...rr.map(r => r.y)) - 1)
    const endY = Math.max(...all.map(r => r.y + r.height)) + 1
    const table: JSONContent = { type: 'table', attrs: { pdfSource: { page: 1, inferred: true, confidence: 'alignment' } }, content: rowRuns.map((rr, row) => {
      const height = (tops[row + 1] ?? endY) - tops[row]
      return { type: 'tableRow', attrs: { pdfStyle: { height } }, content: cols.map((_, c) => {
        const items = rr.filter(r => assignments.get(r.source) === c).sort((a, b) => a.baseline - b.baseline || a.x - b.x)
        const lines: PdfRun[][] = []
        for (const item of items) {
          const previous = lines.at(-1)
          if (previous && Math.abs(previous[0].baseline - item.baseline) < item.size * 0.3) previous.push(item)
          else lines.push([item])
        }
        const left = items.length ? Math.min(...items.map(r => r.x)) : edges[c] + 2
        const last = items.length ? Math.max(...items.map(right)) : edges[c + 1] - 2
        const paddingLeft = Math.max(0, left - edges[c]), paddingRight = Math.max(0, edges[c + 1] - last - 1)
        const background = shapes.filter(s => s.fill && s.fill !== '#ffffff' && s.x <= edges[c] + 3 && right(s) >= edges[c + 1] - 3
          && s.y < tops[row] + height && s.y + s.height > tops[row]
          && Math.min(s.y + s.height, tops[row] + height) - Math.max(s.y, tops[row]) >= height * 0.5).at(-1)
        let backgroundColor = background?.fill || 'transparent'
        if (background && (background.fillOpacity ?? 1) < 1 && /^#[\da-f]{6}$/i.test(backgroundColor)) {
          const rgb = [1, 3, 5].map(start => parseInt(backgroundColor.slice(start, start + 2), 16))
          backgroundColor = `rgba(${rgb.join(',')},${background.fillOpacity})`
        }
        let cursor = tops[row]
        const content = lines.map(line => {
          line.sort((a, b) => a.x - b.x)
          const top = Math.min(...line.map(r => r.y)), size = Math.max(...line.map(r => r.size))
          const lineHeight = size * 1.05
          const marginTop = Math.max(0, top - cursor)
          cursor = top + lineHeight
          const slackLeft = line[0].x - left, slackRight = last - Math.max(...line.map(right))
          return paragraph(line, { marginTop, lineHeight, textAlign: slackLeft > slackRight + 2 ? 'right' : 'left' })
        })
        // For left-aligned content the unused right side is editable space,
        // not padding sized to the original glyphs. Keep right-aligned cells'
        // existing inset so amounts do not jump to a different position.
        const editablePaddingRight = content.some(node => node.attrs?.pdfStyle?.textAlign === 'right') ? paddingRight : Math.min(2, paddingRight)
        return { type: 'tableCell', attrs: { colwidth: [(edges[c + 1] - edges[c]) * 96 / 72], pdfSource: { page: 1, itemIndexes: items.map(r => r.source), inferred: true }, pdfStyle: { backgroundColor, paddingLeft, paddingRight: editablePaddingRight, paddingTop: 0, paddingBottom: 0 } }, content: content.length ? content : [{ type: 'paragraph' }] }
      }) }
    }) }
    all.forEach(r => used.add(r.source))
    blocks.push({ x: edges[0], y: tops[0], width: edges.at(-1)! - edges[0], height: endY - tops[0], node: table })
    rows += rowRuns.length; columns = Math.max(columns, cols.length)
  }
  return { blocks, used, rows, columns }
}
