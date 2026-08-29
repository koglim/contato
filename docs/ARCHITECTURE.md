# Arquitetura atual

O repositório é um monorepo com `pnpm workspaces`.

- `apps/web`: aplicação Next.js com TypeScript. Por enquanto, exibe apenas uma página institucional mínima.
- `apps/api`: serviço Node.js com Fastify e TypeScript. Expõe somente `GET /health`.
- `packages/shared`: pacote de código compartilhado para schemas Zod, tipos TypeScript e constantes.
- `database/migrations`: migrations versionadas, executadas com `node-pg-migrate` e SQL explícito para preservar acesso completo ao PostGIS.
- `database/seeds`: catálogo inicial idempotente de categorias e serviços.
- `docker-compose.yml`: inicia PostgreSQL com a extensão PostGIS disponível pela imagem oficial.

O frontend e a API são executados separadamente. O pacote compartilhado é compilado antes dos comandos de desenvolvimento da raiz e é consumido pela API.

## Persistência

A API usa `pg` (node-postgres) e cria a conexão sob demanda a partir de `DATABASE_URL`. `GET /health` permanece independente do banco; `GET /health/db` executa uma consulta simples e responde apenas com o estado público da conexão.

PostgreSQL executa localmente na imagem PostGIS. A primeira migration habilita `postgis`, `pg_trgm`, `unaccent` e `pgcrypto`; a seguinte cria o modelo do marketplace, seus índices e restrições. Não há ORM: migrations e futuras consultas geoespaciais permanecem em SQL.
