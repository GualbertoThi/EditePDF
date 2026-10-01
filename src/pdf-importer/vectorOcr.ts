import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { Worker } from 'tesseract.js'
import type { ExtractedPage } from './extractPage.ts'
import { mergeRecognizedWords, type RecognizedWord } from './vectorOcrGate.ts'

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error('Reconhecimento cancelado ou tempo limite excedido.'))
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

export async function recognizeVectorPage(pdf: PDFDocumentProxy, number: number, extracted: ExtractedPage, signal?: AbortSignal, progress?: (message: string) => void): Promise<ExtractedPage> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) abort()
  const timeout = setTimeout(abort, 120_000)
  let worker: Worker | undefined
  let canvas: HTMLCanvasElement | undefined
  try {
    if (controller.signal.aborted) throw new Error('Reconhecimento cancelado.')
    const page = await pdf.getPage(number)
    const scale = Math.min(4, Math.sqrt(12_000_000 / (extracted.width * extracted.height)))
    const viewport = page.getViewport({ scale })
    canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas indisponível para OCR.')
    progress?.(`OCR local: preparando página ${number}…`)
    const ignored = new Set(extracted.ocrIgnoredOperations || [])
    const rendering = page.render({ canvas, canvasContext: context, viewport, operationsFilter: index => !ignored.has(index) })
    const cancelRender = () => rendering.cancel()
    controller.signal.addEventListener('abort', cancelRender, { once: true })
    if (controller.signal.aborted) cancelRender()
    try { await abortable(rendering.promise, controller.signal) }
    finally { controller.signal.removeEventListener('abort', cancelRender) }
    const { createWorker, PSM } = await import('tesseract.js')
    const base = new URL(`${import.meta.env.BASE_URL}ocr/`, location.href).href
    const initializing = createWorker('por+eng', 1, {
      workerPath: `${base}worker.min.js`, corePath: `${base}core`, langPath: `${base}lang`,
      gzip: false, cacheMethod: 'none', workerBlobURL: false,
      logger: message => { if (!controller.signal.aborted) progress?.(`OCR local — página ${number}: ${Math.round(message.progress * 100)}% (${message.status === 'recognizing text' ? 'reconhecendo texto' : 'preparando motor'})`) },
    }).then(created => { worker = created; if (controller.signal.aborted) void created.terminate(); return created })
    worker = await abortable(initializing, controller.signal)
    const unmapped = extracted.runs.filter(run => run.unmapped && run.text)
    await worker.setParameters({ tessedit_pageseg_mode: unmapped.length ? PSM.SPARSE_TEXT : PSM.SINGLE_BLOCK, preserve_interword_spaces: '1', user_defined_dpi: String(Math.round(scale * 72)) })
    const { data } = await abortable(worker.recognize(canvas, {}, { blocks: true, text: true }), controller.signal)
    const words: RecognizedWord[] = (data.blocks || []).flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines.flatMap(line => line.words.map(word => ({ text: word.text, confidence: word.confidence, bbox: word.bbox, baseline: line.baseline.y0 })))))
    if (!unmapped.length) return mergeRecognizedWords(extracted, words, scale)
    // Retain native text; recognize only regions whose font encoding is broken.
    const graphics = unmapped.filter(run => run.graphic)
    const images = [...extracted.images || []]
    const preserveGraphic = (graphic: { x:number; y:number; width:number; height:number; source:number }, preserved=false) => {
      const crop = document.createElement('canvas')
      crop.width = Math.ceil(graphic.width * scale); crop.height = Math.ceil(graphic.height * scale)
      crop.getContext('2d')!.drawImage(canvas!, graphic.x*scale, graphic.y*scale, graphic.width*scale, graphic.height*scale, 0,0,crop.width,crop.height)
      images.push({ x: graphic.x, y: graphic.y, width: graphic.width, height: graphic.height, src: crop.toDataURL('image/png'), source: graphic.source, preserved })
    }
    graphics.forEach(graphic=>preserveGraphic(graphic))
    const overlaps = (word: RecognizedWord, run: typeof unmapped[number]) => {
      return word.bbox.x1/scale >= run.x-2 && word.bbox.x0/scale <= run.x+run.width+2 &&
        word.bbox.y1/scale >= run.y-2 && word.bbox.y0/scale <= run.y+run.height+2
    }
    const selected = words.filter(word => unmapped.some(run=>!run.graphic && overlaps(word,run)) && !graphics.some(run=>overlaps(word,run)))
    const groups: (typeof unmapped)[] = []
    for(const run of [...unmapped].filter(r=>!r.graphic).sort((a,b)=>a.baseline-b.baseline||a.x-b.x)){
      const group=groups.find(g=>Math.abs(g[0].baseline-run.baseline)<1.5&&run.x<=Math.max(...g.map(r=>r.x+r.width))+run.size*2)
      if(group)group.push(run);else groups.push([run])
    }
    let preserved=0
    for(const group of groups){
      if(selected.some(word=>group.some(run=>overlaps(word,run))))continue
      const x=Math.max(0,Math.min(...group.map(r=>r.x))-1),y=Math.max(0,Math.min(...group.map(r=>r.y))-1)
      const width=Math.min(extracted.width-x,Math.max(...group.map(r=>r.x+r.width))+1-x)
      const height=Math.min(extracted.height-y,Math.max(...group.map(r=>r.y+r.height))+1-y)
      if(width>0&&height>0){preserveGraphic({x,y,width,height,source:group[0].source},true);preserved++}
    }
    const native = { ...extracted, images, visibilityArchive: [...extracted.visibilityArchive || [], ...unmapped.map(r=>({source:r.source,text:r.text,reason:'encoding' as const}))], runs: extracted.runs.filter(run=>!run.unmapped) }
    const result = selected.length ? mergeRecognizedWords(native, selected, scale) : native
    // Accent marks and punctuation are not different font sizes. Use the
    // common body height of words on the same baseline for encoded text.
    for (const run of result.runs.filter(r=>r.recognition)) {
      const peers = selected.filter(w=>Math.abs(w.baseline/scale-run.baseline)<1.5 && w.text.length>=2)
        .map(w=>(w.bbox.y1-w.bbox.y0)/scale).sort((a,b)=>a-b)
      const size = peers.length ? peers[Math.floor(peers.length/2)]/.75 : run.size
      run.size = Math.max(3,size); run.height=run.size; run.y=run.baseline-run.size*.8
      const nearest = unmapped.filter(r=>!r.graphic).sort((a,b)=>Math.abs(a.baseline-run.baseline)+Math.abs(a.x-run.x)*.1-Math.abs(b.baseline-run.baseline)-Math.abs(b.x-run.x)*.1)[0]
      if(nearest)run.color=nearest.color
    }
    result.warnings.push('Fontes sem codificação Unicode foram reconhecidas por OCR; confira o texto com o original.')
    if(preserved)result.warnings.push(`${preserved} trecho(s) sem reconhecimento foram preservados como imagem, sem edição de caracteres, para não apagar conteúdo visível.`)
    return result
  } finally {
    clearTimeout(timeout); signal?.removeEventListener('abort', abort)
    await worker?.terminate()
    if (canvas) { canvas.width = 0; canvas.height = 0 }
  }
}
