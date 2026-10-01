# Salvar a cópia editada

Com `npm.cmd run dev` em execução, abra o documento, faça as edições e clique em **Salvar cópia PDF** ou **Exportar PDF**. Ambos baixam `nome - editado.pdf`. O PDF original não é sobrescrito.

A geração usa apenas um snapshot do documento ProseMirror, seus estilos e recursos incorporados. O Chromium local renderiza texto, tabelas e imagens; o pdf-lib ajusta as dimensões de cada folha. Não há envio do documento à internet. O texto continua selecionável no PDF; imagens e conteúdo originalmente rasterizado permanecem imagens.

O servidor deve ser reiniciado após esta instalação. Também é possível executar `npm.cmd run build` e `npm.cmd run preview`. Abrir apenas os arquivos de `dist` em hospedagem estática não fornece o gerador local.

Playwright e seu Chromium estão instalados para esta versão. Os binários ficam em `.local-browsers`, que precisa acompanhar a instalação local. Para reinstalação autorizada: definir `PLAYWRIGHT_BROWSERS_PATH` para essa pasta antes de `playwright install chromium --only-shell`.

As folhas mantêm a largura do editor. Conteúdo que excede essa largura é reduzido proporcionalmente apenas na cópia exportada, preservando as margens. A mensagem de conclusão informa as páginas ajustadas e a escala aplicada. A altura acompanha o conteúdo ajustado, respeitando a altura mínima original. Não há repaginação automática para A4. O ajuste pode diminuir o texto e não corrige sobreposições que já existiam no editor. Fontes substituídas durante a importação e possíveis erros de OCR continuam como aparecem no editor.

Salvar PDF não salva um projeto reabrível sem reconstrução: ao importar a cópia, ela passa novamente pelo importador PDF. As edições da sessão continuam sendo descartadas ao recarregar ou abrir outro arquivo.

Validação: `node --test tests/*.test.mjs`; build; `.review/test-local-export.mjs` com servidor local na porta 5174 verifica geometria contra o editor, tamanhos mistos, texto editado reextraído, fundos e imagens no PDF renderizado.
