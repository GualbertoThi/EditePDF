# EditePDF

**Edição de PDF local para Windows.**

Projeto independente de editor de PDF desenvolvido com **React, TypeScript, Vite, Electron, Tiptap/ProseMirror, PDF.js e pdf-lib**, com foco em edição estrutural do documento e preservação visual.

> O objetivo do projeto é explorar um problema difícil na prática: transformar conteúdo extraído de PDFs em uma estrutura realmente editável, sem reduzir o documento a uma simples camada de anotações.

## Visão geral

O EditePDF começou como uma prova de conceito para edição direta de PDFs e evoluiu para uma aplicação desktop com fluxo próprio de importação, reconstrução, edição e exportação.

A aplicação trabalha localmente no Windows e reúne recursos para:

- editar texto e formatação;
- manipular tabelas;
- inserir, mover e redimensionar imagens;
- duplicar, excluir, inserir e reordenar páginas;
- localizar e substituir conteúdo;
- copiar e colar preservando estrutura;
- colar conteúdo tabular vindo do Excel;
- exportar uma nova cópia em PDF.

## Demonstração

A landing page publicada pode ser acessada em **[gualbertothi.github.io/EditePDF](https://gualbertothi.github.io/EditePDF/)**.

O código-fonte da página está versionado na pasta [`site/`](./site/).

Ela usa conteúdo inteiramente sintético. Nenhum documento real usado durante o desenvolvimento faz parte da versão pública.

## Arquitetura

O projeto separa visualização, reconstrução editável e exportação.

```text
PDF
 ↓
PDF.js
 ↓
extração de texto, imagens e geometria
 ↓
reconstrução em árvore editável
 ↓
Tiptap / ProseMirror
 ↓
edição no React
 ↓
exportação de nova cópia em PDF
```

### Aplicação desktop

O build desktop usa Electron. Em produção, a interface é servida localmente pelo próprio aplicativo e aberta em uma `BrowserWindow`.

O empacotamento portátil para Windows é feito com `electron-builder`.

### Documento editável

O estado editável usa uma árvore canônica baseada em ProseMirror. Estilos e metadados de origem do PDF são preservados sempre que possível para permitir reconstrução e exportação.

Essa decisão evita manter duas representações editáveis concorrentes do mesmo documento.

## Decisões técnicas

### PDF original separado da edição

O PDF original permanece disponível como referência visual. A área editável é uma reconstrução estruturada, não uma anotação aplicada sobre a página original.

### Imagens editáveis

Imagens podem ser inseridas, redimensionadas e reposicionadas. Elementos flutuantes não precisam reservar espaço no fluxo de texto.

### Tabelas

O editor trata tabelas como estruturas reais, com operações de linha, coluna, fundo e conteúdo.

### Cópia interna

O fluxo de cópia e colagem interno preserva atributos estruturais e formatação do documento editável.

### Conteúdo vindo do Excel

Há tratamento específico para HTML copiado do Excel, incluindo células, preenchimentos, bordas, alinhamento e dimensões quando disponíveis.

## Tecnologias

- React
- TypeScript
- Vite
- Electron
- Tiptap / ProseMirror
- PDF.js
- pdf-lib
- Tesseract.js
- Playwright
- electron-builder

## Testes públicos

A versão pública não utiliza documentos reais.

Os fixtures em `fixtures-public/` foram criados especificamente para o projeto e cobrem cenários como:

- tabelas;
- formulários;
- imagem incorporada;
- múltiplas páginas;
- página vazia;
- dimensões de página diferentes.

Os testes públicos ficam em `tests-public/`.

```bat
node --experimental-strip-types --test tests-public\*.test.mjs
```

## Executar localmente

```bat
npm ci
npm run dev
```

Build web:

```bat
npm run build
```

Build desktop portátil para Windows:

```bat
npm run desktop:build
```

## Estado do projeto

O EditePDF é um projeto em evolução. PDFs podem variar muito em estrutura interna, então fidelidade de importação e reconstrução ainda depende do documento de origem.

Antes de uma nova versão pública, o executável deve ser validado em mais de um computador Windows.

## Privacidade

A aplicação desktop foi projetada para processamento local. O servidor interno usa `127.0.0.1`, e a janela Electron restringe navegação e requisições HTTP externas durante a execução normal.

## Estrutura do repositório

```text
src/                aplicação React e editor
server/             exportação e serviços locais
desktop/            empacotamento Electron
public/             recursos locais do aplicativo
fixtures-public/    PDFs sintéticos para testes
tests-public/       testes publicáveis
site/               página de apresentação
.github/            templates e GitHub Pages
```

## Segurança dos dados de teste

O repositório público foi preparado separadamente do ambiente privado de desenvolvimento.

Documentos reais, backups, histórico privado, prompts internos e materiais usados durante testes não fazem parte desta cópia pública.

## Licença

A licença do projeto deve ser definida antes da publicação definitiva. Consulte [`PUBLICAR.md`](./PUBLICAR.md).
