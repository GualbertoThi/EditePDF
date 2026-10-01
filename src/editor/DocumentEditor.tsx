import { useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { documentExtensions } from '../document-model/schema'
import { importDocument, type DocumentImportSummary } from '../pdf-importer/importDocument'
import './DocumentEditor.css'
import { selectionFormatting, setAlignment, setTextStyle, type Alignment } from './formatting'
import { DocumentTools } from './DocumentTools'
import { paintFormat, type PaintFormat } from './formatPainter'
import { TextSelection } from '@tiptap/pm/state'
import { loadFontAssets, type PdfFontAsset } from '../pdf-importer/fontAssets'
import { calibrateBrowserText } from '../pdf-importer/textMetrics'
import { calibrateBrowserLayout } from '../pdf-importer/calibrateLayout'
import { addStyledRow, addStyledColumn } from './tableBehavior'

const fonts = ['Arial, sans-serif', 'Calibri, Arial, sans-serif', 'Times New Roman, serif', 'Courier New, monospace', 'Georgia, serif', 'Verdana, sans-serif']
const sizes = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72]
const alignments: { value: Alignment; label: string; short: string }[] = [
  { value: 'left', label: 'À esquerda', short: 'Esquerda' }, { value: 'center', label: 'Centralizar', short: 'Centro' },
  { value: 'right', label: 'À direita', short: 'Direita' },
]

