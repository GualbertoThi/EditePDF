import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'
import { getSchema } from '@tiptap/react'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { documentExtensions } from '../src/document-model/schema.ts'
import { extractPage } from '../src/pdf-importer/extractPage.ts'
import { reconstructPage } from '../src/pdf-importer/reconstructPage.ts'
import { importDocument } from '../src/pdf-importer/importDocument.ts'

const schema = getSchema(documentExtensions())

async function open(name) {
  const data = new Uint8Array(fs.readFileSync(`fixtures-public/${name}`))
  const task = getDocument({ data, useSystemFonts: true, verbosity: 0 })
  return { task, pdf: await task.promise }
}

test('relatorio sintetico preserva texto e estrutura editavel', async () => {
  const { task, pdf } = await open('relatorio_tabela.pdf')
  try {
    const result = reconstructPage(await extractPage(pdf, 1))
    const doc = schema.nodeFromJSON(result.content)
    doc.check()
    assert.ok(doc.textContent.includes('Relatorio de Movimentacoes'))
    assert.ok(doc.textContent.includes('Lancamento sintetico A'))
    assert.ok(result.summary.tables >= 1)
  } finally { await task.destroy() }
})

test('formulario sintetico preserva campos e itens', async () => {
  const { task, pdf } = await open('formulario_campos.pdf')
  try {
    const result = reconstructPage(await extractPage(pdf, 1))
    const doc = schema.nodeFromJSON(result.content)
    doc.check()
    assert.ok(doc.textContent.includes('Formulario de Cadastro'))
    assert.ok(doc.textContent.includes('Item sintetico 5'))
    assert.ok(result.summary.tables >= 1)
  } finally { await task.destroy() }
})

test('cabecalho sintetico preserva imagem e textos', async () => {
  const { task, pdf } = await open('cabecalho_imagem.pdf')
  try {
    const raw = await extractPage(pdf, 1, async () => 'data:image/png;base64,AA==')
    assert.ok(raw.runs.some(run => run.text.includes('ORGANIZACAO DEMONSTRATIVA')))
    assert.ok(raw.images.length >= 1)
  } finally { await task.destroy() }
})

test('documento multipagina preserva ordem, pagina vazia e tamanho diferente', async () => {
  const { task, pdf } = await open('multiplas_paginas.pdf')
  try {
    const result = await importDocument(pdf)
    const doc = schema.nodeFromJSON(result.content)
    doc.check()
    assert.equal(doc.childCount, 3)
    assert.ok(doc.child(0).textContent.includes('Pagina 1'))
    assert.equal(doc.child(1).textContent, '')
    assert.ok(doc.child(2).textContent.includes('Pagina 3'))
    assert.equal(Math.round(doc.child(2).attrs.pageWidthPt), 500)
    assert.equal(Math.round(doc.child(2).attrs.pageHeightPt), 360)
  } finally { await task.destroy() }
})
