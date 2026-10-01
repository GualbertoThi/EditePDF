import { DOMSerializer, Fragment } from '@tiptap/pm/model'
import type { DocumentModel } from '../document-model/schema.ts'
import type { PdfFontAsset } from '../pdf-importer/fontAssets.ts'
import editorCss from '../editor/DocumentEditor.css?inline'

export type PrintedPage = { widthPt: number; heightPt: number; originalHeightPt: number; scale: number }
export type PreparedPdf = { frame: HTMLIFrameElement; pages: PrintedPage[]; dispose: () => void }

/** A read-only rendering of a canonical snapshot. Never uses the original PDF,
 * screen zoom, selection decorations or a raster image of the edited page. */
export async function preparePdfPrint(model: DocumentModel, filename: string): Promise<PreparedPdf> {
  model.check()
  // Tiptap may append an empty paragraph after the final page for navigation.
  const pageNodes = Array.from({ length: model.childCount }, (_, i) => model.child(i)).filter(node => !(node.type.name === 'paragraph' && node.content.size === 0))
  if (!pageNodes.length || pageNodes.some(node => node.type.name !== 'pdfPage')) {
    throw new Error('O documento contém conteúdo fora das páginas. Mova esse conteúdo para uma página antes de salvar.')
  }
  const frame = document.createElement('iframe')
  frame.title = 'Cópia do documento para salvar em PDF'
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;left:-100000px;top:0;width:2000px;height:1500px;border:0;pointer-events:none'
  document.body.append(frame)
  const dispose = () => frame.remove()
  try {
    const output = frame.contentDocument!
    output.open()
    output.write('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>')
    output.close()
    output.title = filename.replace(/\.pdf$/i, '') + ' - editado'
    const style = output.createElement('style')
    style.textContent = editorCss + `
      * { box-sizing:border-box; }
      html,body { margin:0;padding:0;background:white;font-synthesis:none;text-rendering:optimizeLegibility;-webkit-font-smoothing:antialiased; }
      .document-stack { margin:0;width:max-content; }
      .tiptap { white-space:pre-wrap;white-space:break-spaces;word-wrap:break-word;font-variant-ligatures:none;font-feature-settings:"liga" 0; }
      .document-stack .document-sheet { margin:0;box-shadow:none; }
      .document-stack .document-sheet + .document-sheet { margin-top:0; }
      .tiptap .tableWrapper { overflow:visible; }
      .document-sheet { break-inside:avoid;break-after:page; }
      .document-sheet:last-child { break-after:auto; }
      .document-sheet,.document-sheet * { print-color-adjust:exact;-webkit-print-color-adjust:exact; }
      .ProseMirror-gapcursor,.column-resize-handle { display:none!important; }
      .selectedCell::after { display:none!important; }
      .local-image.ProseMirror-selectednode { outline:none; }
      @page { margin:0; }
      @media print { .document-stack,.document-stack .tiptap { display:contents; } }
    `
    output.head.append(style)
    // Fonts embedded in the model must be embedded in this independent document.
    const fontCss = output.createElement('style')
    const fonts = (model.attrs.pdfFonts || []) as PdfFontAsset[]
    fontCss.textContent = fonts.filter(font => /^data:font\/[\w+-]+;base64,[A-Za-z0-9+/=]+$/.test(font.src) && /^[\w -]+$/.test(font.family)).map(font =>
      `@font-face{font-family:${JSON.stringify(font.family)};src:url("${font.src}");font-weight:${font.weight === '700' ? '700' : '400'};font-style:${font.style === 'italic' ? 'italic' : 'normal'};}`
    ).join('\n')
    output.head.append(fontCss)
    const stack = output.createElement('div'); stack.className = 'document-stack'
    const content = output.createElement('div'); content.className = 'tiptap'
    content.append(DOMSerializer.fromSchema(model.type.schema).serializeFragment(Fragment.fromArray(pageNodes), { document: output }))
    for (const paragraph of content.querySelectorAll('p,h1,h2')) if (!paragraph.childNodes.length) paragraph.append(output.createElement('br'))
    stack.append(content); output.body.append(stack)
    // Trigger layout/font requests before awaiting FontFaceSet.ready.
    void content.offsetHeight
    await Promise.all([
      ...pageNodes.flatMap(node => (node.attrs.pdfBackgrounds || []).map(async (background: {src: string}) => {
        const image = output.createElement('img')
        image.src = background.src
        await image.decode().catch(() => { throw new Error('O fundo da página não pôde ser carregado. Tente salvar novamente.') })
      })),
      output.fonts.ready.then(() => {
        if ([...output.fonts].some(font => font.status === 'error')) throw new Error('Uma fonte não pôde ser carregada. O PDF não foi gerado para evitar substituições inesperadas.')
      }),
      ...Array.from(output.images).map(image => image.decode().catch(() => { throw new Error('Uma imagem não pôde ser carregada. Tente salvar novamente.') })),
    ])
    const sheets = Array.from(content.children) as HTMLElement[]
    const pages: PrintedPage[] = []
    const rules: string[] = []
    sheets.forEach((sheet, index) => {
      const source = pageNodes[index]
      const widthPt = Number(source.attrs.pageWidthPt), originalHeightPt = Number(source.attrs.pageHeightPt)
      if (![widthPt, originalHeightPt].every(n => Number.isFinite(n) && n > 0)) throw new Error(`Tamanho inválido na página ${index + 1}.`)
      let bounds = sheet.getBoundingClientRect()
      let left = Infinity, right = -Infinity
      const include = (rect: DOMRect) => { left = Math.min(left, rect.left); right = Math.max(right, rect.right) }
      for (const element of sheet.querySelectorAll<HTMLElement>('*')) include(element.getBoundingClientRect())
      const walker = output.createTreeWalker(sheet, NodeFilter.SHOW_TEXT)
      const range = output.createRange()
      let text: Node | null
      while ((text = walker.nextNode())) {
        range.selectNodeContents(text)
        for (const rect of range.getClientRects()) include(rect)
      }
      if (left < bounds.left - 1 || right > bounds.right + 1) {
        const css = output.defaultView!.getComputedStyle(sheet)
        const paddingLeft = parseFloat(css.paddingLeft), paddingRight = parseFloat(css.paddingRight)
        const available = bounds.width - paddingLeft - paddingRight
        if (available <= 0) throw new Error('As margens n?o deixam espa?o para o conte?do da p?gina.')
        const contentLeft = bounds.left + paddingLeft
        const start = Math.min(contentLeft, left)
        const end = Math.max(bounds.right - paddingRight, right)
        const scale = Math.min(1, available / (end - start + 1))
        const holder = output.createElement('div')
        const inner = output.createElement('div')
        // Freeze the pre-fit line wrapping; only the export copy is transformed.
        inner.style.cssText = 'display:flow-root;width:' + available + 'px;transform-origin:top left'
        // Marginal text boxes are anchored to the page, like its stationery.
        // Moving them into a transformed body would change their coordinate
        // system and displace signatures when a wide table is auto-fitted.
        const flowing = Array.from(sheet.childNodes).filter(node => !(node instanceof output.defaultView!.HTMLElement && node.hasAttribute('data-pdf-rotated-text')))
        inner.append(...flowing); holder.append(inner); sheet.insertBefore(holder, sheet.firstChild)
        const innerBox = inner.getBoundingClientRect()
        let bottom = innerBox.bottom
        for (const element of inner.querySelectorAll('*')) bottom = Math.max(bottom, element.getBoundingClientRect().bottom)
        inner.style.transform = 'scale(' + scale + ') translateX(' + (contentLeft - start) + 'px)'
        holder.style.cssText = 'display:flow-root;height:' + ((bottom - innerBox.top) * scale) + 'px'
        sheet.dataset.exportScale = String(scale)
        bounds = sheet.getBoundingClientRect()
      }
      const heightPt = Math.max(originalHeightPt, Math.ceil(bounds.height * 0.75 * 100) / 100)
      pages.push({ widthPt, heightPt, originalHeightPt, scale: Number(sheet.dataset.exportScale || 1) })
      const name = `editedSheet${index + 1}`
      sheet.style.page = name
      // Fix the already measured geometry so print pagination cannot reflow it.
      sheet.style.height = `${heightPt}pt`
      sheet.style.minHeight = '0'
      rules.push(`@page ${name} { size:${widthPt}pt ${heightPt}pt; margin:0; }`)
    })
    const pageStyle = output.createElement('style'); pageStyle.textContent = rules.join('\n'); output.head.append(pageStyle)
    return { frame, pages, dispose }
  } catch (error) { dispose(); throw error }
}
