# Arquitetura atual

O repositório é um monorepo com `pnpm workspaces`.

- `apps/web`: aplicação Next.js com TypeScript. Por enquanto, exibe apenas uma página institucional mínima.
- `apps/api`: serviço Node.js com Fastify e TypeScript. Expõe health checks públicos e módulos internos protegidos.
- `packages/shared`: pacote de código compartilhado para schemas Zod, tipos TypeScript e constantes.
- `database/migrations`: migrations versionadas, executadas com `node-pg-migrate` e SQL explícito para preservar acesso completo ao PostGIS.
- `database/seeds`: catálogo inicial idempotente de categorias e serviços.
- `docker-compose.yml`: inicia PostgreSQL com a extensão PostGIS disponível pela imagem oficial.

O frontend e a API são executados separadamente. O pacote compartilhado é compilado antes dos comandos de desenvolvimento da raiz e é consumido pela API.

## Conversation Engine — comandos determinísticos

Comandos conversacionais inequívocos usam um fast path determinístico, puro e sem dependências externas. O parser interpreta somente o texto e o router aplica as regras do estado atual: comandos globais são permitidos em qualquer estado, enquanto comandos de escolha só são considerados em `awaiting_selection`. Ele reconhece posições sintaticamente válidas de 1 a 10; futuramente, os handlers de estado executarão os efeitos e verificarão se a posição escolhida realmente existe na lista apresentada ao usuário. Textos que não correspondam integralmente às formas conservadoras aceitas permanecem como frases livres e, futuramente, poderão seguir para um fallback estruturado que produza a mesma estrutura controlada de comandos.

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

## Service Resolution determinístico

`apps/api/src/modules/service-resolution` é a etapa anterior ao matching. Recebe texto e devolve um `service_id` somente quando há uma resolução determinística confiável. O pipeline futuro é:

`Text → Service Resolution → Location Resolution → Matching Engine`.

O módulo normaliza texto de forma pura (minúsculas, NFD sem diacríticos, pontuação como separador e espaços compactados) e consulta apenas serviços ativos. A consulta SQL parametrizada considera nome, slug e `service_aliases.normalized_alias`, aplicando exact antes de phrase com fronteiras de tokens. Somente se ambos falharem, usa `pg_trgm` com termos de no mínimo cinco caracteres. O threshold padrão é `0.53` e a margem de ambiguidade é `0.10`; ambos são validados de `0` a `1` pela configuração centralizada e podem ser calibrados pelas variáveis de ambiente do resolver.

Aliases iniciais ficam no seed idempotente do catálogo. O script repete a mesma normalização conceitual da API, mas não compartilha runtime entre TypeScript da aplicação e o seed CommonJS. A execução de `pnpm db:seed` continua uma operação administrativa manual. Um fallback inteligente futuro poderá atuar sobre respostas `unresolved` ou `ambiguous`; não há IA, geocoding, WhatsApp ou matching nesse módulo.

## Location Resolution determinístico

`apps/api/src/modules/location-resolution` descobre **onde** o pedido deve ser atendido a partir de uma consulta textual já isolada. Ele é independente do Service Resolution, que descobre **qual** serviço, e do Matching Engine, que descobre **quem** pode atender: `Text → Service Resolution → Location Resolution → Matching Engine`.

O módulo é stateless e usa uma interface `GeocodingProvider`. A implementação inicial usa HeiGIT/openrouteservice em `https://api.heigit.org/pelias/v1/search`, com chave server-side no header `Authorization`, limite de país e timeout de cinco segundos. Um provider futuro (Mapbox, Google ou Pelias próprio) pode substituir esse adapter sem mudar a decisão do domínio.

O serviço valida a resposta GeoJSON externamente, preserva a ordem de relevância do provider, elimina duplicados estáveis e só seleciona um resultado quando a confiança real passa o threshold configurado e não há concorrente dentro do gap. Sem confiança, o resultado é `unresolved`; falhas do provider são erros técnicos separados. Não há persistência, cache, retry automático ou fallback Nominatim nessa etapa. Localizações GPS que já tragam latitude/longitude não devem passar por geocoding no futuro.

## Search Orchestrator determinístico

`apps/api/src/modules/search-orchestration` coordena os módulos sem persistência própria e sem HTTP interno:

`Input estruturado → Service Resolution (qual) → Location Resolution (onde) → Matching Engine (quem)`.