export function DocumentEditor({ pdf, onReady }: { pdf: PDFDocumentProxy; onReady?: (editor: Editor | null) => void }) {
  const [editorZoom, setEditorZoom] = useState<number | null>(null)
  const [summary, setSummary] = useState<DocumentImportSummary | null>(null)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState('Reconstruindo o documento…')
  const [painter, setPainter] = useState<PaintFormat | null>(null)
  const [findSignal, setFindSignal] = useState(0)
  const [showImportDetails, setShowImportDetails] = useState(false)
  const scroll = useRef<HTMLDivElement>(null)
  const [availableWidth, setAvailableWidth] = useState(760)
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setAvailableWidth(Math.max(240, entry.contentRect.width - 48))
    })
    if (scroll.current) observer.observe(scroll.current)
    return () => observer.disconnect()
  }, [])
  const editor = useEditor({
    extensions: documentExtensions(),
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
    editable: false,
    editorProps: { attributes: { 'aria-label': 'Documento editável', spellcheck: 'false' } },
  })
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => current ? {
      ...selectionFormatting(current.state),
      fontLabel: (current.state.doc.attrs.pdfFonts as PdfFontAsset[]).find(font => current.getAttributes('pdfTextStyle').fontFamily?.split(',')[0] === font.family)?.name,
      bold: current.isActive('bold'), italic: current.isActive('italic'), underline: current.isActive('underline'),
      table: current.isActive('table'), undo: current.can().undo(), redo: current.can().redo(),
      pageWidth: Math.max(0, ...Array.from({ length: current.state.doc.childCount }, (_, i) => Number(current.state.doc.child(i).attrs.pageWidthPt) || 0)),
      pageCount: Array.from({ length: current.state.doc.childCount }, (_, i) => current.state.doc.child(i)).filter(node => node.type.name === 'pdfPage').length,
    } : null,
  })
  useEffect(() => {
    if (!editor) return
    let cancelled = false
    const controller = new AbortController()
    let releaseFonts: (() => void) | undefined
    editor.setEditable(false)
    setSummary(null)
    setError('')
    setProgress('Reconstruindo o documento…')
    setPainter(null)
    setShowImportDetails(false)
    void importDocument(pdf, () => cancelled, undefined, { signal: controller.signal, onProgress: message => { if (!cancelled) setProgress(message) } }).then(async result => {
      try { releaseFonts = await loadFontAssets(result.content.attrs?.pdfFonts || []) }
      catch { result.summary.notice += ' Algumas fontes não puderam ser carregadas; usadas fontes substitutas.' }
      if (cancelled || editor.isDestroyed) { releaseFonts?.(); return }
      calibrateBrowserText(result.content)
      await calibrateBrowserLayout(result.content)
      if (cancelled || editor.isDestroyed) return
      // Load once per PDF. No React copy of the editable document is kept.
      const doc = editor.schema.nodeFromJSON(result.content)
      doc.check()
      const transaction = editor.state.tr.replaceWith(0, editor.state.doc.content.size, doc.content)
      for (const [name, value] of Object.entries(doc.attrs)) transaction.setDocAttribute(name, value)
      transaction.setMeta('addToHistory', false)
      editor.view.dispatch(transaction)
      editor.setEditable(true)
      setSummary(result.summary)
    }).catch(reason => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : 'Não foi possível reconstruir a tabela.')
    })
    return () => { cancelled = true; controller.abort(); releaseFonts?.() }
  }, [editor, pdf])
  const ready = Boolean(summary && editor)
  useEffect(() => {
    onReady?.(ready ? editor : null)
    return () => onReady?.(null)
  }, [ready, editor, onReady])
  const pageWidth = state?.pageWidth || 595.28
  const fitScale = availableWidth / (pageWidth * 96 / 72)
  const displayScale = editorZoom === null ? fitScale : editorZoom / 100
  const zoomPercent = Math.round(displayScale * 100)
  return <section className="document-editor" aria-label="Editor do documento" onKeyDown={event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { setFindSignal(value => value + 1); event.preventDefault(); return }
    if (event.key === 'Escape' && painter) { setPainter(null); event.preventDefault() }
  }}>
    <div className="panel-heading editor-heading"><strong>Documento editável</strong>
      <div className="editor-zoom" role="group" aria-label="Zoom do documento editável" onMouseDown={event => event.preventDefault()}>
        <button aria-label="Diminuir zoom do editor" disabled={!ready || zoomPercent <= 25} onClick={() => setEditorZoom(Math.max(25, zoomPercent - 25))}>−</button>
        <output aria-label="Zoom atual do editor">{zoomPercent}%</output>
        <button aria-label="Aumentar zoom do editor" disabled={!ready || zoomPercent >= 300} onClick={() => setEditorZoom(Math.min(300, zoomPercent + 25))}>+</button>
        <button disabled={!ready} aria-pressed={editorZoom === null} onClick={() => setEditorZoom(null)}>Ajustar à largura</button>
      </div>
      <span>{summary ? `${state?.pageCount ?? summary.pages} página(s)` : 'Importando páginas'}</span>
    </div>
    <div className="format-toolbar" aria-label="Formatação e tabela" onMouseDown={event => {
      if ((event.target as HTMLElement).closest('button')) event.preventDefault()
    }}>
      <label className="format-field">Fonte
        <select aria-label="Fonte" disabled={!ready} value={state?.fontFamily || ''} onChange={event => editor?.chain().focus().command(({ state, dispatch }) => setTextStyle({ fontFamily: event.target.value })(state, dispatch)).run()}>
          <option value="" disabled>Mista</option>
          {state?.fontFamily && !fonts.includes(state.fontFamily) && <option value={state.fontFamily}>{state.fontLabel || state.fontFamily.split(',')[0]}</option>}
          {fonts.map(font => <option key={font} value={font}>{font.split(',')[0]}</option>)}
        </select>
      </label>
      <label className="format-field">Tamanho
        <select aria-label="Tamanho da fonte em pontos" disabled={!ready} value={state?.fontSizePt ?? ''} onChange={event => editor?.chain().focus().command(({ state, dispatch }) => setTextStyle({ fontSizePt: Number(event.target.value) })(state, dispatch)).run()}>
          <option value="" disabled>Misto</option>
          {state?.fontSizePt && !sizes.includes(state.fontSizePt) && <option value={state.fontSizePt}>{Number(state.fontSizePt.toFixed(2))} pt</option>}
          {sizes.map(size => <option key={size} value={size}>{size} pt</option>)}
        </select>
      </label>
      <label className="format-field">Cor{state?.color === '' ? ' (mista)' : ''}
        <input type="color" aria-label="Cor do texto" disabled={!ready} value={/^#[\da-f]{6}$/i.test(state?.color || '') ? state!.color : '#000000'} onChange={event => editor?.chain().focus().command(({ state, dispatch }) => setTextStyle({ color: event.target.value })(state, dispatch)).run()} />
      </label>
      {alignments.map(alignment => <button key={alignment.value} disabled={!ready} title={alignment.label} aria-label={`Alinhamento: ${alignment.label}`} aria-pressed={state?.alignment === alignment.value} onClick={() => editor?.chain().focus().command(({ state, dispatch }) => setAlignment(alignment.value)(state, dispatch)).run()}>{alignment.short}</button>)}
      <button disabled={!ready} title="Negrito" aria-label="Negrito" aria-pressed={state?.bold || false} onClick={() => editor?.chain().focus().toggleBold().run()}><b>B</b></button>
      <button disabled={!ready} title="Itálico" aria-label="Itálico" aria-pressed={state?.italic || false} onClick={() => editor?.chain().focus().toggleItalic().run()}><i>I</i></button>
      <button disabled={!ready} title="Sublinhado" aria-label="Sublinhado" aria-pressed={state?.underline || false} onClick={() => editor?.chain().focus().toggleUnderline().run()}><u>U</u></button>
      <button disabled={!ready || !state?.undo} title="Desfazer" aria-label="Desfazer" onClick={() => editor?.chain().focus().undo().run()}>↶</button>
      <button disabled={!ready || !state?.redo} title="Refazer" aria-label="Refazer" onClick={() => editor?.chain().focus().redo().run()}>↷</button>
      <span className="toolbar-separator" aria-hidden="true" />
      <button disabled={!ready || !state?.table} title="Inserir linha acima" onClick={() => editor?.chain().focus().command(({ state, dispatch }) => addStyledRow(false)(state, dispatch)).run()}>+ Linha ↑</button>
      <button disabled={!ready || !state?.table} title="Inserir linha abaixo" onClick={() => editor?.chain().focus().command(({ state, dispatch }) => addStyledRow(true)(state, dispatch)).run()}>+ Linha ↓</button>
      <button disabled={!ready || !state?.table} title="Remover linha" onClick={() => editor?.chain().focus().deleteRow().run()}>− Linha</button>
      <button disabled={!ready || !state?.table} title="Inserir coluna à esquerda" onClick={() => editor?.chain().focus().command(({ state, dispatch }) => addStyledColumn(false)(state, dispatch)).run()}>+ Col. ←</button>
      <button disabled={!ready || !state?.table} title="Inserir coluna à direita" onClick={() => editor?.chain().focus().command(({ state, dispatch }) => addStyledColumn(true)(state, dispatch)).run()}>+ Col. →</button>
      <button disabled={!ready || !state?.table} title="Remover coluna" onClick={() => editor?.chain().focus().deleteColumn().run()}>− Col.</button>
    </div>
    <DocumentTools key={pdf.fingerprints[0]} editor={editor} ready={ready} painter={painter} onPainter={setPainter} findSignal={findSignal} />
    {error ? <p className="message error" role="alert">{error}</p> : !summary ? <p className="message" role="status">{progress}</p> : <div className="import-summary" title={showImportDetails ? undefined : summary.notice}>
      <span><b>{summary.tables}</b> tabela(s) · <b>{summary.rows}</b> linhas · até <b>{summary.columns}</b> colunas</span>
      {summary.notice && <button type="button" aria-expanded={showImportDetails} onClick={() => setShowImportDetails(value => !value)}>{showImportDetails ? 'Ocultar detalhes' : 'Detalhes'}</button>}
      {showImportDetails && summary.notice && <span className="import-details">{summary.notice}</span>}
    </div>}
    <div ref={scroll} className="document-scroll" hidden={!ready}>
      <div className={`document-stack${painter ? ' format-painter-active' : ''}`} style={{ zoom: displayScale, width: `${pageWidth}pt` }} onPointerUp={event => {
        if (!painter || !editor) return
        const format = painter
        const needsCell = Boolean(format.row || format.excelCell || format.excelRange)
        const cell = needsCell ? (event.target as HTMLElement).closest('td, th') : null
        if (needsCell && (!cell || !editor.view.dom.contains(cell))) return
        const destination = cell ? editor.view.posAtDOM(cell, 0) : null
        requestAnimationFrame(() => {
          if (editor.isDestroyed) return
          if (destination !== null) editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(destination))))
          const applied = editor.chain().focus().command(({ state, dispatch }) => paintFormat(format)(state, dispatch)).run()
          if (applied) setPainter(null)
        })
      }}><EditorContent editor={editor} /></div>
    </div>
  </section>
}
