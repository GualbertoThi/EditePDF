import { OPS, Util, type PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { encodeBrowserImage, type ImageEncoder, type DecodedImage } from './imageAssets.ts'
import { unicodeFont, fontDataUrl, type PdfFontAsset } from './fontAssets.ts'
import { orthogonalShapes } from './orthogonalPaths.ts'

export type Box = { x: number; y: number; width: number; height: number }
export type PdfRun = Box & {
  text: string; baseline: number; size: number; family: string; color: string
  bold: boolean; italic: boolean; source: number
  recognition?: { method: 'ocr'; confidence: number }
  rotation?: number
  unmapped?: boolean
  graphic?: boolean
}
export type PdfShape = Box & { fill: string | null; stroke: string | null; lineWidth: number; rounded: boolean; fillOpacity?: number }
export type PdfImage = Box & { src: string; source: number; background?: boolean; preserved?: boolean }
export type VectorTextBand = Box & { contours: number }
export type ExtractedPage = { recoveredRules?: boolean; encodedText?: boolean; width: number; height: number; runs: PdfRun[]; shapes: PdfShape[]; warnings: string[]; images?: PdfImage[]; fonts?: PdfFontAsset[]; vectorTextBands?: VectorTextBand[]; ocrIgnoredOperations?: number[]; visibilityArchive?: { source: number; text: string; reason: 'clip' | 'covered' | 'encoding' }[] }
type Paint = { text: string; colors: string[]; clips: Box[]; orders: number[]; origins: number[][]; offset: number }
type GraphicsState = { matrix: number[]; fill: string; stroke: string; lineWidth: number; font: string; fillOpacity: number; clip: Box; textMatrix?: number[]; opaqueSafe?: boolean }
function intersection(a: Box, b: Box): Box {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y)
  return { x, y, width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x), height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y) }
}
const compact = (text: string) => text.replace(/\s/g, '')