O texto de serviço é sempre resolvido primeiro. Se estiver `unresolved` ou `ambiguous`, o fluxo encerra em `needs_service`. Somente um serviço resolvido permite uma consulta de localização; uma localização não resolvida ou ambígua encerra em `needs_location`. Apenas os dois resultados resolvidos chegam ao Matching Engine, que continua sendo o único componente a criar `search_requests` e `matches` em sua própria transação.

O orquestrador recebe por injeção `ServiceResolutionRepository`, `LocationResolutionService` e `MatchingRepository`; por isso testes usam fakes e não dependem de rede, banco ou chamadas para `localhost`. Ele não interpreta mensagem natural, não usa IA e não implementa WhatsApp. O `raw_text` original é preservado para auditoria do matching.

## Message Interpreter — fast path determinístico

`apps/api/src/modules/message-interpretation` executa o primeiro passo de interpretação em memória:

`Natural language text → Message Interpreter → structured slots`.

O módulo mantém `service_text` igual à mensagem completa e extrai somente localizações textuais explícitas por regras pequenas e conservadoras. Ele é puro, stateless, não possui repository e não chama banco, geocoder, Search Orchestrator ou qualquer API externa. A existência e canonicalização da localidade continuam sob responsabilidade do Location Resolution.

O endpoint próprio deste módulo continua totalmente determinístico. O fallback LLM não foi incorporado ao interpreter: ele existe apenas na camada Message Search, depois que este fast path retorna `needs_location`. As decisões de serviço, geocoding e ranking permanecem nos módulos determinísticos existentes.

## Message Search Pipeline

`apps/api/src/modules/message-search` é uma camada de aplicação stateless acima do Message Interpreter e do Search Orchestrator. Ela não possui repository, não persiste dados diretamente e não chama endpoints internos por HTTP.

```text
                       raw message
                           ↓
            Deterministic Message Interpreter
                    /                 \
          interpreted               needs_location
              |                           ↓
              |                 LLM Location Fallback
              |                     /           \
              |                 resolved      unresolved/error
              |                     |               ↓
              +---------------------+         needs_location
                           ↓
                  Search Orchestrator
                 /         |         \
              Service   Location   Matching
                           ↓
                        result
```

O `buildApp` cria o `HybridMessageSearchService` com as mesmas instâncias já resolvidas de `MessageInterpretationService` e `SearchOrchestrationService`, mais uma abstração injetável `MessageLocationFallbackProvider`. A implementação inicial usa o SDK oficial OpenAI com Responses API e Structured Outputs. O provider é construído sob demanda; ausência de `OPENAI_API_KEY` não impede o servidor nem os health checks de iniciar.

Por request, o interpreter é chamado uma vez. Quando retorna `interpreted`, o provider não é chamado e os slots seguem diretamente ao orquestrador. Quando retorna `needs_location`, o kill switch decide entre preservar o short-circuit da 3.5B ou consultar o fallback. Uma extração válida cria apenas o slot textual com proveniência `llm_fallback`; `service_text` continua sendo a mensagem completa e o Location Resolution continua responsável pelo geocoding real.

O contrato expõe o estágio responsável pelo resultado. `interpretation` indica ausência de localização explícita; `service_resolution` e `location_resolution` preservam as decisões do 3.4; `matching` representa tanto profissionais encontrados quanto uma busca válida sem resultados. Somente o Matching Engine continua responsável por criar `search_requests` e `matches`.

`MESSAGE_INTERPRETATION_FALLBACK_ENABLED=false` é o padrão e impede qualquer consumo da OpenAI. Quando ligado, timeout/rede, rate limit e falhas do provider são convertidos em razões públicas controladas de `needs_location`, sempre antes do Search Orchestrator. O log de erro contém apenas provider, modelo, categoria e latência — nunca chave, prompt completo ou resposta bruta. O provider usa `store: false`, `reasoning.effort: none`, no máximo 100 tokens de saída, timeout configurável e `maxRetries: 0`; nenhuma tool ou estado de conversa é habilitado.

Esse fallback não altera Service Resolution, Location Resolution, Matching ou Search Orchestrator. Ele não reconhece serviço, não faz geocoding, não calcula ranking e não escolhe profissional. Testes usam providers e clientes falsos, sem rede e sem chamadas reais à OpenAI.

## Search Conversation State

`apps/api/src/modules/search-conversations` adiciona memória curta para coletar serviço e localização. Ela não é histórico de conversa, agente ou memória de longo prazo:

```text
START: mensagem → Message Search 3.5C
                    ├─ needs_location → ACTIVE/location
                    ├─ needs_service  → ACTIVE/service (se location_text existe)
                    └─ resultado final → sem conversa pendente

ACTIVE/location ↔ ACTIVE/service → Search Orchestrator → Matching → COMPLETED
```

`search_conversations` é o estado transitório que preserva a primeira mensagem, as tentativas de serviço/localização, país, limite e o slot pendente. `search_requests` não foi reutilizada como sessão: permanece sendo criada pelo Matching somente quando a busca possui dados suficientes. Isso mantém intactos os módulos 3.1–3.5C e separa coleta conversacional de auditoria do marketplace.

O schema também já suporta `pending_slot = selection` para manter ativa uma conversa vinculada ao `search_request` cuja lista ordenada de `matches` foi apresentada. `rank_position` preserva a ordem dessa lista; `shown_at` e `selected_at` representam, respectivamente, apresentação e escolha. Esta etapa é somente persistência: os serviços, rotas, channel-inbox e presenter atuais ainda não criam nem executam o estado de seleção.

O início reutiliza a mesma instância de `MessageSearchService`. `needs_location` no estágio `interpretation` abre `pending_slot = location`; `needs_service` abre `pending_slot = service` somente quando a interpretação já contém `location_text` utilizável. Nas continuações, o slot define semanticamente a resposta: a mensagem atual substitui `location_text` ou `service_text` e segue diretamente ao Search Orchestrator. Portanto nenhum turno de continuação chama Message Search, Message Interpreter ou o provider OpenAI.

`location_text` permanece nullable no banco para representar corretamente conversas que ainda aguardam localização. A exigência de uma localização reutilizável em `pending_slot = service` é uma invariável da aplicação, validada na criação e antes da continuação, sem um CHECK rígido que limite futuras evoluções de slots.

O TTL padrão é de 30 minutos e pode ser ajustado por `SEARCH_CONVERSATION_TTL_MINUTES`. A validade é calculada pelo relógio do PostgreSQL. Não há cron de limpeza: registros vencidos são tratados logicamente como expirados e não podem ser retomados. `needs_location` e `needs_service` mantêm a conversa ativa, atualizam o slot correspondente e renovam o TTL; `matched` e `no_matches` completam a conversa e vinculam o `search_request_id`.

Concorrência usa um claim atômico com `processing_token` e `processing_started_at`. Uma conversa ativa e não expirada pode ser reservada quando não possui token ou quando a lease anterior já venceu; a lease padrão de 60 segundos é configurada por `SEARCH_CONVERSATION_PROCESSING_LEASE_SECONDS`. Ao reassumir um claim abandonado por crash ou restart, a atualização grava um novo token e reinicia `processing_started_at`. O geocoder roda fora de transação longa; conclusão ou renovação exige o mesmo token e então o remove. Uma segunda mensagem durante uma lease recente recebe `conversation_processing`, enquanto chamadas sequenciais após conclusão recebem `conversation_not_active`. Idempotência de webhooks será responsabilidade da futura camada de canal.

## Customer Conversation Router

O módulo `customer-search` cria a fronteira entre um adaptador de canal futuro e o fluxo de busca. A identidade do cliente é `customers.phone_e164`, recebida já em E.164 canônico. O router não armazena nem devolve o telefone além do momento de resolução do customer e seus logs estruturados registram somente `customer_id`, rota, `conversation_id` e status do resultado.

```text
Future Channel Adapter
        ↓
Customer Conversation Router
        ↓
Customer (phone_e164)
        ↓
active conversation?
   ↙             ↘
start          continue
   ↓               ↓
Search Conversation State
        ↓
Search Orchestrator → Matching → search_request.customer_id
```

Antes da consulta, o router expira logicamente conversas vencidas daquele customer. A consulta de conversa exige `customer_id`, `status = active` e `expires_at > NOW()`. Um índice parcial no PostgreSQL permite apenas uma conversa ativa por cliente, mas continua permitindo `customer_id = NULL` para as rotas internas 3.x e seus testes. Em uma corrida rara de start, a violação desse índice é convertida em erro controlado; o router nunca transforma uma mensagem inicial em resposta de contexto desconhecido.

