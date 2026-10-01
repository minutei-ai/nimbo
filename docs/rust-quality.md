# Rust: qualidade e desempenho

Pesquisa e validação local em 2026-10-01. A política está em `Cargo.toml`, herdada
pelos crates com `[lints] workspace = true`. `bun run check` roda localmente e no
CI: formato, Oxlint/Effect/Go, Clippy, testes, rustdoc e testes em release.

## Política de lint

`clippy::all` e `clippy::pedantic` são erros, incluindo as regras de performance
do grupo `all`. Regras selecionadas de `restriction` bloqueiam unwrap/expect,
pânico explícito, casts com `as`, índices sem checagem, aritmética que pode falhar,
erros descartados, saída abrupta, vazamentos explícitos e grandes alocações na
pilha. `nursery` acrescenta checks de clones, coletas desnecessárias e locks.
Documentação pública, links rustdoc e expectativas de lint também são verificados.

A [documentação do Clippy](https://doc.rust-lang.org/stable/clippy/index.html)
recomenda selecionar `restriction` individualmente: habilitar o grupo inteiro
introduz regras contraditórias. `nursery` contém regras em desenvolvimento; cada
regra habilitada foi executada contra o MVP. A versão Rust está fixada em 1.96.0.

Exceções usam `#[expect(..., reason = "...")]` no ponto necessário. Uma exceção
que deixa de ser usada falha por `unfulfilled_lint_expectations`. No momento há
duas: diagnóstico stderr quando a própria escrita falha e falha de thread na
limpeza das fixtures. Não há `allow` global. Os probes executam Clippy real e
comprovam rejeição de unsafe, unwrap, casts, índices, aritmética e Result ignorado.

`unsafe_code = "forbid"` cobre o código Rust próprio; dependências e o código C
do QuickJS têm seus próprios contratos. Clippy não comprova ausência de falhas
nessas dependências, nem substitui testes de execução.

## Build e otimizações implementadas

Release usa `opt-level = 3`, ThinLTO, uma unidade de codegen e remoção de debuginfo.
Mantém overflow checks e unwinding. O perfil `profiling` mantém símbolos para
investigar gargalos. Conforme o [Cargo Book](https://doc.rust-lang.org/cargo/reference/profiles.html),
o nível de otimização não garante desempenho superior em todo workload. O ganho
medido abaixo combina mudanças de código e perfil; não isola o efeito do LTO.

- `querySelector` procura somente o primeiro resultado, sem materializar todos os
  elementos nem enviar milhares de handles ao QuickJS.
- Seletores compilados são reutilizados por página: até 64 chaves de no máximo
  512 bytes. Seletores maiores continuam válidos, sem retenção no cache. Resultados
  não são cacheados; alterações e remoções do DOM permanecem visíveis.
- `querySelectorAll` usa o iterador público do dom_query, preservando o cache
  interno do motor CSS e evitando vetores intermediários de nós e IDs.
- Registro de handles usa uma busca por entrada no HashMap.
- Contadores de recursos usam incrementos saturados, com verificação de limite.
- A sessão já reutilizava o cliente HTTP e seu pool, como recomenda a
  [documentação do reqwest](https://docs.rs/reqwest/0.13.5/reqwest/struct.Client.html).
  Cada página mantém um runtime próprio para preservar isolamento.

A ponte web é TypeScript; o build do Cargo chama `tooling/build-web.ts`, com
Effect, para gerar JavaScript em `OUT_DIR`. O binário incorpora esse artefato e
não precisa de Bun/Node em execução. O contexto de páginas executa JavaScript
com QuickJS; TypeScript precisa dessa compilação. Não há `.js`, `.jsx`, `.mjs`
ou `.cjs` escritos e versionados no projeto. Scripts de páginas nos fixtures
HTML e respostas de teste são entradas para o navegador.

## Medição reproduzível

```sh
bun install --frozen-lockfile
cargo build --release --locked
bun run bench:browser
# Comparação com outro binário:
bun run bench:browser /caminho/nimbo-engine
```

`tooling/benchmark.ts` usa Effect para abrir e fechar o servidor local, verifica
a extração em cada execução e publica JSON. Cada cenário tem 5.000 elementos,
três warmups e 21 amostras sequenciais. Os tempos incluem criar um processo,
cliente HTTP, runtime QuickJS, navegação, extração e encerrar o processo.

Ambiente: Linux x86_64, Intel Xeon E5-2680 v4, Rust 1.96.0, Bun 1.4.2.
Baseline: commit `6a176a8a954f885535036ab7b4036778835901b3`, release padrão do
Cargo. Atual: código desta alteração e perfil release acima. O relatório em
[performance.json](performance.json) registra resultados brutos e hashes dos
binários. A medição definitiva foi feita sem compilação concorrente.

| Cenário       | Baseline p50/p95 (ms) | Atual p50/p95 (ms) | Razão p50 |
| ------------- | --------------------: | -----------------: | --------: |
| static        |       123.14 / 129.50 |      26.70 / 34.66 |     4.61x |
| selectors-200 |     5380.57 / 5560.10 |      26.84 / 31.22 |   200.48x |
| dynamic-fetch |         28.25 / 37.72 |      27.72 / 33.02 |     1.02x |

Este corpus sintético destaca consultas com muitos matches e não prova o
máximo desempenho possível. Não mede RSS, concorrência, rede externa, DNS/TLS,
Cloudflare Containers, compatibilidade ampla ou custo por página em produção.
Não há limiar temporal no CI: o CI valida comportamento em debug e release;
o benchmark é explícito para evitar testes instáveis por carga do runner.

PGO, otimização por CPU, outro allocator ou mudanças no runtime exigem corpus
representativo e novas medições. `target-cpu=native` não foi aplicado a um
artefato portátil. Miri e sanitizers não foram executados; QuickJS usa FFI/C e
precisa de uma estratégia própria para essa validação.
