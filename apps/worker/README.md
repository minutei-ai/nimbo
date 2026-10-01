# Worker

Worker TypeScript com Effect v4 que executa o motor Rust/QuickJS em Wasm.
Expõe `GET /health` e `POST /scrape`, autenticado pelo secret `API_TOKEN`.
O binding opcional `EGRESS` fornece transporte HTTP; sem ele, usa fetch direto.

O campo opcional `scripts` aceita `execute` (padrão) ou `skip` para extração
do HTML recebido sem executar scripts da página. Veja capacidades e limites
no [README da raiz](../../README.md).

Build e testes em workerd: `bun run build:worker` e `bun run test:worker`
na raiz. Deploy e transporte operacional exigem configuração privada e
validação independente.

O código em `src/` usa o `tsconfig.json` deste pacote. Lint, formatação e checks
são executados na raiz do monorepo.
