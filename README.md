# ContatoCerto

Fundação técnica do marketplace conversacional de prestadores de serviços.

## Pré-requisitos

- Node.js 22 ou superior
- pnpm 11 ou superior
- Docker e Docker Compose (para o banco local)

## Configuração local

1. Copie `.env.example` para `.env` e substitua `POSTGRES_PASSWORD` por uma senha local.
2. Instale as dependências com `pnpm install`.
3. Inicie o banco com `docker compose up -d`.
4. Aplique o schema com `pnpm db:migrate` e o catálogo inicial com `pnpm db:seed`.
5. Inicie todos os serviços com `pnpm dev`.

O frontend estará em `http://localhost:3000` e a API em `http://localhost:3333`. A verificação da API está em `http://localhost:3333/health`.

## Comandos

- `pnpm dev`: inicia frontend e API.
- `pnpm dev:web`: inicia somente o frontend.
- `pnpm dev:api`: inicia somente a API.
- `pnpm build`: compila todos os pacotes e aplicações.
- `pnpm lint`: executa o lint em todos os workspaces.
- `pnpm test`: executa os testes disponíveis.
- `pnpm typecheck`: verifica os tipos TypeScript.
- `pnpm db:up`: inicia o PostgreSQL local.
- `pnpm db:down`: interrompe o ambiente Docker local.
- `pnpm db:migrate`: aplica migrations pendentes.
- `pnpm db:rollback`: desfaz a migration mais recente.
- `pnpm db:seed`: carrega o catálogo inicial.

Consulte [docs/PROJECT.md](docs/PROJECT.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) e [docs/MVP.md](docs/MVP.md) para mais contexto.
