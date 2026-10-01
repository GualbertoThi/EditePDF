import type { JSONContent } from '@tiptap/react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { extractPage } from './extractPage.ts'
import { reconstructPage, type ImportSummary } from './reconstructPage.ts'
import type { ImageEncoder } from './imageAssets.ts'
import type { PdfFontAsset } from './fontAssets.ts'
import { needsVectorOcr } from './vectorOcrGate.ts'

export type DocumentImportSummary = ImportSummary & { pages: number }

export async function importDocument(pdf: PDFDocumentProxy, isCancelled = () => false, encodeImage?: ImageEncoder, options: { signal?: AbortSignal; onProgress?: (message: string) => void } = {}) {
  const pages: JSONContent[] = []
  const summary: DocumentImportSummary = { pages: pdf.numPages, rows: 0, columns: 0, tables: 0, notice: '' }
  const notices = new Set<string>()
  const fonts: PdfFontAsset[] = []
  for (let number = 1; number <= pdf.numPages; number++) {
    if (isCancelled()) throw new Error('Importação cancelada.')
    let extracted = await extractPage(pdf, number, encodeImage)
    if (needsVectorOcr(extracted) || extracted.runs.some(run => run.unmapped)) {
      if (isCancelled()) throw new Error('Importação cancelada.')
      const { recognizeVectorPage } = await import('./vectorOcr.ts')
      extracted = await recognizeVectorPage(pdf, number, extracted, options.signal, options.onProgress)
    }
    if (isCancelled()) throw new Error('Importação cancelada.')
    fonts.push(...extracted.fonts || [])
    const result = reconstructPage(extracted)
    // Item indexes are local to each source page. Keep provenance unambiguous.
    const setPage = (node: JSONContent) => {
      if (node.attrs?.pdfSource) node.attrs.pdfSource.page = number
      node.content?.forEach(setPage)
    }
    result.content.content?.forEach(setPage)
    pages.push({ type: 'pdfPage', attrs: { ...result.content.attrs, sourcePage: number, pdfVisibilityArchive: extracted.visibilityArchive || [] }, content: result.content.content })
    summary.rows += result.summary.rows
    summary.columns = Math.max(summary.columns, result.summary.columns)
    summary.tables += result.summary.tables
    for (const notice of result.summary.notice.split(/(?<=\.)\s+/)) if (notice) notices.add(notice)
  }
  summary.notice = [...notices].join(' ')
  return { content: { type: 'doc', attrs: { schemaVersion: 3, pdfFonts: fonts }, content: pages } as JSONContent, summary }
}