/** Read PDF facts only. Geometric grouping belongs to reconstructPage, not here. */
export async function extractPage(pdf: PDFDocumentProxy, pageNumber = 1, encodeImage: ImageEncoder = encodeBrowserImage): Promise<ExtractedPage> {
  const page = await pdf.getPage(pageNumber)
  const viewport = page.getViewport({ scale: 1 })
  const [text, operations] = await Promise.all([page.getTextContent(), page.getOperatorList()])
  const warnings = new Set<string>()
  const shapes: PdfShape[] = []
  let recoveredRules = false
  const vectorTextBands: VectorTextBand[] = []
  const ocrIgnoredOperations: number[] = []
  const paint = new Map<string, Paint>()
  const characters = new Map<string, Map<number, number>>()
  const opaquePaint: (Box & { order: number })[] = []
  const images: PdfImage[] = []
  const imageCache = new Map<string, string>()
  let state: GraphicsState = { matrix: [1, 0, 0, 1, 0, 0], fill: '#000000', stroke: '#000000', lineWidth: 1, font: '', fillOpacity: 1, clip: { x: 0, y: 0, width: viewport.width, height: viewport.height } }
  let pendingClip = false
  const stack: GraphicsState[] = []
  function save() { stack.push({ ...state, matrix: [...state.matrix] }) }
  function rectangle(bounds: ArrayLike<number>): Box {
    const matrix = Util.transform(viewport.transform, state.matrix)
    const points = [[bounds[0], bounds[1]], [bounds[2], bounds[1]], [bounds[2], bounds[3]], [bounds[0], bounds[3]]]
      .map(([x, y]) => [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]])
    const xs = points.map(p => p[0]), ys = points.map(p => p[1])
    return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
  }
  for (let i = 0; i < operations.fnArray.length; i++) {
    const op = operations.fnArray[i], args = operations.argsArray[i] || []
    if (op === OPS.save || op === OPS.paintFormXObjectBegin) {
      save()
      if (op === OPS.paintFormXObjectBegin && args[0]) state.matrix = Util.transform(state.matrix, args[0])
      if (op === OPS.paintFormXObjectBegin && args[1]) state.clip = intersection(state.clip, rectangle(args[1]))
    } else if (op === OPS.restore || op === OPS.paintFormXObjectEnd) state = stack.pop() || state
    else if (op === OPS.beginGroup) {
      save()
      const group = args[0]
      if (group.smask || group.knockout || group.hasSoftMask) state.opaqueSafe = false
      const matrix = state.matrix
      if (group.matrix) state.matrix = Util.transform(state.matrix, group.matrix)
      if (group.bbox) state.clip = intersection(state.clip, rectangle(group.bbox))
      state.matrix = matrix // Group matrix bounds the surface; child content has its own transform.
    } else if (op === OPS.endGroup) state = stack.pop() || state
    else if (op === OPS.clip || op === OPS.eoClip) pendingClip = true
    else if (op === OPS.transform) state.matrix = Util.transform(state.matrix, args)
    else if (op === OPS.setFillRGBColor) state.fill = args[0]
    else if (op === OPS.setStrokeRGBColor) state.stroke = args[0]
    else if (op === OPS.setLineWidth) state.lineWidth = args[0]
    else if (op === OPS.setTextMatrix) state.textMatrix = Array.from(args[0]?.length ? args[0] : args)
    else if (op === OPS.setFont) state.font = args[0]
    else if (op === OPS.setGState) {
      for (const [key, value] of args[0] || []) {
        if (key === 'ca') state.fillOpacity = Number(value)
        if (key === 'BM' && value !== 'source-over' && value !== 'Normal' || key === 'SMask' && value) state.opaqueSafe = false
      }
    }
    else if (op === OPS.showText || op === OPS.showSpacedText) {
      const glyphs = args[0] as ({ unicode?: string; fontChar?: string } | number)[]
      const mapping = characters.get(state.font) || new Map<number, number>()
      for (const glyph of glyphs) if (typeof glyph !== 'number' && glyph.unicode && glyph.fontChar && [...glyph.unicode].length === 1) mapping.set(glyph.unicode.codePointAt(0)!, glyph.fontChar.codePointAt(0)!)
      characters.set(state.font, mapping)
      const value = compact(glyphs.filter(g => typeof g !== 'number').map(g => (g as { unicode?: string }).unicode || '').join(''))
      const entry = paint.get(state.font) || { text: '', colors: [], clips: [], orders: [], origins: [], offset: 0 }
      entry.text += value
      entry.colors.push(...Array(value.length).fill(state.fill))
      entry.clips.push(...Array(value.length).fill(state.clip))
      entry.orders.push(...Array(value.length).fill(i))
      const origin = Util.transform(Util.transform(viewport.transform, state.matrix), state.textMatrix || [1,0,0,1,0,0])
      entry.origins.push(...Array(value.length).fill([origin[4], origin[5]]))
      paint.set(state.font, entry)
    } else if (op === OPS.constructPath && args[2]) {
      // PDF.js 6 exposes paint operation, packed path and local bounding box.
      const [operation, paths, bounds] = args
      if (pendingClip) {
        // A bounding rectangle is a conservative superset even for complex
        // clipping paths: never reject potentially visible content in a hole.
        state.clip = intersection(state.clip, rectangle(bounds))
        pendingClip = false
      }
      const fill = [OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke].includes(operation)
      const stroke = [OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke].includes(operation)
      if (!fill && !stroke) continue // Clipping paths are not visible backgrounds.
      const path = paths[0] as ArrayLike<number>
      if (!path || typeof path.length !== 'number') continue
      let curved = false, supported = true, contours = 0
      for (let k = 0; k < path.length;) {
        const command = path[k++]
        if (command === 0 || command === 1) {
          if (command === 0) contours++
          const x = path[k++], y = path[k++]
          // Only axis-aligned edges and rounded rectangles; skip arbitrary artwork.
          if (Math.min(Math.abs(x - bounds[0]), Math.abs(x - bounds[2])) > 4 && Math.min(Math.abs(y - bounds[1]), Math.abs(y - bounds[3])) > 4) supported = false
        } else if (command === 2) { curved = true; k += 6 }
        else if (command !== 4) { supported = false; break }
      }
      const matrix = Util.transform(viewport.transform, state.matrix)
      if (Math.abs(matrix[1]) > 0.01 || Math.abs(matrix[2]) > 0.01) supported = false
      const rawBox = rectangle(bounds)
      const box = intersection(rawBox, state.clip)
      if (box.width === 0 && rawBox.width > 0 || box.height === 0 && rawBox.height > 0) continue
      const rgb = /^#[\da-f]{6}$/i.test(state.stroke) ? [1, 3, 5].map(start => parseInt(state.stroke.slice(start, start + 2), 16)) : [0, 0, 0]
      // Small colored pen strokes are not characters; exclude only these
      // drawing operations from OCR, not all colored pixels/text on the page.
      if (stroke && !fill && contours < 3 && box.width < 30 && box.height < 30 && Math.max(...rgb) - Math.min(...rgb) > 40) ocrIgnoredOperations.push(i)
      if (!supported) {
        const rules = orthogonalShapes(path, matrix, fill ? state.fill : null, stroke ? state.stroke : null, state.lineWidth*Math.hypot(matrix[0],matrix[1]))
        if (rules) {
          recoveredRules = true
          shapes.push(...rules.map(rule => ({ ...rule, ...intersection(rule,state.clip) })))
          continue
        }
        // Repeated small outlines in long, shallow paths can be outlined text.
        // This is evidence only; vectorOcrGate applies page-level safeguards.
        if (fill && /^#(?:[0-5][\da-f]){3}$/i.test(state.fill) && contours >= 8 && box.height >= 3 && box.height <= 24 && box.width >= box.height * 5) vectorTextBands.push({ ...box, contours })
        warnings.add('Alguns elementos gráficos não retangulares não foram reconstruídos.'); continue
      }
      const plainRectangle = path.length === 13 && path[0] === 0 && path[3] === 1 && path[6] === 1 && path[9] === 1 && path[12] === 4 &&
        ((path[1] === path[10] && path[4] === path[7] && path[2] === path[5] && path[8] === path[11]) ||
         (path[1] === path[4] && path[7] === path[10] && path[2] === path[11] && path[5] === path[8]))
      if (fill && plainRectangle && state.fillOpacity === 1 && state.opaqueSafe !== false) opaquePaint.push({ ...box, order: i })
      shapes.push({ ...box, fill: fill ? state.fill : null, fillOpacity: state.fillOpacity, stroke: stroke ? state.stroke : null,
        lineWidth: state.lineWidth * Math.hypot(matrix[0], matrix[1]), rounded: curved })
    } else if (op === OPS.paintImageXObject || op === OPS.paintInlineImageXObject) {
      try {
        const matrix = Util.transform(viewport.transform, state.matrix)
        if (matrix[0] <= 0 || matrix[3] >= 0 || Math.abs(matrix[1]) > 0.01 || Math.abs(matrix[2]) > 0.01) throw new Error('Imagem rotacionada ou espelhada.')
        const key = typeof args[0] === 'string' ? args[0] : `inline-${i}`
        let src = imageCache.get(key)
        if (!src) {
          const image = op === OPS.paintInlineImageXObject ? args[0] : await new Promise<DecodedImage>(resolve => (key.startsWith('g_') ? page.commonObjs : page.objs).get(key, resolve))
          src = await encodeImage(image)
          imageCache.set(key, src)
        }
        images.push({ ...rectangle([0, 0, 1, 1]), src, source: i })
      } catch { warnings.add('Uma imagem não pôde ser reconstruída; confira o PDF original.') }
    } else if ([OPS.paintImageMaskXObject, OPS.paintImageMaskXObjectGroup, OPS.paintImageXObjectRepeat].includes(op)) {
      warnings.add('Máscaras ou repetições de imagem complexas permanecem apenas no original.')
    } else if (op === OPS.shadingFill || op === OPS.setFillColorN) {
      warnings.add('Gradientes e padrões complexos podem não ser preservados.')
    }
  }
  const fonts: PdfFontAsset[] = []
  const fontFamilies = new Map<string, { name: string; family: string }>()
  for (const [id, mapping] of characters) {
    try {
      const font = page.commonObjs.get(id)
      if (!font.data?.length || !mapping.size) continue
      const family = `PDF_${id}_p${pageNumber}`
      fonts.push({ family, name: font.name.replace(/^[A-Z]{6}\+/, ''), src: fontDataUrl(unicodeFont(new Uint8Array(font.data), mapping)), weight: /bold|black|heavy|semibold/i.test(font.name) ? '700' : '400', style: /italic|oblique/i.test(font.name) ? 'italic' : 'normal' })
      fontFamilies.set(id, { name: font.name, family })
    } catch { warnings.add('Uma fonte incorporada não pôde ser reutilizada; foi aplicada uma substituta.') }
  }
  const runs: PdfRun[] = []
  // A broken ToUnicode map affects the entire font, including glyphs that
  // accidentally resemble ASCII. Do not infer this from the document name.
  const encodingCounts = new Map<string,{ total:number; invalid:number }>()
  for(const item of text.items)if('str' in item){
    const count=encodingCounts.get(item.fontName)||{total:0,invalid:0}
    count.total+=item.str.length
    count.invalid+=(item.str.match(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/g)||[]).length
    encodingCounts.set(item.fontName,count)
  }
  // An isolated control glyph can be an invisible separator in otherwise
  // valid fonts (e.g. the already supported CAIXA statement).
  const unmappedFonts = new Set([...encodingCounts].filter(([,c])=>c.invalid>=3&&c.invalid/c.total>.1).map(([font])=>font))
  const visibilityArchive: NonNullable<ExtractedPage['visibilityArchive']> = []
  text.items.forEach((item, source) => {
    if (!('str' in item) || !item.str.trim()) return
    const transform = Util.transform(viewport.transform, item.transform)
    let rawFont: { type?: string; name?: string; bbox?: number[] } | undefined
    try { rawFont = page.commonObjs.get(item.fontName) } catch { /* Optional font details. */ }
    const type3 = rawFont?.type === 'Type3'
    // Named Type3 subsets may have perfectly valid Unicode and a matching
    // embedded sibling font. Preserve that validated native-text path.
    const unmapped = unmappedFonts.has(item.fontName) || type3 && rawFont?.name === 'Type3'
    const angle = Math.atan2(transform[1], transform[0]) * 180 / Math.PI
    const rotation = Math.abs(angle) > 0.1 ? angle : 0
    let size = Math.max(1, Math.hypot(transform[2], transform[3]))
    if (type3 && rawFont?.bbox?.join(',') === '-10,-10,10,10') {
      // Some Type3 fonts scale their charProc matrix independently. The
      // vertical text transform is then NOT a usable font size (e.g. 148pt).
      size = Math.min(size, Math.max(1, Math.hypot(transform[0], transform[1])))
    }
    const style = text.styles[item.fontName]
    let fontName = ''
    try { fontName = page.commonObjs.get(item.fontName)?.name || '' } catch { /* Fall back to extracted family. */ }
    let family = style?.fontFamily === 'monospace' ? 'Courier New, monospace' : 'Arial, sans-serif'
    if (/times|serif/i.test(fontName) && !/sans/i.test(fontName)) family = 'Times New Roman, serif'
    else if (/courier|mono/i.test(fontName)) family = 'Courier New, monospace'
    else if (/calibri/i.test(fontName)) family = 'Calibri, Arial, sans-serif'
    else if (/arial|helvetica/i.test(fontName)) family = 'Arial, sans-serif'
    else if (fontName && !fontFamilies.has(item.fontName) && ![...fontFamilies.values()].some(f => f.name === fontName)) warnings.add('Alguns caracteres usam fontes substitutas; confira as quebras de linha.')
    const embedded = fontFamilies.get(item.fontName) || [...fontFamilies.values()].find(f => f.name === fontName)
    if (embedded) family = `${embedded.family}, ${family}`
    const entry = paint.get(item.fontName)
    const needle = compact(item.str)
    let match = entry?.text.indexOf(needle, entry.offset) ?? -1
    const candidates: number[] = []
    if (entry) {
      for (let candidate = entry.text.indexOf(needle); candidate >= 0; candidate = entry.text.indexOf(needle, candidate + 1)) {
        const origin = entry.origins[candidate]
        if (origin && Math.abs(origin[0] - transform[4]) < 1 && Math.abs(origin[1] - transform[5]) < 1) {
          candidates.push(candidate)
        }
      }
    }
    if (candidates.length) match = candidates[0]
    const color = match >= 0 && entry ? entry.colors[match] : '#000000'
    if (entry && match >= 0) entry.offset = match + needle.length
    else warnings.add('A cor de alguns trechos não pôde ser associada com segurança; foi usado preto.')
    const bbox = rawFont?.bbox
    const ascent = unmapped && type3 && bbox && bbox[1] <= 0 && bbox[3] <= 20 && bbox[3]-bbox[1] > 20
      ? size * -bbox[1] / (bbox[3]-bbox[1]) : size * (style?.ascent || 0.8)
    const radians = rotation * Math.PI / 180
    const points = [[0, -ascent], [item.width, -ascent], [0, size-ascent], [item.width, size-ascent]]
      .map(([x,y]) => [transform[4] + x*Math.cos(radians)-y*Math.sin(radians), transform[5]+x*Math.sin(radians)+y*Math.cos(radians)])
    const box = { x: Math.min(...points.map(p=>p[0])), y: Math.min(...points.map(p=>p[1])),
      width: Math.max(...points.map(p=>p[0]))-Math.min(...points.map(p=>p[0])), height: Math.max(...points.map(p=>p[1]))-Math.min(...points.map(p=>p[1])) }
    // Matching is per font and paint order, never by duplicate text alone.
    // Keep uncertain and partially clipped runs intact.
    let fullyClipped = false
    const hidden = entry && candidates.length && candidates.every(candidate => {
      const clipped = entry.clips.slice(candidate, candidate + needle.length).every(clip => {
        const visible = intersection(box, clip)
        return visible.width === 0 || visible.height === 0
      })
      const covered = opaquePaint.some(cover => cover.order > Math.max(...entry.orders.slice(candidate, candidate + needle.length)) &&
        cover.x <= box.x && cover.y <= box.y && cover.x + cover.width >= box.x + box.width && cover.y + cover.height >= box.y + box.height)
      return clipped || covered
    })
    if (hidden && entry) fullyClipped = candidates.every(candidate => entry.clips.slice(candidate, candidate + needle.length).every(clip => {
      const visible = intersection(box, clip)
      return visible.width === 0 || visible.height === 0
    }))
    if (hidden) visibilityArchive.push({ source, text: item.str, reason: fullyClipped ? 'clip' : 'covered' })
    if (fullyClipped) return
    // A covered cell still has geometry: preserve its blank row and background.
    runs.push({ text: hidden ? '' : item.str.trim(), ...box,
      baseline: transform[5], size, family, color, ...(rotation ? { rotation } : {}),
      ...(unmapped ? { unmapped: true } : {}),
      ...(type3 && /^<[WwNn]+>$/.test(item.str) ? { graphic: true } : {}),
      bold: /bold|black|heavy|semibold/i.test(fontName), italic: /italic|oblique/i.test(fontName), source })
  })
  if (!runs.length) warnings.add('Página sem texto extraível. Se houver conteúdo digitalizado, ele permanece apenas no original; OCR ainda não está disponível.')
  // A page-sized image painted before text is stationery, not a flow block.
  // Do not classify scans, ordinary logos, signatures or foreground pictures.
  const firstTextPaint = operations.fnArray.findIndex(op => op === OPS.showText || op === OPS.showSpacedText)
  for (const image of images) {
    if (runs.length && image.source < firstTextPaint && image.width * image.height >= viewport.width * viewport.height * 0.8 &&
      image.width <= viewport.width * 1.02 && image.height <= viewport.height * 1.02 &&
      runs.filter(run => run.x >= image.x - 1 && run.x + run.width <= image.x + image.width + 1 && run.baseline >= image.y && run.baseline <= image.y + image.height).length >= runs.length * 0.95) image.background = true
  }
  return { recoveredRules, encodedText: runs.some(r=>r.unmapped), width: viewport.width, height: viewport.height, runs, shapes, warnings: [...warnings], images, fonts, vectorTextBands, ocrIgnoredOperations, visibilityArchive }
}
