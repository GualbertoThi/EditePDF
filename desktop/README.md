# PDF Editor — aplicativo Windows

O executável de distribuição será `release/PDF-Editor.exe` (Windows x64). É portátil: abre uma janela própria com a interface existente, sem ZIP ou instalador. Extrai recursos temporários automaticamente durante a execução. O servidor usa somente 127.0.0.1 e uma porta livre; não precisa de Vite, Node ou navegador instalados no computador de destino.

## Arquivos do empacotamento

- `desktop/main.mjs`: janela Electron, instância única, download e encerramento do servidor.
- `desktop/server.mjs`: arquivos da interface compilada e integração com o exportador existente.
- `desktop/prepare.mjs`: geração da configuração e compilação do serviço TypeScript sem modificar sua lógica.
- `desktop/pdfExport.mjs` e `desktop/builder.generated.json`: gerados pelo preparo.
- `package.json` / `package-lock.json`: dependências Electron/electron-builder autorizadas e comandos de build.

Nenhum arquivo em `src/` ou `server/pdfExport.ts` foi alterado nesta etapa. Os PDFs do usuário, backups, capturas e arquivos de teste não fazem parte da distribuição. OCR, fontes, Chromium e licenças das dependências acompanham o pacote.

## Gerar novamente

`npm.cmd run desktop:build`

Nesta sessão foi necessário baixar uma cópia oficial do Node para `.desktop-tools/`, pois o runtime anterior não estava disponível. O hash foi conferido com o SHASUMS256 oficial. Ferramentas/cache de build ficam no workspace e não são distribuídos.

## Teste automatizado

`.review/test-desktop.mjs`: inicia o aplicativo empacotado, importa `resumo.pdf`, verifica as tabelas de 10/4/5 linhas, insere `TESTE EXE`, exporta o PDF e confere cinco páginas. A cópia exportada foi reaberta com PDF.js e o texto inserido foi encontrado.

O teste executa com um perfil próprio em `.review/`. Não usa as edições pessoais da sessão do navegador.

Este build de teste não tem assinatura digital comercial. Não equivale a uma certificação de compatibilidade com todo computador Windows; ainda deve ser validado na máquina de destino.
