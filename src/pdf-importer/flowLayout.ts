import type { JSONContent } from '@tiptap/react'
import type { RebuiltBlock } from './borderlessTables.ts'

/** Place overlapping vertical ranges in real flowing columns (e.g. a logo
 * beside a multi-line heading). Content continues to grow through normal flow. */
export function layoutBlocks(blocks: RebuiltBlock[], left: number, top: number, trackLayout = false): JSONContent[] {
  const groups: RebuiltBlock[][] = []
  let bottom = top
  for (const block of [...blocks].sort((a, b) => a.y - b.y || a.x - b.x)) {
    if (groups.length && block.y < bottom - 0.5) groups[groups.length - 1].push(block)
    else groups.push([block])
    bottom = Math.max(bottom, block.y + block.height)
  }
  let cursor = top
  return groups.map(group => {
    const flexible = group.every(block => block.flexibleText)
    const x = Math.min(...group.map(b => b.x)), y = Math.min(...group.map(b => b.y))
    const right = Math.max(...group.map(b => b.x + b.width)), end = Math.max(...group.map(b => b.y + b.height))
    const intervals: { left: number; right: number }[] = []
    for (const block of [...group].sort((a, b) => a.x - b.x)) {
      const previous = intervals.at(-1)
      if (previous && block.x <= previous.right + 0.1) previous.right = Math.max(previous.right, block.x + block.width)
      else intervals.push({ left: block.x, right: block.x + block.width })
    }
    let content: JSONContent[]
    if (intervals.length > 1) {
      const edges = [x, ...intervals.slice(1).map((interval, i) => (intervals[i].right + interval.left) / 2), right]
      content = [{ type: 'pdfColumns', content: intervals.map((_, i) => ({
        type: 'pdfColumn', attrs: { pdfStyle: flexible
          ? { flexGrow: i === intervals.length - 1 ? 1 : 0, flexBasis: i === intervals.length - 1 ? 0 : edges[i + 1] - edges[i] }
          : { flexGrow: edges[i + 1] - edges[i], flexBasis: 0 } },
        content: layoutBlocks(group.filter(b => b.x >= edges[i] - 0.1 && b.x + b.width <= edges[i + 1] + 0.1), edges[i], y, trackLayout),
      })) }]
    } else if (group.length === 1) content = [group[0].node]
    else {
      // Unresolved overlapping objects remain in reading order, not overlaid.
      content = group.map(b => ({ type: 'pdfRegion', attrs: { pdfStyle: { marginLeft: Math.max(0, b.x - x), width: b.width } }, content: [b.node] }))
    }
    const marginTop = Math.max(0, y - cursor)
    cursor = Math.max(cursor, end)
    return { type: 'pdfRegion', attrs: { ...(trackLayout ? { pdfSource: { importTop: y } } : {}), pdfStyle: { marginTop, marginLeft: Math.max(0, x - left),
      ...(flexible ? {} : { width: right - x }),
    } }, content }
  })
}
