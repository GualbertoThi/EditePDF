# Contribuindo

Obrigado pelo interesse em contribuir com o EditePDF.

## Antes de alterar código

1. Abra uma issue descrevendo o problema ou melhoria.
2. Trabalhe em uma mudança pequena e claramente delimitada.
3. Evite refatorações sem relação com o objetivo da alteração.
4. Preserve comportamentos já validados.
5. Inclua teste ou evidência de validação quando a alteração afetar importação, edição ou exportação de documentos.

## Ambiente

```bash
npm ci
npm run dev
```

Antes de enviar uma mudança:

```bash
npm run build
npm run lint
```

## Pull requests

O pull request deve explicar:

- o problema;
- o que foi alterado;
- o que não foi alterado;
- como a mudança foi testada;
- possíveis impactos ou limitações.

Não inclua documentos reais com dados pessoais, internos ou confidenciais em testes, screenshots ou issues.
