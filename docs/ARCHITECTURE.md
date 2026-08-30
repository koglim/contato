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

O mesmo módulo também concentra a disponibilidade imediata. A operação usa uma atualização condicional no PostgreSQL: apenas `status = active` pode persistir `is_available_now = true`, e o banco define `available_now_updated_at = NOW()` em toda confirmação. A alteração de status para `draft` ou `suspended` atualiza a disponibilidade de forma atômica, impedindo combinações inconsistentes como profissional suspenso e disponível.

## Catálogo e serviços oferecidos

`apps/api/src/modules/catalog` fornece somente leitura para o catálogo inicial de serviços e categorias. `apps/api/src/modules/professional-services` concentra a associação entre profissional e serviço, suas regras de preço em centavos e a ativação lógica (`is_active`). Ambos usam contratos Zod e tipos de `packages/shared`, repositórios PostgreSQL com SQL parametrizado e injeção de dependências para testes sem banco externo.

O helper em `apps/api/src/modules/internal` centraliza a proteção temporária por `X-Internal-Key` e a resposta de validação. Assim, módulos internos reutilizam o mesmo comportamento sem tornar `app.ts` responsável pela regra de negócio. Nenhum serviço é removido fisicamente: a desativação preserva histórico para reativação futura.

## Áreas de atendimento e PostGIS

`apps/api/src/modules/service-areas` gerencia áreas operacionais de profissionais. O centro é salvo com `ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography`, respeitando a ordem exigida pelo PostGIS; nas respostas, `ST_X(center::geometry)` retorna longitude e `ST_Y(center::geometry)` retorna latitude. O raio permanece um inteiro em metros, limitado a 200 km no contrato da API.

`database/connection.ts` concentra o único `Pool` e também expõe `withTransaction`. Criação ou atualização que marque uma área como primária desmarca as demais e persiste a nova configuração dentro de `BEGIN`/`COMMIT`, com `ROLLBACK` em caso de erro. O índice parcial já presente no banco continua como proteção adicional para uma única área primária por profissional.

## Matching Engine determinístico

`apps/api/src/modules/matching` recebe um serviço já identificado e coordenadas já resolvidas. Ele é deliberadamente separado da futura camada de interpretação: esta poderá transformar uma mensagem em `service_id` e localização, enquanto o matching decide de forma determinística quais profissionais são elegíveis com base em SQL e PostGIS.

A busca usa `ST_DWithin` para respeitar o raio de cada área e `ST_Distance` para calcular a distância em metros. Uma janela SQL escolhe somente a área elegível mais próxima de cada profissional; depois aplica a ordenação estável por disponibilidade efetiva, distância, verificação e UUID. A disponibilidade é efetiva somente durante 240 minutos após a confirmação, mas não exclui profissionais.

O repositório executa validação do catálogo, criação de `search_requests`, criação de `matches` e atualização de status no mesmo `withTransaction`. O snapshot de explicação persistido em cada match contém apenas disponibilidade efetiva, distância em metros e verificação. Não há score proprietário, ranking por reputação, IA, geocoding ou exposição de dados de contato nessa etapa.
