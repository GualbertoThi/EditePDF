import type { ExtractedPage, PdfRun } from './extractPage.ts'

/** Conservative per-page gate. No OCR for scans, blank pages, logos alone,
 * or documents whose main body already contains extractable text. */
export function needsVectorOcr(page: ExtractedPage): boolean {
  const bands = page.vectorTextBands || []
  if (bands.length < 8 || bands.reduce((sum, b) => sum + b.contours, 0) < 150) return false
  if (page.runs.length > 4 || page.runs.reduce((sum, run) => sum + run.text.length, 0) > 100) return false
  if (page.runs.some(run => run.y > page.height * 0.12 && run.y + run.height < page.height * 0.88)) return false
  if ((page.images || []).some(image => image.width * image.height > page.width * page.height * 0.35)) return false
  const rows = new Set(bands.map(b => Math.round(b.y / 5)))
  const spread = Math.max(...bands.map(b => b.y + b.height)) - Math.min(...bands.map(b => b.y))
  return rows.size >= 8 && spread > page.height * 0.25 && bands.some(b => b.width > page.width * 0.3)
}

export type RecognizedWord = { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number }; baseline: number }

/** OCR observations are explicitly labelled, distinct from native PDF text. */
export function mergeRecognizedWords(page: ExtractedPage, words: RecognizedWord[], scale: number): ExtractedPage {
  const clean = words.filter(w => w.text.trim() && w.bbox.x1 > w.bbox.x0 && w.bbox.y1 > w.bbox.y0)
  const advances = clean.filter(w => /^[A-Z0-9.,/-]{4,}$/i.test(w.text)).map(w => (w.bbox.x1 - w.bbox.x0) / w.text.length).sort((a, b) => a - b)
  const median = advances[Math.floor(advances.length / 2)] || 1
  const monospace = advances.length >= 20 && advances.filter(v => Math.abs(v - median) < median * 0.18).length > advances.length * 0.75
  let nextSource = Math.max(-1, ...page.runs.map(r => r.source)) + 1
  const recognized: PdfRun[] = clean.flatMap(word => {
    const x = word.bbox.x0 / scale, y = word.bbox.y0 / scale
    const width = (word.bbox.x1 - word.bbox.x0) / scale, height = (word.bbox.y1 - word.bbox.y0) / scale
    const centerX = x + width / 2, centerY = y + height / 2
    // Retain native headers/footers instead of duplicating them with OCR.
    if (page.runs.some(r => centerX >= r.x - 2 && centerX <= r.x + r.width + 2 && centerY >= r.y - 3 && centerY <= r.y + r.height + 3)) return []
    const size = monospace ? median / scale / 0.6 : height / 0.75
    return [{ text: word.text.trim(), x, y, width, height, size: Math.max(4, size), baseline: word.baseline / scale,
      family: monospace ? 'Courier New, monospace' : 'Arial, sans-serif', color: '#000000', bold: false, italic: false,
      source: nextSource++, recognition: { method: 'ocr' as const, confidence: word.confidence } }]
  })
  if (!recognized.length) throw new Error('O OCR não reconheceu texto nesta página vetorial. Confira o PDF original.')
  return { ...page, runs: [...page.runs, ...recognized], warnings: [...page.warnings,
    'Texto vetorial reconhecido por OCR local: confira palavras, datas e valores; fontes e estilos são aproximados.',
    ...(recognized.some(r => r.recognition!.confidence < 80) ? ['Há trechos de baixa confiança no reconhecimento.'] : []),
  ] }
}
