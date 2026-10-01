import { getSchema } from '@tiptap/react'
import { documentExtensions } from '../document-model/schema'
import { preparePdfPrint } from './printDocument'

Object.assign(window, { renderPdfModel: async (json: object, name: string) => {
  const model = getSchema(documentExtensions()).nodeFromJSON(json)
  model.descendants(node => {
    if (node.type.name === 'localImage' && !/^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(String(node.attrs.src))) throw new Error('A imagem deve estar armazenada no documento.')
  })
  const prepared = await preparePdfPrint(model, name)
  const source = prepared.frame.contentDocument!
  const width = Math.max(...prepared.pages.map(p => p.widthPt))
  const height = Math.max(...prepared.pages.map(p => p.heightPt))
  for (const style of source.querySelectorAll('style')) document.head.append(style.cloneNode(true))
  const stack = source.querySelector('.document-stack')!
  document.body.append(document.importNode(stack, true))
  for (const sheet of document.querySelectorAll<HTMLElement>('.document-sheet')) {
    const wrapper = document.createElement('div')
    wrapper.className = 'pdf-output-sheet'
    sheet.before(wrapper); wrapper.append(sheet)
  }
  const style = document.createElement('style')
  style.textContent = `@page {size:${width}pt ${height}pt;margin:0} .document-sheet{page:auto!important;break-after:auto!important} .pdf-output-sheet{width:${width}pt;height:${height}pt;display:flow-root;break-after:page;break-inside:avoid}.pdf-output-sheet:last-child{break-after:auto}`
  document.head.append(style)
  prepared.dispose()
  void document.body.offsetHeight
  await document.fonts.ready
  await Promise.all(Array.from(document.images).map(image => image.decode()))
  return prepared.pages
} })
