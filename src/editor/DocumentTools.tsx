import { useEffect, useRef, useState } from 'react'
import { useEditorState, type Editor } from '@tiptap/react'
import { TextSelection } from '@tiptap/pm/state'
import {
  currentPage, deleteCurrentPage, duplicateCurrentPage, insertBlankPage, moveCurrentPage,
  pageInfo, pointsPerCm, setPageMargins, setPageNumbers, type Margins,
} from './pageCommands.ts'
import { captureFormat, type PaintFormat } from './formatPainter.ts'
import { paintRowBackground, rowBackground, selectWholeRow } from './rowFormatting.ts'

const sides = [ ['marginTopPt', 'Superior'], ['marginBottomPt', 'Inferior'], ['marginLeftPt', 'Esquerda'], ['marginRightPt', 'Direita'] ] as const

type TextMatch = { from: number; to: number }

function findTextMatches(editor: Editor, query: string): TextMatch[] {
  const needle = query.trim().toLocaleLowerCase('pt-BR')
  if (!needle) return []
  const matches: TextMatch[] = []
  editor.state.doc.descendants((node, pos) => {
    if (!node.isTextblock) return
    const segments: { start: number; end: number; from: number }[] = []
    let text = ''
    node.descendants((child, childPos) => {
      if (!child.isText || !child.text) return
      const start = text.length
      text += child.text
      segments.push({ start, end: text.length, from: pos + 1 + childPos })
    })
    const haystack = text.toLocaleLowerCase('pt-BR')
    let offset = 0
    while (offset <= haystack.length - needle.length) {
      const found = haystack.indexOf(needle, offset)
      if (found < 0) break
      const last = found + needle.length
      const firstSegment = segments.find(segment => found >= segment.start && found < segment.end)
      const lastSegment = segments.find(segment => last > segment.start && last <= segment.end)
      if (firstSegment && lastSegment) matches.push({
        from: firstSegment.from + found - firstSegment.start,
        to: lastSegment.from + last - lastSegment.start,
      })
      offset = found + Math.max(1, needle.length)
    }
    return false
  })
  return matches
}

