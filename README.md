# ContatoCerto

Fundação técnica do marketplace conversacional de prestadores de serviços locais.

---

## 📚 Documentação do Projeto

O ContatoCerto adota uma política estrita de governança e Fonte Única da Verdade. Para entender o projeto e contribuir com segurança:

* **Para Desenvolvedores e Agentes de IA:** Leia impreterivelmente [**AGENTS.md**](AGENTS.md) antes de qualquer intervenção.
* **Mapa Mestre de Documentação:** [**docs/README.md**](docs/README.md)
* **Definição Canônica do Produto:** [**docs/PROJECT.md**](docs/PROJECT.md)
* **Estado Atual e Funcionalidades:** [**docs/CURRENT_STATE.md**](docs/CURRENT_STATE.md)
* **Roadmap e Planejamento:** [**docs/ROADMAP.md**](docs/ROADMAP.md)

---

## 🛠️ Pré-requisitos

* Node.js 22 ou superior
* pnpm 11 ou superior
* Docker e Docker Compose (para o PostgreSQL / PostGIS local)

---

## 🚀 Configuração Local

1. Copie `.env.example` para `.env` e substitua `POSTGRES_PASSWORD` por uma senha local.
2. Instale as dependências com `pnpm install`.
3. Inicie o banco com `docker compose up -d`.
4. Aplique as migrations com `pnpm db:migrate` e carregue o catálogo inicial com `pnpm db:seed`.
5. Inicie todos os serviços em modo de desenvolvimento com `pnpm dev`.

O portal web estará acessível em `http://localhost:3000` e a API em `http://localhost:3333`. A verificação de saúde da API está em `http://localhost:3333/health`.

---

## 💻 Comandos Disponíveis

* `pnpm dev`: inicia o frontend (Next.js) e o backend (Fastify API) simultaneamente.
* `pnpm dev:web`: inicia somente o frontend.
* `pnpm dev:api`: inicia somente a API.
* `pnpm build`: compila todos os pacotes e aplicações.
* `pnpm lint`: executa a verificação de lint em todo o repositório.
* `pnpm test`: executa a suíte de testes automatizados.
* `pnpm typecheck`: valida a tipagem estática com TypeScript.
* `pnpm db:up`: sobe os contêineres Docker do banco de dados.
* `pnpm db:down`: encerra os contêineres Docker.
* `pnpm db:migrate`: aplica as migrations pendentes.
* `pnpm db:rollback`: desfaz a migration mais recente.
* `pnpm db:seed`: popula o catálogo inicial de serviços e municípios.
