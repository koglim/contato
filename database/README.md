# Banco de dados

Este diretório contém a evolução versionada do banco.

- `migrations/`: schema e extensões PostgreSQL executados por `node-pg-migrate`.
- `seeds/`: catálogo inicial idempotente de categorias e serviços.

Com `DATABASE_URL` configurada, execute `pnpm db:migrate` e depois `pnpm db:seed` na raiz do repositório.
