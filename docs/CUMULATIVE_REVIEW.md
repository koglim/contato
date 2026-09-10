# Revisão cumulativa para integração em desenvolvimento

Data: 2026-09-10. Branch: `codex/marketplace-v1-completion`.
Base `main`: `5c20bd92cb13d8867ca21bcc819104dbf76ce1ff`.
HEAD inicial revisado: `7edcbc05cac97b391405c3aa3eac101decce947f`.
Correções de código: `137feeb56bbe5b39f57250ac85f8137215ae56ce`.
[CI completo desse código](https://github.com/koglim/contato/actions/runs/34514506480): success.
A consolidação documental posterior também exige CI do próprio SHA; o relatório
de entrega informa esse SHA e execução, sem atribuir a ele a execução anterior.

## Parecer e escopo

O conjunto está coerente para integração **controlada em desenvolvimento**, seguindo
os gates abaixo. Não é aprovação de lançamento público, de ativação do transporte
nem de qualidade conversacional real. V1 comercial não está concluída.

Revisados migrations 017–020, contratos compartilhados, API, BFF do painel,
Inbox/Outbox, leases/retries/reconciliação, seleção/consentimento, mídia e expurgo,
B2, autenticação, logs, auditoria, Dockerfiles, CI e cinco exports n8n. Não houve
merge, deploy, migration externa, edição no n8n instalado, WhatsApp ou chamada paga.

## Defeitos concretos corrigidos

1. **Mídia contornava quarentena da Inbox.** Um conflito textual sobre o mesmo
   evento podia colocar a Inbox em quarentena, mas o worker ainda reivindicava
   mídia; resultado/expurgo podiam emitir aviso e encerrar a entrada, liberando
   FIFO sem disposição administrativa. Claim, resultado e aviso agora conferem
   o placeholder ativo sob lock, na ordem mídia → Inbox. Se indisponível,
   quarentenam a mídia e removem bytes sem tocar na Inbox ou criar Outbox.
   Retry administrativo de placeholder é bloqueado, preservando close explícito.
2. **Allowlist MIME aceitava propriedades herdadas.** `in` admitia nomes como
   `constructor`, levando conteúdo inválido até constraints do banco. A consulta
   usa propriedades próprias; regressões cobrem admissão e replay PostgreSQL.
3. **Erros de parsing HTTP eram convertidos em 500.** JSON inválido, corpo grande
   e content-type incompatível agora preservam 400/413/415, sem eco de payload.
   Erros inesperados continuam falhando de forma sanitizada.
4. **Chaves opcionais vazias impediam startup com recursos desabilitados.**
   `OPENAI_API_KEY` e `OPENROUTESERVICE_API_KEY` vazias/espaços agora equivalem a
   ausência, como sugere `.env.example`. Habilitar B2 continua exigindo chave e
   modelo. Ausência de chave de geocoding não significa geocoding funcional.
5. **Runbooks contraditórios.** Instruções antigas diziam quatro workflows,
   aviso direto e ausência de disposição administrativa. Consolidado o estado
   de cinco exports, admissão durável, disposição de holds e banco até 020.

Nenhuma migration, dependência, variável, workflow ou funcionalidade de negócio
foi adicionada por esta revisão. Regressões reproduziram os defeitos antes das
correções. Seis novos cenários PostgreSQL cobrem MIME e os caminhos de quarentena.

## Evidências de validação

| Validação | Resultado |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passou local e CI; lockfile preservado |
| `pnpm lint` / `pnpm typecheck` / `pnpm build` | Passaram local e CI; shared, API e Next.js |
| `pnpm test` | 311 API + 12 web + 40 workflows; zero falhas |
| `pnpm build:workflows` e diff dos exports | Cinco exports reproduzíveis, sem alteração |
| B2 corpus completo | 300/300 simulados; zero chamadas ao modelo |
| B2 readiness | 18/18 simulados; zero chamadas ao modelo |
| PostgreSQL/PostGIS | 150/150 no CI, novamente 150/150 após reaplicação |
| Migrations | Aplicação até 020; verificações explícitas 017–020 e anteriores |
| Rollbacks | Proteções testadas; down compatível 020→008 e reaplicação 008→020 |
| `git diff --check` | Passou |

PostgreSQL executou no serviço descartável do CI, não em banco de desenvolvimento
externo ou produção. Não há Docker/psql local; imagem Docker foi revisada
estruturalmente, não construída/executada aqui. Local usa Node 24; CI usa Node 22.
Mocks de providers e simulação do grafo n8n não são homologação desses serviços.
Os 300 casos não comprovam compreensão/naturalidade: avaliação real e revisão
humana permanecem em [B2_HOMOLOGATION_PLAN.md](B2_HOMOLOGATION_PLAN.md).

## Banco e rollback

As migrations cumulativas em relação à main são 017, 018, 019 e 020. Consultar
`pgmigrations` no ambiente autorizado: não presumimos quais já foram aplicadas.
Aplicar **todas** as pendentes até 020, incluindo 017 e 018 quando ausentes.
Nenhuma definição de migration foi alterada nesta revisão.

| Migration | Compatibilidade adicionada | Barreira de down |
| --- | --- | --- |
| 017 | Recibos e retenção da Outbox | P0017 com recibos/holds |
| 018 | Memória, turnos/orçamento e marcação B2 | P0018 com estado contextual persistido |
| 019 | Recuperação, fencing, FIFO e auditoria da Inbox | P0019 com recuperação/auditoria incompatíveis |
| 020 | Áudio durável, notices e intervenção auditada | P0020 com mídia, eventos, placeholders ou novos estados de transporte |

019 classifica processamento/falha legado com efeitos incertos em quarentena;
isso exige reconciliação, não retry cego. Testes de down protegido mantêm schema,
registro das migrations e dados. Limpeza de fixtures compatíveis acontece apenas
no banco descartável do CI. Nunca apagar registros reais para forçar rollback.

## Inventário final de variáveis e credenciais

Nenhuma variável nova nesta revisão. Em relação à main, B2 acrescentou
`CONTEXTUAL_CONVERSATION_ENABLED` e `CONTEXTUAL_CONVERSATION_MODEL`.
Valores abaixo documentam o contrato atual, não alteram o ambiente instalado.

### API e runner de banco

| Variável | Uso/valor de referência |
| --- | --- |
| `DATABASE_URL` | Segredo do banco correto, API e runner; nunca usar senha de exemplo |
| `API_PORT` | 3333 |
| `INTERNAL_API_KEY` | Segredo forte; compartilhado apenas com servidores/credentials autorizados |
| `SERVICE_RESOLUTION_FUZZY_THRESHOLD` | 0.53 |
| `SERVICE_RESOLUTION_FUZZY_AMBIGUITY_GAP` | 0.10 |
| `OPENROUTESERVICE_API_KEY` | Segredo necessário para geocoding real; vazio é ausência |
| `OPENROUTESERVICE_BASE_URL` | `https://api.heigit.org/pelias/v1` |
| `LOCATION_RESOLUTION_CONFIDENCE_THRESHOLD` | 0.85 |
| `LOCATION_RESOLUTION_AMBIGUITY_GAP` | 0.10 |
| `OPENAI_API_KEY` | Segredo opcional; não autoriza chamadas pagas |
| `MESSAGE_INTERPRETATION_FALLBACK_ENABLED` | false por padrão; recurso legado separado da B2 |
| `MESSAGE_INTERPRETATION_FALLBACK_MODEL` | `gpt-5.6-luna`, valor existente; disponibilidade não homologada nesta revisão |
| `MESSAGE_INTERPRETATION_FALLBACK_TIMEOUT_MS` | 5000 |
| `SEARCH_CONVERSATION_TTL_MINUTES` | 30 |
| `SEARCH_CONVERSATION_PROCESSING_LEASE_SECONDS` | 60 |
| `CHANNEL_INBOUND_PROCESSING_LEASE_SECONDS` | 60 |
| `CHANNEL_OUTBOUND_PROCESSING_LEASE_SECONDS` | 60; não reduzir abaixo do orçamento de entrega de 55s |
| `CONTEXTUAL_CONVERSATION_ENABLED` | **false** |
| `CONTEXTUAL_CONVERSATION_MODEL` | Vazio enquanto desligada; escolha depende de avaliação autorizada |

B2 false não desliga fallback legado ou transcrição do n8n caso estes sejam
ativados separadamente. `NODE_ENV=production` já pertence às imagens de produção.
Limites/retry de mídia permanecem centralizados em código, sem novas variáveis.

### Web e Compose local

Web, exclusivamente server-side: `CONTATOCERTO_API_URL`, `DASHBOARD_PROFESSIONAL_ID`,
`DASHBOARD_DEMO_PASSWORD`, `DASHBOARD_SESSION_SECRET` e `INTERNAL_API_KEY`.
Não usar prefixo NEXT_PUBLIC para esses valores. Sessão do painel usa assinatura
HMAC; continua sendo painel demonstrativo de profissional fixo, não login OTP.

Compose local: `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB=contatocerto`,
`POSTGRES_PORT=5432`. Senhas e IDs reais não pertencem ao repositório.

### n8n — configuração futura, sem alterar instalação

Variables não secretas: `CONTATOCERTO_API_BASE_URL`,
`CONTATOCERTO_DELIVERY_WORKFLOW_ID`, `EVOLUTION_API_BASE_URL`,
`EVOLUTION_INSTANCE`, `EVOLUTION_PROVIDER`, `EVOLUTION_WEBHOOK_ORIGIN`.

Credentials: `ContatoCerto Internal API` (X-Internal-Key), `ContatoCerto Evolution`
(apikey), `ContatoCerto Evolution Webhook JWT` (HS256 dedicado),
`ContatoCerto Groq Transcription` e `ContatoCerto OpenAI Transcription` (Bearer).
Não colocar credenciais em Variables, JSON exportado ou logs. Conferir tipos e
configuração em [TRANSPORT_HOMOLOGATION.md](TRANSPORT_HOMOLOGATION.md).

## Ordem exata de atualização — execução futura autorizada

1. Confirmar SHA aprovado, CI correspondente e ambiente; inventariar migrations.
   Salvar configuração/exports de modo restrito e produzir backup restaurável.
   Rotacionar os segredos identificados no export original, sem reproduzi-los.
2. Pausar ingresso e consumidores antigos, drenar operações em voo e reconciliar
   entregas incertas. Não manter réplicas antigas escrevendo durante a mudança.
3. Usar `Dockerfile.migrate` do mesmo SHA e aplicar uma vez todas as migrations
   pendentes até 020. Não executar seeds nem colocar migrations no startup.
   Com DATABASE_URL fornecida externamente, a CLI existente é:

   ```sh
   node node_modules/node-pg-migrate/bin/node-pg-migrate.js up --single-transaction -m database/migrations --database-url-var DATABASE_URL
   ```

4. Publicar API desse SHA com B2 false; verificar `/health/db`, diagnósticos
   agregados e quarentenas legadas. Não retomar automaticamente itens incertos.
5. Publicar web do mesmo SHA, preservando as variáveis server-side. A revisão não
   altera frontend, mas o delta cumulativo contém restrições importantes do BFF.
6. Importar **inativos** os cinco workflows. Importar Shared Delivery primeiro e
   vincular seu ID; configurar dispatcher, recovery, media consumer e gateway.
   Validar credentials, JWT dedicado, TLS/borda, limites de corpo, retenção de
   execução/binary e disponibilidade de Variables na instalação. Preservar
   `provider + instance:key.id`; não manter webhook global paralelo na Evolution.
7. Somente após autorização específica, homologar transporte com números de
   teste e falhas controladas. Desativar o caminho antigo e habilitar consumidores
   antes do ingresso novo apenas depois do aceite. Esta revisão não ativa nada.

Rollback: pausar/drenar/reconciliar antes. Preferir roll-forward. Down, quando
realmente compatível, segue 020→019→018→017 e suas barreiras; não executar API
antiga ignorando leases/holds/novo estado. Se protegido, parar e avaliar restauração
integral de backup com reconciliação externa. Restore não autoriza reenviar Outbox.

## Riscos e gates de homologação ainda abertos

- **Exactly-once externo não garantido:** se Evolution aceitar e a API inteira
  ficar indisponível antes de gravar sent/hold, a lease pode vencer sem evidência.
  Pausar consumidores e reconciliar; não alegar que testes de idempotência eliminam
  essa janela distribuída. Recibos e hold reduzem, mas não eliminam, o risco.
- FIFO não é uma ordem global estrita entre todas as respostas inline: permanece
  a exceção histórica de renovação de consentimento. Notices e notificações
  independentes possuem barreiras. Obsolescência/página terminal continuam gates.
- n8n 1.123.21/Evolution 2.3.7 têm candidato e inspeção estática, não ensaio do motor
  real: JWT, binários, item linking, permissões, timeout e comportamento do provider
  ainda precisam de homologação. JWT autentica origem, não assina cada corpo nem
  substitui TLS/fingerprint/idempotência ou restrição de rede.
- B2 fica desligada; corpus e jornadas usam simulação. Clareza, fidelidade semântica,
  resistência a instruções adversariais e transcrição real exigem avaliação
  autorizada e revisão humana. Não houve alteração/decoragem do corpus nesta revisão.
- Áudio usa assinatura mínima e duração declarada, não decodificação completa.
  BYTEA até 3 MiB e retenção lógica de uma hora exigem medição de carga. Worker/purge
  indisponíveis atrasam expurgo físico; WAL/backups podem conservar dados por mais
  tempo. Evento legado sem fingerprint exige análise, não adoção automática.
- Chave interna e operator_id declarado não são RBAC individual. Dashboard demo
  não é autenticação comercial. Logs sanitizados não tornam banco, backups ou
  execuções externas livres de PII. Auditoria não impede um administrador privilegiado
  de apagar dados; políticas de acesso/retenção e alertas precisam de operação real.
- Backup/restauração, SLOs/carga e monitoração não foram homologados; segredos do
  export original precisam de rotação pelo operador. Imagens Docker não foram
  executadas localmente. Não há aprovação de identidade multiusuário, cobrança,
  avaliações ou V1 inteira por consequência deste CI.
