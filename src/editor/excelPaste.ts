import { Extension } from '@tiptap/react'
import { Plugin } from '@tiptap/pm/state'

/** Clipboard CSS is read in an inert document, never attached to the application. */
export function normalizeExcelPaste(html: string): string {
  if (!/<table\b/i.test(html) || !/(?:urn:schemas-microsoft-com:office:excel|mso-|class\s*=\s*["']?xl\d)/i.test(html)) return html
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const rules: { selector: string; style: CSSStyleDeclaration; weight: number; order: number }[] = []
  for (const source of doc.querySelectorAll('style')) {
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(source.textContent || '')
    for (const rule of Array.from(sheet.cssRules)) {
      if (!(rule instanceof CSSStyleRule)) continue
      for (const selector of rule.selectorText.split(',')) {
        // Excel emits simple element/class selectors. Ignore complex selectors.
        if (!/^[\w.*#\s>-]+$/.test(selector)) continue
        const weight = (selector.match(/#/g)?.length || 0) * 100 + (selector.match(/\./g)?.length || 0) * 10 + (selector.match(/(?:^|\s|>)\w/g)?.length || 0)
        rules.push({ selector, style: rule.style, weight, order: rules.length })
      }
    }
  }
  rules.sort((a, b) => a.weight - b.weight || a.order - b.order)
  const cache = new Map<Element, CSSStyleDeclaration>()
  const inherited = ['font-family', 'font-size', 'font-weight', 'font-style', 'color', 'text-align', 'white-space', 'text-decoration-line']
  function style(element: Element): CSSStyleDeclaration {
    const cached = cache.get(element)
    if (cached) return cached
    const result = doc.createElement('span').style
    if (element.parentElement) {
      const parent = style(element.parentElement)
      for (const key of inherited) result.setProperty(key, parent.getPropertyValue(key))
    }
    if (/^(B|STRONG)$/.test(element.tagName)) result.fontWeight = 'bold'
    if (/^(I|EM)$/.test(element.tagName)) result.fontStyle = 'italic'
    if (element.tagName === 'U') result.textDecorationLine = 'underline'
    if (element.tagName === 'FONT') {
      result.fontFamily = element.getAttribute('face') || result.fontFamily
      result.color = element.getAttribute('color') || result.color
    }
    const apply = (source: CSSStyleDeclaration) => {
      for (const key of Array.from(source)) {
        if (result.getPropertyPriority(key) === 'important' && source.getPropertyPriority(key) !== 'important') continue
        result.setProperty(key, source.getPropertyValue(key), source.getPropertyPriority(key))
      }
    }
    for (const rule of rules) {
      try { if (element.matches(rule.selector)) apply(rule.style) } catch { /* Unsupported selector. */ }
    }
    apply((element as HTMLElement).style || doc.createElement('span').style)
    cache.set(element, result)
    return result
  }
  const pt = (value: string | null): number | undefined => {
    if (!value || !/^\d+(?:\.\d+)?(?:pt|px|in|cm|mm)?$/i.test(value.trim())) return undefined
    const n = parseFloat(value)
    const factor = /pt$/i.test(value) ? 1 : /in$/i.test(value) ? 72 : /cm$/i.test(value) ? 72 / 2.54 : /mm$/i.test(value) ? 72 / 25.4 : 0.75
    return n * factor
  }
  function metadata(element: HTMLElement, values: Record<string, unknown>) {
    element.setAttribute('data-pdf-style', JSON.stringify(values))
  }
  // Excel gridlines are a worksheet view feature and normally do not arrive
  // in clipboard HTML as cell borders. Recreate only the missing/none edges;
  // any explicit Excel border continues to win unchanged.
  const gridline = '0.5pt solid #d9d9d9'
  for (const table of Array.from(doc.querySelectorAll('table'))) {
    if (table.parentElement?.closest('table')) continue
    const output = doc.createElement('table')
    metadata(output, { borderCollapse: 'collapse', borderSpacing: '0', borderTop: gridline, borderBottom: gridline, borderLeft: gridline, borderRight: gridline, excelPaste: true })
    const widths: (number | undefined)[] = []
    for (const col of table.querySelectorAll('col')) {
      const width = pt(style(col).width || col.getAttribute('width'))
      for (let n = 0; n < Math.min(1000, Number(col.getAttribute('span')) || 1); n++) widths.push(width)
    }
    const occupied: number[] = []
    let rowIndex = 0
    for (const row of Array.from(table.rows)) {
      const outRow = output.insertRow()
      metadata(outRow, { height: pt(style(row).height || row.getAttribute('height')) })
      let column = 0
      for (const cell of Array.from(row.cells)) {
        while ((occupied[column] || 0) > rowIndex) column++
        const outCell = outRow.insertCell()
        outCell.colSpan = cell.colSpan
        outCell.rowSpan = cell.rowSpan
        const css = style(cell)
        const cellWidth = pt(css.width || cell.getAttribute('width'))
        const cellWidths = Array.from({ length: cell.colSpan }, (_, offset) => widths[column + offset] ?? (cellWidth === undefined ? undefined : cellWidth / cell.colSpan))
        if (cellWidths.every(w => w !== undefined && w > 0)) outCell.setAttribute('colwidth', cellWidths.map(w => Math.round(w! / 0.75)).join(','))
        const border = (side: string) => {
          const value = css.getPropertyValue(`border-${side}`).replace(/windowtext/gi, '#000000').trim()
          // "none" / zero-width is how Excel represents cells that only show
          // worksheet gridlines. Give those edges the same light gridline,
          // while preserving real thin/medium/thick/double borders verbatim.
          if (!value || /(?:^|\s)none(?:\s|$)/i.test(value) || /^0(?:px|pt)?(?:\s|$)/i.test(value)) return gridline
          return value
        }
        const align = css.textAlign || cell.getAttribute('align') || (/^\s*[+-]?[\d.,]+\s*$/.test(cell.textContent || '') ? 'right' : 'left')
        outCell.style.textAlign = align
        metadata(outCell, {
          excelPaste: true,
          backgroundColor: css.backgroundColor || cell.getAttribute('bgcolor') || style(row).backgroundColor || '#ffffff',
          borderTop: border('top'), borderBottom: border('bottom'), borderLeft: border('left'), borderRight: border('right'),
          verticalAlign: css.verticalAlign || cell.getAttribute('valign') || 'bottom', textAlign: align,
          paddingTop: pt(css.paddingTop) ?? 0, paddingBottom: pt(css.paddingBottom) ?? 0,
          paddingLeft: pt(css.paddingLeft) ?? 1.5, paddingRight: pt(css.paddingRight) ?? 1.5,
        })
        let paragraph = doc.createElement('p')
        outCell.append(paragraph)
        const paragraphStyle = { textAlign: align, lineHeight: pt(css.fontSize) || 11 }
        metadata(paragraph, paragraphStyle)
        function append(node: ChildNode) {
          if (node.nodeType === 3) {
            if (!node.textContent) return
            const textStyle = style(node.parentElement || cell)
            let span: HTMLElement = doc.createElement('span')
            span.style.fontFamily = textStyle.fontFamily || 'Calibri, sans-serif'
            span.style.fontSize = textStyle.fontSize || '11pt'
            span.style.color = (textStyle.color || '#000000').replace(/windowtext/gi, '#000000')
            span.textContent = node.textContent
            for (const [enabled, tag] of [[textStyle.fontWeight === 'bold' || Number(textStyle.fontWeight) >= 600, 'strong'], [textStyle.fontStyle === 'italic', 'em'], [textStyle.textDecorationLine.includes('underline'), 'u']] as const) {
              if (enabled) { const wrapper = doc.createElement(tag); wrapper.append(span); span = wrapper }
            }
            paragraph.append(span)
          } else if (node.nodeType === 1) {
            const element = node as HTMLElement
            if (/^(SCRIPT|STYLE|LINK|IMG|OBJECT|IFRAME)$/.test(element.tagName)) return
            if (element.tagName === 'BR') { paragraph.append(doc.createElement('br')); return }
            if (/^(P|DIV)$/.test(element.tagName) && paragraph.childNodes.length) {
              paragraph = doc.createElement('p'); metadata(paragraph, paragraphStyle); outCell.append(paragraph)
            }
            for (const child of Array.from(element.childNodes)) append(child)
          }
        }
        for (const child of Array.from(cell.childNodes)) append(child)
        for (let offset = 0; offset < cell.colSpan; offset++) occupied[column + offset] = rowIndex + cell.rowSpan
        column += cell.colSpan
      }
      rowIndex++
    }
    table.replaceWith(output)
  }
  for (const element of doc.querySelectorAll('style,script,link,meta')) element.remove()
  return doc.body.innerHTML
}

export const ExcelPaste = Extension.create({
  name: 'excelPaste',
  addProseMirrorPlugins() {
    return [new Plugin({ props: { transformPastedHTML: html => normalizeExcelPaste(html) } })]
  },
})
