import type { PDFDocumentProxy } from 'pdfjs-dist'
import { extractPage } from './extractPage.ts'
import { reconstructPage } from './reconstructPage.ts'
export type { ImportSummary } from './reconstructPage.ts'

export async function importFirstPage(pdf: PDFDocumentProxy) {
  return reconstructPage(await extractPage(pdf))
}
