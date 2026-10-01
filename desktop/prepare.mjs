import fs from 'node:fs'
import ts from 'typescript'
// Reuse the validated Vite export implementation, stripping TypeScript only.
fs.writeFileSync('desktop/pdfExport.mjs',ts.transpileModule(fs.readFileSync('server/pdfExport.ts','utf8'),{
 compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.ESNext}
}).outputText)
const manifest=JSON.parse(fs.readFileSync('node_modules/playwright-core/browsers.json','utf8'))
const revision=manifest.browsers.find(b=>b.name==='chromium-headless-shell').revision
const browser=`.local-browsers/chromium_headless_shell-${revision}`
if(!fs.existsSync(`${browser}/chrome-headless-shell-win64/chrome-headless-shell.exe`))throw Error('Chromium local ausente')
fs.writeFileSync('desktop/builder.generated.json',JSON.stringify({
 appId:'local.pdfeditor.desktop',productName:'PDF Editor',directories:{output:'release'},
 electronVersion:JSON.parse(fs.readFileSync('node_modules/electron/package.json','utf8')).version,
 extraMetadata:{main:'desktop/main.mjs',version:'0.1.0',description:'Editor local de PDF'},
 asar:false,npmRebuild:false,files:['desktop/main.mjs','desktop/server.mjs','desktop/pdfExport.mjs','package.json'],
 extraResources:[{from:'dist',to:'dist'},{from:browser,to:browser},
 {from:'node_modules/playwright',to:'node_modules/playwright'},
 {from:'node_modules/playwright-core',to:'node_modules/playwright-core'},
 {from:'node_modules/pdf-lib',to:'node_modules/pdf-lib'}],
 win:{target:[{target:'portable',arch:['x64']}],signExecutable:false,artifactName:'PDF-Editor.exe'},
 portable:{requestExecutionLevel:'user',unpackDirName:false}
},null,2))
console.log('Configuração pronta para o executável único.')



