import { app, BrowserWindow, dialog, Menu } from 'electron'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from './server.mjs'

let window, server
if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus() } })
  app.whenReady().then(async () => {
    const root = app.isPackaged ? process.resourcesPath : resolve(dirname(fileURLToPath(import.meta.url)), '..')
    const local = await startServer(root)
    server = local.server
    Menu.setApplicationMenu(null)
    window = new BrowserWindow({ width:1440, height:960, minWidth:900, minHeight:640, title:'PDF Editor', show:false,
      webPreferences:{ nodeIntegration:false, contextIsolation:true, sandbox:true, spellcheck:false } })
    window.webContents.setWindowOpenHandler(() => ({ action:'deny' }))
    window.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== local.origin) event.preventDefault() })
    const session = window.webContents.session
    session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    session.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel:/^https?:/.test(details.url) && new URL(details.url).origin !== local.origin })
    })
    session.on('will-download', (_event, item) => { item.setSaveDialogOptions({ title:'Salvar cópia editada', defaultPath:item.getFilename() }) })
    window.once('ready-to-show', () => { window.maximize(); window.show() })
    await window.loadURL(local.origin)
  }).catch(error => { dialog.showErrorBox('Não foi possível abrir o PDF Editor', error.message); app.quit() })
  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', () => { server?.closeAllConnections(); server?.close() })
}
