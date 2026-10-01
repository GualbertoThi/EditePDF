import { useEffect, useRef, useState } from 'react'
import { TextLayer, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist/legacy/build/pdf.mjs'
import './OriginalPdfViewer.css'

function OriginalPage({ pdf, number, width }: { pdf: PDFDocumentProxy; number: number; width: number }) {
  const host = useRef<HTMLDivElement>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let disposed = false
    let renderTask: RenderTask | undefined
    let textLayer: TextLayer | undefined
    const container = host.current!
    setError('')
    async function render() {
      const page = await pdf.getPage(number)
      if (disposed) return
      const natural = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: width / natural.width })
      const ratio = window.devicePixelRatio || 1
      // Separate canvases avoid competing render tasks during zoom/StrictMode cleanup.
      const canvas = document.createElement('canvas')
      canvas.setAttribute('aria-label', `Página ${number} do PDF original`)
      canvas.width = Math.ceil(viewport.width * ratio)
      canvas.height = Math.ceil(viewport.height * ratio)
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`
      const layer = document.createElement('div')
      layer.className = 'textLayer'
      layer.style.setProperty('--total-scale-factor', String(viewport.scale))
      layer.style.setProperty('--scale-round-x', '1px')
      layer.style.setProperty('--scale-round-y', '1px')
      container.replaceChildren(canvas, layer)
      renderTask = page.render({ canvas, viewport, transform: [ratio, 0, 0, ratio, 0, 0] })
      await renderTask.promise
      if (disposed) return
      textLayer = new TextLayer({ container: layer, viewport, textContentSource: page.streamTextContent() })
      await textLayer.render()
    }
    void render().catch(() => {
      if (!disposed) setError(`Não foi possível renderizar a página ${number}.`)
    })
    return () => {
      disposed = true
      renderTask?.cancel()
      textLayer?.cancel()
      container.replaceChildren()
    }
  }, [pdf, number, width])
  return <article className="original-page" style={{ width }}>
    <div ref={host} className="original-page-layers" />
    {error && <p role="alert">{error}</p>}
    <div className="original-page-number">Página {number}</div>
  </article>
}

export function OriginalPdfViewer({ pdf, zoom }: { pdf: PDFDocumentProxy; zoom: number }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [availableWidth, setAvailableWidth] = useState(760)
  useEffect(() => {
    const element = scrollRef.current!
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setAvailableWidth(Math.max(240, entry.contentRect.width - 48))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const width = Math.min(760, availableWidth) * zoom / 100
  return <section className="original-viewer" aria-label="Visualizador PDF original">
    <div className="panel-heading"><strong>PDF original</strong><span>{pdf.numPages} páginas · somente leitura</span></div>
    <div ref={scrollRef} className="original-scroll">
      <div className="original-stack" style={{ width }}>
        {Array.from({ length: pdf.numPages }, (_, index) => <OriginalPage key={index} pdf={pdf} number={index + 1} width={width} />)}
      </div>
    </div>
  </section>
}
