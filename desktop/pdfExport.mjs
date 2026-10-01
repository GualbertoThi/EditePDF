import { PDFDocument } from 'pdf-lib';
import { resolve } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
export function localPdfExport() {
    let projectRoot = process.cwd();
    let busy = false;
    const middleware = async (req, res, next) => {
        if (req.url !== '/api/export-pdf')
            return next();
        const host = req.headers.host || '';
        const origin = `http://${host}`;
        const remote = req.socket.remoteAddress || '';
        if (!/^(localhost|127\.0\.0\.1):\d+$/.test(host) || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote) || req.headers.origin !== origin) {
            res.writeHead(403).end('A exportação exige acesso local.');
            return;
        }
        if (req.method !== 'POST') {
            res.writeHead(405).end();
            return;
        }
        if (busy) {
            res.writeHead(503).end('Outra exportação está em andamento.');
            return;
        }
        busy = true;
        let browser;
        let timer;
        try {
            const chunks = [];
            let size = 0;
            for await (const chunk of req) {
                size += chunk.length;
                if (size > 100 * 1024 * 1024)
                    throw new Error('Documento muito grande para esta exportação (limite de 100 MB).');
                chunks.push(chunk);
            }
            const { model, name } = JSON.parse(Buffer.concat(chunks).toString());
            if (model?.type !== 'doc' || typeof name !== 'string')
                throw new Error('Documento inválido.');
            const manifest = JSON.parse(readFileSync(resolve(projectRoot, 'node_modules/playwright-core/browsers.json'), 'utf8'));
            const revision = manifest.browsers.find((entry) => entry.name === 'chromium-headless-shell')?.revision;
            const executablePath = resolve(projectRoot, `.local-browsers/chromium_headless_shell-${revision}/chrome-headless-shell-win64/chrome-headless-shell.exe`);
            if (!existsSync(executablePath))
                throw new Error('O Chromium local desta versão não foi encontrado na pasta .local-browsers do projeto.');
            const { chromium } = await import('playwright');
            // Explicit path also works when Vite has already loaded Playwright before this request.
            browser = await chromium.launch({ headless: true, executablePath });
            timer = setTimeout(() => { void browser?.close(); }, 120_000);
            const page = await browser.newPage();
            await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
            await page.goto(`${origin}/pdf-export.html`);
            await page.waitForFunction('typeof window.renderPdfModel === "function"');
            const pages = await page.evaluate(async ({ model, name }) => {
                return await globalThis.renderPdfModel(model, name);
            }, { model, name });
            const bytes = await page.pdf({ printBackground: true, preferCSSPageSize: true, displayHeaderFooter: false });
            const pdf = await PDFDocument.load(bytes);
            if (pdf.getPageCount() !== pages.length)
                throw new Error('A paginação mudou durante a geração. O PDF não foi salvo para evitar cortes.');
            pdf.getPages().forEach((sheet, i) => {
                const { widthPt, heightPt } = pages[i];
                const bottom = sheet.getHeight() - heightPt;
                sheet.setMediaBox(0, bottom, widthPt, heightPt);
                sheet.setCropBox(0, bottom, widthPt, heightPt);
            });
            pdf.setTitle(name.replace(/\.pdf$/i, '') + ' - editado');
            pdf.setCreator('PDF Editor');
            const output = Buffer.from(await pdf.save());
            const adjusted = pages.flatMap((page, i) => page.scale < 1 ? [`${i + 1}: ${Math.round(page.scale * 100)}%`] : []).join(', ');
            res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': output.length, 'Cache-Control': 'no-store', 'X-PDF-Auto-Fit': adjusted }).end(output);
        }
        catch (error) {
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end(error instanceof Error ? error.message : 'Falha ao gerar PDF.');
        }
        finally {
            clearTimeout(timer);
            await browser?.close().catch(() => { });
            busy = false;
        }
    };
    return { name: 'local-pdf-export', configResolved(config) { projectRoot = config.root; }, configureServer(server) { server.middlewares.use(middleware); }, configurePreviewServer(server) { server.middlewares.use(middleware); } };
}
