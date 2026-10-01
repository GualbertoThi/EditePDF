import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker&url'
import { DocumentEditor } from './editor/DocumentEditor'
import { OriginalPdfViewer } from './pdf-viewer/OriginalPdfViewer'
import './App.css'
import type { Editor } from '@tiptap/react'

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
type ViewMode = 'original' | 'editor' | 'split'
type OpenDocument = { pdf: pdfjs.PDFDocumentProxy; name: string; id: number }

function App() {
  const [document, setDocument] = useState<OpenDocument | null>(null)
  const [mode, setMode] = useState<ViewMode>('split')
  const [zoom, setZoom] = useState(100)
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState('')
  const [activeEditor, setActiveEditor] = useState<Editor | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveNotice, setSaveNotice] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const request = useRef(0)
  const task = useRef<pdfjs.PDFDocumentLoadingTask | null>(null)
  useEffect(() => () => { request.current += 1; void task.current?.destroy() }, [])

  async function openPdf(file: File) {
    const id = ++request.current
    setOpening(true)
    setError('')
    setActiveEditor(null)
    setSaveNotice('')
    setDocument(null)
    const previous = task.current
    task.current = null
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      const pdf = await Promise.race([
        (async () => {
          await previous?.destroy()
          const bytes = await file.arrayBuffer()
          if (id !== request.current) return null
          const loading = pdfjs.getDocument({ data: bytes, fontExtraProperties: true,
            wasmUrl: `${import.meta.env.BASE_URL}pdfjs/wasm/`,
            standardFontDataUrl: `${import.meta.env.BASE_URL}pdfjs/standard_fonts/`,
          })
          task.current = loading
          return loading.promise
        })(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('A abertura excedeu 30 segundos. Recarregue a página e tente novamente.')), 30_000)
        }),
      ])
      if (id !== request.current) return
      if (pdf) setDocument({ pdf, name: file.name, id })
    } catch (reason) {
      if (id === request.current) {
        console.error('[PDF Editor] Falha ao abrir PDF:', reason)
        setError(reason instanceof Error ? reason.message : 'Não foi possível abrir o PDF.')
        request.current += 1
        const failedTask = task.current as pdfjs.PDFDocumentLoadingTask | null
        task.current = null
        void failedTask?.destroy().catch(() => {})
        setOpening(false)
      }
    } finally {
      clearTimeout(timeout)
      if (id === request.current) setOpening(false)
    }
  }
  function changeFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (file) void openPdf(file)
    event.target.value = ''
  }
  async function saveEditedPdf() {
    if (!activeEditor || activeEditor.isDestroyed || !document || saving) return
    const id = document.id
    setSaving(true); setError(''); setSaveNotice('Preparando cópia em PDF…')
    try {
      const response = await fetch('/api/export-pdf', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: activeEditor.state.doc.toJSON(), name: document.name }),
      })
      if (!response.ok) throw new Error(await response.text())
      const blob = await response.blob()
      if (!blob.type.includes('application/pdf')) throw new Error('Reinicie o servidor local para ativar a exportação PDF.')
      if (request.current !== id) { setSaving(false); return }
      const url = URL.createObjectURL(blob)
      const link = window.document.createElement('a')
      link.href = url; link.download = document.name.replace(/\.pdf$/i, '') + ' - editado.pdf'
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 60_000)
      setSaving(false)
      const adjusted = response.headers.get('X-PDF-Auto-Fit')
      setSaveNotice('Cópia PDF gerada. Confira o arquivo nos downloads do navegador.' + (adjusted ? ` Conteúdo reduzido para caber nas páginas (página: escala): ${adjusted}.` : ''))
    } catch (reason) {
      setSaving(false); setSaveNotice('')
      if (request.current === id) setError(reason instanceof Error ? reason.message : 'Não foi possível preparar o PDF.')
    }
  }
  return <main className="app-shell">
    <header className="topbar">
      <div className="brand-mark">P</div>
      <div className="brand-name">PDF Editor <span>{document?.name || 'Documento sem título'}</span></div>
      <nav className="top-actions" aria-label="Ações do documento">
        <input ref={input} className="visually-hidden" type="file" accept="application/pdf,.pdf" onChange={changeFile} />
        <button onClick={() => input.current?.click()}>Abrir PDF</button>
        <button disabled={!activeEditor || saving} title="Baixar uma cópia PDF do documento editado" onClick={() => void saveEditedPdf()}>{saving ? 'Preparando…' : 'Salvar cópia PDF'}</button>
      </nav>
    </header>
    <div className="workspace">
      <aside className="left-panel" aria-label="Visualização">
        <div className="panel-label">VISUALIZAÇÃO</div>
        {([['split', 'Lado a lado'], ['original', 'PDF original'], ['editor', 'Editar documento']] as const).map(([value, label]) =>
          <button key={value} className="tool-button" aria-pressed={mode === value} onClick={() => setMode(value)}>{label}</button>)}
        <div className="panel-divider" />
        <p className="session-note">Edições nesta sessão. Abrir outro PDF ou recarregar descarta as alterações.</p>
      </aside>
      <section className="editor-area">
        {error && <p className="message error" role="alert">{error}</p>}
        {saveNotice && <p className="message" role="status">{saveNotice}</p>}
        {opening && <p className="message" role="status">Abrindo PDF…</p>}
        {!document && !opening && <div className="welcome"><h1>PDF Editor</h1><p>Abra um PDF para reconstruir o texto e as tabelas simples de todas as páginas. Compare a edição com o documento original.</p><button onClick={() => input.current?.click()}>Abrir PDF</button></div>}
        {document && <div className={`document-panes mode-${mode}`} key={document.id}>
          <div className="original-pane" hidden={mode === 'editor'}><OriginalPdfViewer pdf={document.pdf} zoom={zoom} /></div>
          {/* View switches never unmount the canonical editor or reimport its text. */}
          <div className="editing-pane" hidden={mode === 'original'}><DocumentEditor pdf={document.pdf} onReady={setActiveEditor} /></div>
        </div>}
        <footer className="editor-status">
          <span>{document ? `${document.pdf.numPages} páginas no original · edição de todas as páginas` : 'Arquivo local'}</span>
          <span className="zoom-controls"><button aria-label="Diminuir zoom" onClick={() => setZoom(value => Math.max(50, value - 10))}>−</button><span>{zoom}%</span><button aria-label="Aumentar zoom" onClick={() => setZoom(value => Math.min(150, value + 10))}>+</button></span>
        </footer>
      </section>
    </div>
  </main>
}
export default App
