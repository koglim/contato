# Arquitetura atual

O repositório é um monorepo com `pnpm workspaces`.

- `apps/web`: aplicação Next.js com TypeScript. Por enquanto, exibe apenas uma página institucional mínima.
- `apps/api`: serviço Node.js com Fastify e TypeScript. Expõe health checks públicos e módulos internos protegidos.
- `packages/shared`: pacote de código compartilhado para schemas Zod, tipos TypeScript e constantes.
- `database/migrations`: migrations versionadas, executadas com `node-pg-migrate` e SQL explícito para preservar acesso completo ao PostGIS.
- `database/seeds`: catálogo inicial idempotente de categorias e serviços.
- `docker-compose.yml`: inicia PostgreSQL com a extensão PostGIS disponível pela imagem oficial.

O frontend e a API são executados separadamente. O pacote compartilhado é compilado antes dos comandos de desenvolvimento da raiz e é consumido pela API.

## Persistência

A API usa `pg` (node-postgres) e cria a conexão sob demanda a partir de `DATABASE_URL`. `GET /health` permanece independente do banco; `GET /health/db` executa uma consulta simples e responde apenas com o estado público da conexão.

PostgreSQL executa localmente na imagem PostGIS. A primeira migration habilita `postgis`, `pg_trgm`, `unaccent` e `pgcrypto`; a seguinte cria o modelo do marketplace, seus índices e restrições. Não há ORM: migrations e futuras consultas geoespaciais permanecem em SQL.

## Módulo de profissionais

`apps/api/src/modules/professionals` concentra rotas, repositório PostgreSQL e tipos exclusivos de persistência. Os contratos HTTP ficam em `packages/shared`, para reutilização futura pelo frontend.

As rotas em `/internal/professionals` usam `INTERNAL_API_KEY` no header `X-Internal-Key`. Essa chave protege temporariamente operações administrativas e não substitui a futura autenticação dos profissionais. A infraestrutura de banco mantém um único `Pool` e expõe `query()` para consultas SQL parametrizadas do repositório.

## Catálogo e serviços oferecidos

`apps/api/src/modules/catalog` fornece somente leitura para o catálogo inicial de serviços e categorias. `apps/api/src/modules/professional-services` concentra a associação entre profissional e serviço, suas regras de preço em centavos e a ativação lógica (`is_active`). Ambos usam contratos Zod e tipos de `packages/shared`, repositórios PostgreSQL com SQL parametrizado e injeção de dependências para testes sem banco externo.

O helper em `apps/api/src/modules/internal` centraliza a proteção temporária por `X-Internal-Key` e a resposta de validação. Assim, módulos internos reutilizam o mesmo comportamento sem tornar `app.ts` responsável pela regra de negócio. Nenhum serviço é removido fisicamente: a desativação preserva histórico para reativação futura.