`customer_id` é propagado por contexto de execução interno: Router → Search Conversation → Message Search/Search Orchestrator → Matching. Por isso os contratos HTTP existentes das etapas 3.x permanecem iguais. Continuações usam exclusivamente o `customer_id` persistido na própria conversa, não dados enviados pelo chamador. Idempotência de mensagens, IDs de webhook e integração Evolution/WhatsApp permanecem fora desta fase.

## Channel Inbox

`channel-inbox` é a camada provider-agnostic acima do Customer Conversation Router. O adapter futuro fornece somente um `provider`, `provider_message_id`, telefone E.164 e texto; ele não carrega `conversation_id` nem conhece slots ou Matching.

```text
Future Channel Adapter
       ↓
Channel Inbox
       ↓
Idempotency / Claim
       ↓
Customer Conversation Router
       ↓
Search Conversation
       ↓
Matching
       ↓
Message Presenter
       ↓
Transactional Outbox (PostgreSQL)
       ↓
reply_text + outbound.id → n8n claim → Future Evolution Outbound
       ↓
n8n sent / failed confirmation
```

PostgreSQL é a fonte de verdade: `channel_inbound_messages` possui a unicidade `(provider, provider_message_id)`. A primeira inserção fixa telefone, texto, país e limite para a chave; toda nova entrega compara seu payload normalizado com os valores persistidos antes de replay ou claim. Uma divergência retorna conflito controlado e não chama o domínio. O claim condicional reserva uma mensagem `received`, `failed` ou um processamento cuja lease venceu. Não há Redis, lock em memória ou transação longa enquanto o Customer Router pode acionar OpenAI, geocoder ou Matching.

O resultado do Customer Router é salvo como JSONB ao completar e é validado novamente antes de replay de duplicata. O módulo `message-presentation` é puro e determinístico: recebe esse resultado, produz `reply_text` em pt-BR e não consulta banco, chama OpenAI, geocoder, Matching ou canais externos. Ele cobre os estados de pedir localização, pedir serviço, profissionais encontrados e nenhuma opção encontrada; para matches usa somente nome público, serviço, distância e preço já retornados, na mesma ordem do Matching.

A confirmação da Inbox e a criação da Outbox ocorrem na mesma transação PostgreSQL. `channel_outbound_messages` tem uma unicidade por `channel_inbound_message_id`; assim, cada inbound lógico produz no máximo uma intenção textual outbound. A tabela mantém `pending`, `processing`, `sent` e `failed`, contador de tentativas, token/horário de lease, código de erro controlado e o ID devolvido pelo provider. O telefone do destinatário é persistido apenas como `recipient_phone_e164`, pois é indispensável ao transporte, é validado como E.164 e é PII: não aparece em logs nem na resposta da Inbox.

Inbounds que já estavam `processed` antes da introdução dessa tabela não sofrem backfill em SQL. Quando um replay encontra um desses registros sem Outbox, a Inbox valida o resultado JSONB, gera o texto pelo presenter e faz uma recuperação lazy idempotente com a chave única do inbound. Essa recuperação não altera o inbound e não chama o Router, geocoder, Matching ou OpenAI; novas mensagens continuam usando a transação normal Inbox + Outbox.

Um replay usa o resultado persistido e a mesma Outbox, sem chamar o router; portanto preserva o mesmo `outbound.id` e informa se ele já está `sent`. O n8n permanece um transporte sem regras ou geração de linguagem: ele faz claim interno, envia o `text_content` à Evolution e confirma `sent` ou `failed` com o token obtido. A API não chama a Evolution, não possui Redis, worker, retry outbound ou OpenAI nessa camada. Claims `pending`, `failed` ou vencidos tornam-se `processing`, incrementam as tentativas e não mantêm transação aberta durante a chamada externa.

Não há garantia exactly-once matemática: se a Evolution aceitar o texto e o n8n cair antes da confirmação, uma lease vencida poderá ser reivindicada e reenviada. A Outbox evita a perda da intenção e múltiplas mensagens lógicas por inbound, além de tornar tentativas e estados observáveis. Logs incluem apenas IDs internos, provider, status, tentativas, flag de duplicata e código de erro controlado — nunca telefone, texto ou payload de webhook.

Essa camada reduz duplicatas usuais de uma entrega at-least-once e garante um único processamento ativo em condições normais. Não promete exactly-once matemático: se o processo cair após o efeito do router mas antes do `markProcessed`, um reclaim posterior pode reexecutar o domínio. Idempotência de eventos e adaptação concreta da Evolution permanecem deliberadamente para a próxima fase.
