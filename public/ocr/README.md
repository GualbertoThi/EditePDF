# OCR local de páginas vetoriais

Tesseract.js 7.0.0 e tesseract.js-core (versão registrada em `assets-manifest.json`). Worker e todas as variantes de core foram copiadas dos pacotes instalados. Os modelos `por` e `eng` vêm de https://github.com/tesseract-ocr/tessdata_fast (arquivos `main/por.traineddata` e `main/eng.traineddata`, obtidos em 28/09/2026).

Licenças distribuídas nesta pasta: TESSERACT-JS-LICENSE, CORE-LICENSE e LANGUAGE-LICENSE. Hashes dos arquivos em assets-manifest.json.

O app configura workerPath, corePath e langPath para esta pasta, gzip=false, sem CDN e sem cache de idioma externo. O servidor local entrega os arquivos; nenhum PDF é enviado para serviços de OCR. Configuração baseada na documentação oficial: https://github.com/naptha/tesseract.js/blob/master/docs/local-installation.md.

Ao atualizar os pacotes, atualize em conjunto worker.min.js, core/*.wasm.js, core/*.wasm e o manifesto. Não substitua apenas um dos arquivos. O build do Vite copia esta pasta para dist/ocr.

## Limites desta etapa

O OCR é ativado apenas quando há muitas faixas vetoriais compatíveis com letras desenhadas e quase nenhum texto nativo fora das margens. PDFs digitalizados, páginas vazias e documentos com texto extraível não acionam este caminho. Detecção conservadora: não garante identificar todos os tipos de texto vetorial.

O reconhecimento recebe uma renderização temporária, devolve palavras/coordenadas/confiança e alimenta o mesmo modelo editável. Textos nativos são preservados sem duplicação. Fontes, negrito e cores não são identificados com exatidão pelo OCR. Há falhas possíveis em nomes, identificadores, pontilhados e valores. Marcas gráficas como sinais de conferência continuam disponíveis no PDF original; não são transformadas em caracteres.

O reconhecimento é cancelável ao trocar de documento, limitado a 120 segundos por página, e a imagem temporária tem limite de 12 milhões de pixels. Nenhuma paginação automática, exportação ou OCR de documentos digitalizados foi adicionada.
