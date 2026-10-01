import { Extension, Mark, Node, mergeAttributes } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Table, TableKit, TableView } from '@tiptap/extension-table'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { LocalImage } from './localImage.ts'
import { ExcelPaste } from '../editor/excelPaste.ts'
import { TableBehavior } from '../editor/tableBehavior.ts'
import { InternalClipboard } from '../editor/internalClipboard.ts'

// The live ProseMirror document is canonical. JSON is only an import/save snapshot.
export type DocumentModel = ProseMirrorNode

const lengths = new Set(['width', 'minWidth', 'height', 'minHeight', 'marginTop', 'marginLeft', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'lineHeight', 'fontSize', 'borderRadius', 'flexBasis'])
const strings = new Set(['backgroundColor', 'textAlign', 'verticalAlign', 'borderTop', 'borderBottom', 'borderLeft', 'borderRight', 'borderCollapse', 'borderSpacing'])
function styleToCss(style: Record<string, unknown> = {}) {
  if (!style || typeof style !== 'object' || Array.isArray(style)) return ''
  return Object.entries(style).flatMap(([key, value]) => {
    const css = key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      if (lengths.has(key)) return [`${css}:${value}pt`]
      if (key === 'flexGrow') return [`flex-grow:${value}`]
    }
    if (strings.has(key) && typeof value === 'string' && /^[#a-zA-Z0-9.,()%\s-]+$/.test(value)) return [`${css}:${value}`]
    if (key === 'fontFamily' && typeof value === 'string' && /^[\w ,'-]+$/.test(value)) return [`font-family:${value}`]
    return []
  }).join(';')
}

// The resizable table view does not apply global pdfStyle attributes itself.
// Only boxed forms use separate cell borders/spacing; keep other tables intact.
class FormTableView extends TableView {
  constructor(...args: ConstructorParameters<typeof TableView>) {
    super(...args)
    this.applyFormStyle()
  }
  applyFormStyle() {
    if (this.node.attrs.pdfSource?.confidence === 'boxed-form') this.table.style.cssText = styleToCss(this.node.attrs.pdfStyle)
    // Excel clipboard tables carry their own visual metadata. Keep the live
    // editor's table collapsed so recreated gridlines and explicit borders
    // render as the single lines seen in Excel. This does not affect PDF tables.
    if (this.node.attrs.pdfStyle?.excelPaste === true) {
      this.table.style.borderCollapse = 'collapse'
      this.table.style.borderSpacing = '0'
      this.cellMinWidth = 1
    }
    if (this.node.attrs.pdfSource?.confidence === 'ruled-grid') {
      this.cellMinWidth = 1
      const widths: number[] = []
      this.node.firstChild?.forEach(cell=>widths.push(...cell.attrs.colwidth || []))
      Array.from(this.colgroup.children).forEach((col,i)=>{if(widths[i]) (col as HTMLElement).style.width=`${widths[i]}px`})
    }
  }
  update(node: ProseMirrorNode) {
    const updated = super.update(node)
    if (updated) this.applyFormStyle()
    return updated
  }
}

// Small day-number columns in imported grids must retain their original
// widths in both the live table view and the PDF serializer.
const ImportedTable = Table.extend({
  renderHTML(props) {
    const result = this.parent!(props)
    if(props.node.attrs.pdfSource?.confidence==='ruled-grid') {
      const widths:number[]=[]
      props.node.firstChild?.forEach(cell=>widths.push(...cell.attrs.colwidth || []))
      let index=0
      const visit=(entry:unknown)=>{
        if(!Array.isArray(entry))return
        if(entry[0]==='col'&&widths[index]) entry[1]={...entry[1],style:`width:${widths[index++]}px`}
        else entry.forEach(visit)
      }
      visit(result)
    }
    return result
  },
})

const FlowRegion = Node.create({
  name: 'pdfRegion', group: 'block', content: 'block+', defining: true,
  parseHTML() { return [{ tag: 'section[data-pdf-region]' }] },
  renderHTML({ HTMLAttributes }) { return ['section', mergeAttributes(HTMLAttributes, { 'data-pdf-region': '', class: 'pdf-flow-region' }), 0] },
})
const ImageStack = Node.create({
  name:'pdfImageStack',group:'block',content:'localImage{2,}',defining:true,
  addAttributes(){return {widthPt:{default:100},heightPt:{default:100}}},
  parseHTML(){return [{tag:'div[data-pdf-image-stack]'}]},
  renderHTML({node}){return ['div',{'data-pdf-image-stack':'',class:'pdf-image-stack',style:`position:relative;width:${Number(node.attrs.widthPt)||100}pt;height:${Number(node.attrs.heightPt)||100}pt`},0]},
})
const RotatedText = Node.create({
  name: 'pdfRotatedText', group: 'block', content: 'paragraph+', defining: true,
  addAttributes() { return { angle: { default: -90 }, widthPt: { default: 100 }, sizePt: { default: 9 }, xPt: { default: 0 }, yPt: { default: 0 } } },
  parseHTML() { return [{ tag: 'div[data-pdf-rotated-text]' }] },
  renderHTML({ node }) {
    const width = Math.max(1, Number(node.attrs.widthPt) || 100)
    const height = Math.max(1, Number(node.attrs.sizePt) || 9) * 1.1
    const angle = Math.abs(Number(node.attrs.angle)) < 1 ? 0 : Math.abs(Number(node.attrs.angle) - 90) < 1 ? 90 : -90
    const x = Number(node.attrs.xPt)||0, y = Number(node.attrs.yPt)||0
    return ['div', { 'data-pdf-rotated-text': '', style: `width:${angle?height:width}pt;height:${angle?width:height}pt;position:absolute;left:${x}pt;top:${y}pt` },
      ['div', { style: `width:${width}pt;transform-origin:0 0;transform:rotate(${angle}deg) ${angle < 0 ? 'translateX(-100%)' : angle > 0 ? 'translateY(-100%)' : ''}` }, 0]]
  },
})
const PdfPage = Node.create({
  name: 'pdfPage', group: 'block', content: 'block+', defining: true, isolating: true,
  parseHTML() { return [{ tag: 'section[data-pdf-page]' }] },
  renderHTML({ node, HTMLAttributes }) {
    const attrs = node.attrs
    const backgrounds = (Array.isArray(attrs.pdfBackgrounds) ? attrs.pdfBackgrounds : []).filter((image: {src: string; x: number; y: number; width: number; height: number}) =>
      /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image.src) && [image.x,image.y,image.width,image.height].every(Number.isFinite) && image.width > 0 && image.height > 0).slice().reverse()
    const backgroundStyle = backgrounds.length ? `;background-image:${backgrounds.map((image: {src:string}) => `url("${image.src}")`).join(',')};background-position:${backgrounds.map((image: {x:number;y:number}) => `${image.x}pt ${image.y}pt`).join(',')};background-size:${backgrounds.map((image: {width:number;height:number}) => `${image.width}pt ${image.height}pt`).join(',')};background-repeat:no-repeat;background-origin:border-box` : ''
    return ['section', mergeAttributes(HTMLAttributes, {
      'data-pdf-page': attrs.sourcePage,
      class: 'document-sheet',
      'data-page-number': attrs.pageNumber === null ? null : String(attrs.pageNumber),
      style: `width:${attrs.pageWidthPt}pt;min-height:${attrs.pageHeightPt}pt;padding:${attrs.marginTopPt}pt ${attrs.marginRightPt}pt ${attrs.pageNumber === null ? attrs.marginBottomPt : Math.max(24, attrs.marginBottomPt)}pt ${attrs.marginLeftPt}pt;--page-number-align:${attrs.pageNumberAlignment};--page-left:${attrs.marginLeftPt}pt;--page-right:${attrs.marginRightPt}pt${backgroundStyle}`,
    }), 0]
  },
})
const FlowColumns = Node.create({
  name: 'pdfColumns', group: 'block', content: 'pdfColumn{2,}', defining: true,
  parseHTML() { return [{ tag: 'div[data-pdf-columns]' }] },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-pdf-columns': '', class: 'pdf-flow-columns' }), 0] },
})
const FlowColumn = Node.create({
  name: 'pdfColumn', content: 'block+', defining: true, isolating: true,
  parseHTML() { return [{ tag: 'div[data-pdf-column]' }] },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-pdf-column': '', class: 'pdf-flow-column' }), 0] },
})

const PdfMetadata = Extension.create({
  name: 'pdfMetadata',
  addGlobalAttributes() {
    return [
      { types: ['doc'], attributes: { pdfFonts: { default: [], rendered: false } } },
      {
        types: ['doc', 'pdfPage'],
        attributes: {
          schemaVersion: { default: 2, rendered: false },
          sourcePage: { default: 1, rendered: false },
          pdfBackgrounds: { default: [], rendered: false },
          // Original non-visible source text, retained for audit, not editable copies.
          pdfVisibilityArchive: { default: [], rendered: false },
          pageWidthPt: { default: 595.28, rendered: false },
          pageHeightPt: { default: 841.89, rendered: false },
          marginLeftPt: { default: 36, rendered: false },
          marginRightPt: { default: 36, rendered: false },
          marginTopPt: { default: 0, rendered: false },
          marginBottomPt: { default: 0, rendered: false },
          pageNumber: { default: null, rendered: false },
          pageNumberAlignment: { default: 'center', rendered: false },
        },
      },
      {
        types: ['heading', 'paragraph', 'table', 'tableRow', 'tableCell', 'tableHeader', 'pdfRegion', 'pdfColumns', 'pdfColumn'],
        attributes: {
          // Provenance, not live layout coordinates or an identity copied on split.
          pdfSource: { default: null, renderHTML: attributes => Number.isFinite(attributes.pdfSource?.importTop)
            ? { 'data-import-top': attributes.pdfSource.importTop } : {} },
          pdfStyle: {
            default: {},
            parseHTML: element => {
              try {
                const value = JSON.parse(element.getAttribute('data-pdf-style') || '{}')
                return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
              } catch { return {} }
            },
            renderHTML: attributes => ({ style: styleToCss(attributes.pdfStyle), 'data-pdf-style': JSON.stringify(attributes.pdfStyle) }),
          },
        },
      },
    ]
  },
})

// A small local mark preserves extracted sizes/families without another package.
const PdfTextStyle = Mark.create({
  name: 'pdfTextStyle',
  addAttributes() {
    return {
      sourceWidthPt: { default: null, rendered: false },
      letterSpacingPt: {
        default: 0,
        parseHTML: element => {
          const value = element.style.letterSpacing
          return (Number.parseFloat(value) || 0) * (value.endsWith('pt') ? 1 : 0.75)
        },
        renderHTML: attributes => ({ style: `letter-spacing:${attributes.letterSpacingPt}pt` }),
      },
      color: {
        default: '#000000',
        parseHTML: element => element.style.color || '#000000',
        renderHTML: attributes => ({ style: `color: ${attributes.color}` }),
      },
      fontSizePt: {
        default: 9,
        parseHTML: element => {
          const value = element.style.fontSize
          const size = Number.parseFloat(value)
          return Number.isFinite(size) && size > 0 ? (value.endsWith('pt') ? size : size * 0.75) : 9
        },
        renderHTML: attributes => ({ style: `font-size: ${attributes.fontSizePt}pt` }),
      },
      fontFamily: {
        default: 'Arial, sans-serif',
        parseHTML: element => element.style.fontFamily || 'Arial, sans-serif',
        renderHTML: attributes => ({ style: `font-family: ${attributes.fontFamily}` }),
      },
    }
  },
  parseHTML() { return [{ tag: 'span[style]' }] },
  renderHTML({ HTMLAttributes }) { return ['span', mergeAttributes(HTMLAttributes), 0] },
})

export function documentExtensions() {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2] },
      link: false,
      codeBlock: false,
      horizontalRule: false,
    }),
    TableKit.configure({ table: false }),
    ImportedTable.configure({ resizable: true, cellMinWidth: 24, View: FormTableView }),
    PdfMetadata,
    PdfTextStyle,
    FlowRegion,
    ImageStack,
    RotatedText,
    FlowColumns,
    FlowColumn,
    PdfPage,
    LocalImage,
    ExcelPaste,
    InternalClipboard,
    TableBehavior,
  ]
}
