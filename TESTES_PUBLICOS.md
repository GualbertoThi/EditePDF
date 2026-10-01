# Testes públicos do EditePDF

Esta pasta contém apenas documentos e testes sintéticos. Nenhum PDF, planilha, nome, conta, valor ou documento usado no ambiente de trabalho foi reutilizado.

## Conteúdo

`fixtures-public/`

- `relatorio_tabela.pdf`: relatório fictício com tabela e preenchimentos;
- `formulario_campos.pdf`: formulário fictício com caixas e tabela;
- `cabecalho_imagem.pdf`: cabeçalho fictício com imagem incorporada;
- `multiplas_paginas.pdf`: documento de três páginas, incluindo uma página vazia e uma página com tamanho diferente;
- `marca_teste.png`: imagem gráfica criada apenas para o fixture público.

`tests-public/`

- testes unitários seguros reaproveitados do projeto;
- `synthetic-fixtures.test.mjs`, que valida importação dos quatro PDFs fictícios.

## Executar

Na raiz do projeto, depois de `npm ci`:

```bat
node --experimental-strip-types --test tests-public\*.test.mjs
```

Se a versão do Node usada pelo projeto mudar, mantenha o mesmo comando de testes até validar uma alteração deliberada.

## Regra de publicação

Não adicionar arquivos reais a `fixtures-public/`.

Todo novo fixture deve ser:
- gerado especificamente para o projeto;
- livre de dados pessoais;
- livre de dados do trabalho;
- livre de brasões, documentos administrativos e nomes de organizações reais;
- pequeno o suficiente para permanecer versionado no Git.
