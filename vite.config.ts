import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { localPdfExport } from './server/pdfExport.ts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), localPdfExport()],
  build: { rollupOptions: { input: { main: 'index.html', pdfExport: 'pdf-export.html' } } },
})
