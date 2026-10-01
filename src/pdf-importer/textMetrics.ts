import type { JSONContent } from '@tiptap/react'

export type MeasureText = (text: string, family: string, size: number, bold: boolean, italic: boolean) => number

/** Match the PDF's text advances with letter spacing, while keeping real
 * Unicode text, caret positions and normal wrapping in the editor. */
export function calibrateTextSpacing(content: JSONContent, measure: MeasureText) {
  const visit = (node: JSONContent) => {
    if (node.type === 'text' && node.text) {
      const mark = node.marks?.find(m => m.type === 'pdfTextStyle')
      const attrs = mark?.attrs
      if (attrs && Number.isFinite(attrs.sourceWidthPt)) {
        const text = node.text.trimStart()
        const measured = measure(text, attrs.fontFamily, attrs.fontSizePt, Boolean(node.marks?.some(m => m.type === 'bold')), Boolean(node.marks?.some(m => m.type === 'italic')))
        const spacing = (attrs.sourceWidthPt - measured) / [...text].length
        if (Number.isFinite(spacing) && Math.abs(spacing) < attrs.fontSizePt * 0.2) attrs.letterSpacingPt = spacing
      }
    }
    node.content?.forEach(visit)
  }
  visit(content)
}

export function calibrateBrowserText(content: JSONContent) {
  const context = document.createElement('canvas').getContext('2d')
  if (!context) return
  calibrateTextSpacing(content, (text, family, size, bold, italic) => {
    // Pixels here intentionally have the same numeric size as points: the
    // measured result and PDF advances must use the same coordinate unit.
    context.font = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${size}px ${family}`
    return context.measureText(text).width
  })
}
