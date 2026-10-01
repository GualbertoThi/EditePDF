import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, extname, sep } from 'node:path'
import { localPdfExport } from './pdfExport.mjs'

export async function startServer(root) {
  const plugin = localPdfExport()
  plugin.configResolved({ root })
  let exporter
  plugin.configureServer({ middlewares: { use(handler) { exporter = handler } } })
  const directory = resolve(root, 'dist')
  const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.wasm':'application/wasm', '.png':'image/png', '.svg':'image/svg+xml', '.woff2':'font/woff2', '.woff':'font/woff', '.ttf':'font/ttf' }
  const server = createServer((req, res) => {
    if (req.headers.host !== `127.0.0.1:${server.address().port}`) { res.writeHead(403).end(); return }
    exporter(req, res, async () => {
      if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405).end(); return }
      try {
        const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
        const file = resolve(directory, '.' + (pathname === '/' ? '/index.html' : pathname))
        if (!file.startsWith(directory + sep)) { res.writeHead(403).end(); return }
        const bytes = await readFile(file)
        res.writeHead(200, { 'Content-Type':types[extname(file)] || 'application/octet-stream', 'Content-Length':bytes.length, 'Cache-Control':'no-store' })
        res.end(req.method === 'HEAD' ? undefined : bytes)
      } catch { res.writeHead(404).end('Arquivo não encontrado.') }
    })
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  return { server, origin:`http://127.0.0.1:${server.address().port}` }
}