export function DocumentTools({ editor, ready, painter, onPainter, findSignal = 0 }: {
  editor: Editor | null
  ready: boolean
  painter: PaintFormat | null
  onPainter: (value: PaintFormat | null) => void
  findSignal?: number
}) {
  const [panel, setPanel] = useState<'margins' | 'numbers' | 'find' | 'insertPage' | null>(null)
  const [margins, setMargins] = useState<Record<keyof Margins, string>>({ marginTopPt: '0', marginBottomPt: '0', marginLeftPt: '0', marginRightPt: '0' })
  const [allPages, setAllPages] = useState(false)
  const [numberStart, setNumberStart] = useState('1')
  const [numberAlign, setNumberAlign] = useState<'left' | 'center' | 'right'>('center')
  const [message, setMessage] = useState('')
  const [loadingImage, setLoadingImage] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const [replaceText, setReplaceText] = useState('')
  const [matchIndex, setMatchIndex] = useState(0)
  const imageInput = useRef<HTMLInputElement>(null)
  const findInput = useRef<HTMLInputElement>(null)
  const state = useEditorState({ editor, selector: ({ editor: current }) => current ? {
    page: currentPage(current.state)?.node.attrs.sourcePage,
    pageInfo: pageInfo(current.state),
    image: current.isActive('localImage'),
    imageWidth: Number(current.getAttributes('localImage').widthPt) || 144,
    rowBackground: rowBackground(current.state),
    doc: current.state.doc,
  } : null })
  const matches = editor && findQuery.trim() ? findTextMatches(editor, findQuery) : []

  useEffect(() => {
    if (!findSignal) return
    setPanel('find')
    setMessage('')
    requestAnimationFrame(() => findInput.current?.focus())
  }, [findSignal])
  useEffect(() => {
    setMatchIndex(index => matches.length ? Math.min(index, matches.length - 1) : 0)
  }, [matches.length, findQuery])

  function goToMatch(index: number) {
    if (!editor || !matches.length) return
    const normalized = (index + matches.length) % matches.length
    const match = matches[normalized]
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, match.from, match.to)).scrollIntoView())
    editor.commands.focus()
    setMatchIndex(normalized)
  }

  function replaceMatch(index: number) {
    if (!editor || !matches.length) return
    const match = matches[Math.max(0, Math.min(index, matches.length - 1))]
    const marks = editor.state.doc.resolve(match.from).marks()
    const tr = editor.state.tr
    if (replaceText) tr.replaceWith(match.from, match.to, editor.state.schema.text(replaceText, marks))
    else tr.delete(match.from, match.to)
    const end = match.from + replaceText.length
    tr.setSelection(TextSelection.create(tr.doc, end)).scrollIntoView()
    editor.view.dispatch(tr)
    editor.commands.focus()
  }

  function replaceAllMatches() {
    if (!editor || !matches.length) return
    const tr = editor.state.tr
    for (const match of [...matches].reverse()) {
      const marks = editor.state.doc.resolve(match.from).marks()
      if (replaceText) tr.replaceWith(match.from, match.to, editor.state.schema.text(replaceText, marks))
      else tr.delete(match.from, match.to)
    }
    editor.view.dispatch(tr.scrollIntoView())
    editor.commands.focus()
    setMatchIndex(0)
  }


  async function insertImage(file?: File) {
    if (!file || !editor) return
    const documentAtStart = editor.state.doc
    const bookmark = editor.state.selection.getBookmark()
    setLoadingImage(true)
    setMessage('')
    try {
      if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) throw new Error('Escolha uma imagem PNG, JPEG, WebP ou GIF.')
      const src = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('Não foi possível ler a imagem.'))
        reader.readAsDataURL(file)
      })
      const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
        const image = new Image()
        image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
        image.onerror = () => reject(new Error('A imagem não pôde ser aberta.'))
        image.src = src
      })
      if (editor.isDestroyed || editor.state.doc !== documentAtStart) throw new Error('O documento mudou durante a leitura. Insira a imagem novamente.')
      editor.view.dispatch(editor.state.tr.setSelection(bookmark.resolve(editor.state.doc)))
      const page = currentPage(editor.state)?.node
      const available = page ? page.attrs.pageWidthPt - page.attrs.marginLeftPt - page.attrs.marginRightPt : 300
      const widthPt = Math.max(1, Math.min(dimensions.width * 0.75, available))
      if (!editor.chain().focus().insertContent({ type: 'localImage', attrs: { src, alt: file.name, widthPt } }).run()) throw new Error('Posicione o cursor no documento e tente novamente.')
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Não foi possível inserir a imagem.') }
    finally { setLoadingImage(false) }
  }

  const pageLabel = state?.pageInfo.index != null && state.pageInfo.index >= 0 ? `${state.pageInfo.index + 1}/${state.pageInfo.count}` : '—'

  return <div className="document-tools">
    <div className="format-toolbar secondary-toolbar" aria-label="Página e inserção" onMouseDown={event => { if ((event.target as HTMLElement).closest('button')) event.preventDefault() }}>
      <button disabled={!ready} title="Localizar e substituir (Ctrl+F)" aria-expanded={panel === 'find'} onClick={() => { setPanel(panel === 'find' ? null : 'find'); setMessage(''); requestAnimationFrame(() => findInput.current?.focus()) }}>Localizar</button>
      <span className="toolbar-separator" aria-hidden="true" />
      <button disabled={!ready || !state?.page} aria-expanded={panel === 'margins'} onClick={() => {
        const page = editor && currentPage(editor.state)
        if (!page) return
        setMargins(Object.fromEntries(sides.map(([key]) => [key, String(Number((page.node.attrs[key] / pointsPerCm).toFixed(3)))])) as Record<keyof Margins, string>)
        setPanel(panel === 'margins' ? null : 'margins'); setMessage('')
      }}>Margens</button>
      <button disabled={!ready} aria-expanded={panel === 'numbers'} onClick={() => {
        const page = editor?.state.doc.firstChild
        setNumberStart(String(page?.attrs.pageNumber ?? 1))
        setNumberAlign(page?.attrs.pageNumberAlignment || 'center')
        setPanel(panel === 'numbers' ? null : 'numbers'); setMessage('')
      }}>Nº página</button>
      <button disabled={!ready || !state?.page} title={`Duplicar página atual (${pageLabel})`} onClick={() => editor?.chain().focus().command(({ state, dispatch }) => duplicateCurrentPage()(state, dispatch)).run()}>Duplicar pág.</button>
      <button disabled={!ready || !state?.pageInfo.canDelete} title={`Excluir página atual (${pageLabel})`} onClick={() => {
        if (!window.confirm(`Excluir a página ${state?.pageInfo.index != null ? state.pageInfo.index + 1 : ''}? Você poderá usar Desfazer se mudar de ideia.`)) return
        editor?.chain().focus().command(({ state, dispatch }) => deleteCurrentPage()(state, dispatch)).run()
      }}>Excluir pág.</button>
      <button disabled={!ready || !state?.pageInfo.canMoveUp} title="Mover página para cima" aria-label="Mover página para cima" onClick={() => editor?.chain().focus().command(({ state, dispatch }) => moveCurrentPage(-1)(state, dispatch)).run()}>Pág. ↑</button>
      <button disabled={!ready || !state?.pageInfo.canMoveDown} title="Mover página para baixo" aria-label="Mover página para baixo" onClick={() => editor?.chain().focus().command(({ state, dispatch }) => moveCurrentPage(1)(state, dispatch)).run()}>Pág. ↓</button>
      <button disabled={!ready || !state?.page} title="Inserir página em branco" aria-expanded={panel === 'insertPage'} onClick={() => { setPanel(panel === 'insertPage' ? null : 'insertPage'); setMessage('') }}>+ Página</button>
      <span className="toolbar-page-count" title="Página atual">{pageLabel}</span>
      <span className="toolbar-separator" aria-hidden="true" />
      <button disabled={!ready || loadingImage || !state?.page} onClick={() => imageInput.current?.click()}>{loadingImage ? 'Inserindo…' : 'Imagem'}</button>
      <input ref={imageInput} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp,image/gif" aria-label="Arquivo de imagem" onChange={event => { void insertImage(event.target.files?.[0]); event.target.value = '' }} />
      <button disabled={!ready} aria-pressed={Boolean(painter && !painter.excelRange)} title="Pincel de formatação" onClick={() => onPainter(painter ? null : editor ? captureFormat(editor.state) : null)}>Pincel</button>
      <button disabled={!ready || state?.rowBackground == null} title="Selecionar linha inteira" onClick={() => editor?.chain().focus().command(({ state, dispatch }) => selectWholeRow(state, dispatch)).run()}>Sel. linha</button>
      <label className="format-field compact-color">Fundo
        <input type="color" aria-label="Cor de fundo da linha inteira" disabled={!ready || state?.rowBackground == null} value={/^#[\da-f]{6}$/i.test(state?.rowBackground || '') ? state!.rowBackground : '#ffffff'} onChange={event => editor?.chain().focus().command(({ state, dispatch }) => paintRowBackground(event.target.value)(state, dispatch)).run()} />
      </label>
      <button disabled={!ready || state?.rowBackground == null} onClick={() => editor?.chain().focus().command(({ state, dispatch }) => paintRowBackground('transparent')(state, dispatch)).run()}>Sem fundo</button>
      {state?.image && <>
        <button onClick={() => editor?.chain().focus().updateAttributes('localImage', { widthPt: Math.max(12, state.imageWidth * 0.8) }).run()}>Imagem −</button>
        <button onClick={() => editor?.chain().focus().updateAttributes('localImage', { widthPt: Math.min(2000, state.imageWidth * 1.25) }).run()}>Imagem +</button>
        <button onClick={() => editor?.chain().focus().deleteSelection().run()}>Remover imagem</button>
      </>}
    </div>
    {panel === 'find' && <form className="page-settings find-replace" onSubmit={event => { event.preventDefault(); goToMatch(matchIndex + 1) }}>
      <strong>Localizar e substituir</strong>
      <label>Localizar<input ref={findInput} type="text" value={findQuery} onChange={event => { setFindQuery(event.target.value); setMatchIndex(0) }} /></label>
      <span className="match-count">{findQuery.trim() ? `${matches.length ? matchIndex + 1 : 0}/${matches.length}` : '0/0'}</span>
      <button type="button" disabled={!matches.length} onClick={() => goToMatch(matchIndex - 1)}>Anterior</button>
      <button type="submit" disabled={!matches.length}>Próximo</button>
      <label>Substituir por<input type="text" value={replaceText} onChange={event => setReplaceText(event.target.value)} /></label>
      <button type="button" disabled={!matches.length} onClick={() => replaceMatch(matchIndex)}>Substituir</button>
      <button type="button" disabled={!matches.length} onClick={replaceAllMatches}>Substituir tudo</button>
      <button type="button" onClick={() => setPanel(null)}>Fechar</button>
    </form>}
    {panel === 'insertPage' && <div className="page-settings compact-panel">
      <strong>Inserir página em branco</strong>
      <button type="button" onClick={() => { editor?.chain().focus().command(({ state, dispatch }) => insertBlankPage(false)(state, dispatch)).run(); setPanel(null) }}>Antes da atual</button>
      <button type="button" onClick={() => { editor?.chain().focus().command(({ state, dispatch }) => insertBlankPage(true)(state, dispatch)).run(); setPanel(null) }}>Depois da atual</button>
      <button type="button" onClick={() => setPanel(null)}>Cancelar</button>
    </div>}
    {panel === 'margins' && <form className="page-settings" onSubmit={event => {
      event.preventDefault()
      const values = Object.fromEntries(sides.map(([key]) => [key, margins[key].trim() ? Number(margins[key]) * pointsPerCm : NaN])) as Margins
      const applied = editor?.chain().focus().command(({ state, dispatch }) => setPageMargins(values, allPages)(state, dispatch)).run()
      if (applied) { setPanel(null); setMessage('') } else setMessage('Revise as margens: deve restar pelo menos 2,54 cm de largura e altura para o conteúdo.')
    }}>
      <strong>Margens em cm — página {state?.pageInfo.index != null && state.pageInfo.index >= 0 ? state.pageInfo.index + 1 : state?.page}</strong>
      {sides.map(([key, label]) => <label key={key}>{label}<input type="number" min="0" step="0.001" required value={margins[key]} onChange={event => setMargins({ ...margins, [key]: event.target.value })} /></label>)}
      <label><input type="checkbox" checked={allPages} onChange={event => setAllPages(event.target.checked)} /> Todas as páginas</label>
      <button type="submit">Aplicar margens</button><button type="button" onClick={() => setPanel(null)}>Cancelar</button>
    </form>}
    {panel === 'numbers' && <form className="page-settings" onSubmit={event => {
      event.preventDefault()
      if (editor?.chain().focus().command(({ state, dispatch }) => setPageNumbers(true, Number(numberStart), numberAlign)(state, dispatch)).run()) { setPanel(null); setMessage('') }
    }}>
      <strong>Numeração no rodapé de todas as páginas</strong>
      <label>Iniciar em<input type="number" min="1" max="9999" step="1" required value={numberStart} onChange={event => setNumberStart(event.target.value)} /></label>
      <label>Posição<select value={numberAlign} onChange={event => setNumberAlign(event.target.value as typeof numberAlign)}><option value="left">Esquerda</option><option value="center">Centro</option><option value="right">Direita</option></select></label>
      <button type="submit">Aplicar numeração</button>
      <button type="button" onClick={() => { editor?.chain().focus().command(({ state, dispatch }) => setPageNumbers(false, 1, numberAlign)(state, dispatch)).run(); setPanel(null) }}>Remover numeração</button>
      <button type="button" onClick={() => setPanel(null)}>Cancelar</button>
    </form>}
    {painter && <p className="tool-notice" role="status">{painter.row ? 'Clique na linha de destino: o texto será substituído, junto com os fundos, bordas e formatação. Use linhas com a mesma estrutura de células. Esc cancela.' : 'Selecione o texto de destino para aplicar o formato do início da seleção de origem. Para copiar uma linha completa, use Selecionar linha antes de ativar o pincel. Esc cancela.'}</p>}
    {message && <p className="tool-notice" role="alert">{message}</p>}
  </div>
}
