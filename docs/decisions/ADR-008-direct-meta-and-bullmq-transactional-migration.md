# ADR-008: Migração do Caminho Crítico Transacional para Meta WhatsApp Cloud API Direta e Fila BullMQ/Redis

* **Status:** ACCEPTED / TARGET (WP-DM0 ARCHITECTURE CONTRACT FROZEN — NOT YET IMPLEMENTED IN RUNTIME)
* **Data:** 2026-10-26
* **Decisores:** Arquitetura, Produto e Operações ContatoCerto

---

> [!NOTE]
> **Congelamento do Contrato de Migração Arquitetural (WP-DM0):**
> Este Architecture Decision Record formaliza e congela a decisão arquitetural de migrar o caminho crítico transacional de mensageria do ContatoCerto para integração direta com a **Meta WhatsApp Cloud API (Graph API)**, suportada por uma camada de execução e despacho rápido via **Redis e BullMQ**, mantendo o **PostgreSQL como Fonte Canônica da Verdade (Source of Truth)**. A **Evolution API** é classificada como contingência temporária (*fallback*) e posterior desativação (*decommission*). O **n8n** é retirado do caminho crítico transacional (*hot path*) e mantido exclusivamente para automações auxiliares e administrativas.

---

## 1. Contexto

Durante as fases iniciais de validação (MVP V1 até o Gate B — WP6.9), a combinação entre **Evolution API** (instância Baileys/WhatsApp-Business) e **n8n** desempenhou papel crucial para homologar rapidamente a proposta de valor do marketplace, os fluxos conversacionais e a experiência de ações interativas (*button-first* e *templates* de utilidade).

Entretanto, o crescimento da plataforma e a necessidade de garantias rigorosas de entrega expuseram limitações estruturais desse arranjo intermediário no caminho crítico:

1. **Latência de Polling no Despacho:** O despachador de mensagens de saída (`outbox-dispatcher.json`) opera via ciclos de polling periódico a cada 45 segundos no n8n. Essa abordagem introduz atraso artificial de até 45 segundos na entrega de solicitações de oportunidade a profissionais e respostas a clientes.
2. **Ponto Único de Falha e Intermediário Operacional:** A presença do n8n no *hot path* transacional adiciona múltiplos saltos de rede HTTP, complexidade na gestão de instâncias e sobrecarga de CPU em execuções de grafos JSON para tarefas de roteamento simples.
3. **Instabilidade de Sessão no Gateway Não-Oficial:** A dependência da Evolution API implica riscos operacionais recorrentes inerentes a conexões baseadas em emulação de WhatsApp Web (desconexões de socket, bugs de normalização de 9º dígito móvel brasileiro e discrepâncias na emissão de webhooks de status).
4. **Alinhamento com a API Oficial da Meta:** A contratação e o uso direto da **WhatsApp Cloud API (Meta Graph API)** oferecem canal oficial sem necessidade de manter sessões abertas via QR Code, garantia de alta disponibilidade global pela infraestrutura da Meta, suporte nativo a WAMIDs determinísticos e entrega em conformidade de templates de autenticação (OTP) e utilidade.

---

## 2. Decisão Arquitetural

Fica estabelecida como arquitetura-alvo canônica (**TARGET**) do ContatoCerto:

$$\mathbf{Meta\ WhatsApp\ Cloud\ API} \iff \mathbf{ContatoCerto\ API\ (Fastify)} \iff \mathbf{PostgreSQL\ (PostGIS)} + \mathbf{Redis\ /\ BullMQ} \iff \mathbf{ContatoCerto\ Workers}$$

### 2.1. Classificação dos Componentes Legados

* **Evolution API:**
  $$\mathbf{TEMPORARY\_FALLBACK\_THEN\_DECOMMISSION}$$
  A Evolution API permanecerá provisionada e configurada estritamente como mecanismo de contingência (*fallback*) durante as fases de transição e homologação da Meta Cloud API. Uma vez concluído o dreno de mensagens e a validação de estabilidade, a Evolution será integralmente descomissionada.
* **n8n:**
  $$\mathbf{REMOVED\_FROM\_TRANSACTIONAL\_HOT\_PATH\ /\ RETAINED\_FOR\_AUXILIARY\_AUTOMATIONS}$$
  O n8n deixará de receber webhooks de clientes/profissionais e não realizará mais o polling ou envio de mensagens transacionais da Outbox. Ele será mantido no ecossistema exclusivamente para fluxos auxiliares, relatórios analíticos, alertas operacionais (Slack/Telegram) e integrações de backoffice não críticas.

---

## 3. Cláusulas Mandatórias do Contrato Arquitetural

### Cláusula A — Meta WhatsApp Cloud API Oficial e Versão da Graph API
* A comunicação com o WhatsApp ocorrerá exclusivamente através da **Meta WhatsApp Cloud API (Graph API direta)** via chamadas HTTPS autenticadas por Bearer Token.
* A versão da Graph API deve ser explicitamente configurável por variável de ambiente: `META_GRAPH_API_VERSION`.
* **Versão inicial homologada e aprovada:** **`v26.0`**.
* **Proibição de Defaults Silenciosos:** Fica expressamente vedado o uso de defaults silenciosos legados (como `v22.0`). Os ambientes de homologação e produção devem definir explicitamente `META_GRAPH_API_VERSION=v26.0`.

### Cláusula B — PostgreSQL como Autoridade Canônica e Fonte da Verdade
* O **PostgreSQL** é e permanece como a **Única Fonte Canônica da Verdade (Source of Truth)** de todo o domínio.
* O PostgreSQL detém a autoridade absoluta sobre:
  * Mensagens de entrada (`channel_inbound_messages`);
  * Mensagens de saída (`channel_outbound_messages`);
  * Recibos assíncronos e auditoria imutável (`channel_outbound_receipts`);
  * Status transacionais de ciclo de vida (`received`, `processing`, `processed`, `pending`, `sent`, `failed`);
  * Leases de concorrência e tokens atômicos (`processing_token`, `processing_started_at`);
  * Máquina de retentativas e agendamento (`attempt_count`, `next_attempt_at`);
  * Idempotência de negócio e constraints únicas (`business_key`, `event_fingerprint`, `UNIQUE(provider, provider_message_id)`);
  * Quarentena e recuperação de mensagens órfãs (`channel_inbound_recovery_events`).
* **Invariante:** O BullMQ **não** é fonte da verdade de negócio.

### Cláusula C — BullMQ / Redis como Camada Efêmera de Execução
* O **Redis** e o framework **BullMQ** atuarão estritamente como **Camada de Execução (Execution Layer)** e acelerador de eventos:
  * Despacho reativo instantâneo de mensagens (sub-segundo vs 45s de polling);
  * Distribuição equilibrada de carga entre processos workers;
  * Isolamento de processamento e controle de concorrência;
  * Absorção de picos de tráfego de entrada.
* **Invariante de Durabilidade:** O Redis **nunca** poderá ser a única cópia de uma mensagem ou evento de negócio. Na eventualidade de perda total ou reinicialização do Redis sem persistência, o PostgreSQL deve possuir 100% dos dados para reidratar as filas e prosseguir a operação sem inconsistências.

### Cláusula D — Semântica de Processamento e Idempotência
* A arquitetura adota a premissa de processamento **no mínimo uma vez** (`AT_LEAST_ONCE_PROCESSING_POSSIBLE`).
* **Invariante:** Todos os manipuladores de jobs e workers com efeitos colaterais externos devem ser rigorosamente **idempotentes**, assegurados pelas constraints e locks do PostgreSQL.

### Cláusula E — Nomenclatura e Formato de Job IDs no BullMQ
* É expressamente **proibido o uso do caractere dois-pontos (`:`)** dentro de Job IDs customizados no BullMQ, prevenindo colisões e quebras de parsing com o separador padrão de chaves do Redis.
* **Padrão Canônico Aprovado:**
  * Inbound: `inbound-<inboundId>` (onde `inboundId` é o UUID de `channel_inbound_messages`)
  * Outbound: `outbound-<outboundId>` (onde `outboundId` é o UUID de `channel_outbound_messages`)
* A deduplicação nativa de Job IDs do BullMQ atua como filtro de conveniência e performance; a garantia final de unicidade reside nas transações com lock (`FOR UPDATE SKIP LOCKED`) do PostgreSQL.

### Cláusula F — Autoridade Estrita de Retries para Outbound
* **Proibição de Duplicação de Autoridade:** Fica proibida a coexistência de lógicas concorrentes de retry entre BullMQ e banco.
* **O PostgreSQL é a única autoridade de retry para o canal WhatsApp.**
* Devem ser preservados integralmente os mecanismos e políticas de outbox já consolidados:
  * `attempt_count` e `next_attempt_at`;
  * Teto de 5 tentativas (`OUTBOX_MAX_ATTEMPTS = 5`);
  * Escala canônica de backoff exponencial (`OUTBOX_RETRY_BACKOFF_SECONDS`: 30s, 60s, 120s, 300s, 600s);
  * Leases transacionais (`processing_started_at + lease_seconds`).
* O BullMQ deve operar com `attempts: 1` em jobs de envio externo. Falhas de envio atualizam `attempt_count` e `next_attempt_at` no Postgres, cabendo ao sweeper re-enfileirar quando o prazo maturar.
* **Operação Conservadora do Worker (Zero Blind Resend):**
  * Diante de qualquer resposta incerta ou ambígua (ex.: requisição HTTP despachada à Meta Graph API seguida de queda de conexão, socket hangup ou timeout antes do recebimento do corpo JSON), o worker **nunca deve presumir que a mensagem não foi transmitida**.
  * É expressamente vedado o reenvio cego imediato (*blind resend*).
  * O registro deve transicionar para estado de retenção via `delivery_hold_reason = 'transport_outcome_unknown'`, exigindo reconciliação por recibo assíncrono posterior ou procedimento de conferência operacional.

### Cláusula G — Fluxo Inbound (Webhook Meta)
* O endpoint HTTP da API Fastify receptor de webhooks da Meta deve:
  1. Validar a assinatura criptográfica `X-Hub-Signature-256`;
  2. Normalizar os dados conforme os contratos existentes do `@contatocerto/shared`;
  3. **Persistir primeiro no PostgreSQL** na tabela `channel_inbound_messages` com cláusula idempotente `ON CONFLICT (provider, provider_message_id) DO NOTHING`;
  4. Realizar tentativa assíncrona não bloqueante de enqueue do Job ID (`inbound-<inboundId>`) na fila BullMQ `whatsapp-inbound`;
  5. Retornar resposta HTTP 200 OK para a Meta em tempo inferior a 200ms.
* Caso o Redis esteja temporariamente fora do ar ou o enqueue falhe após a confirmação do commit no Postgres, o evento **não é perdido**: um scheduler periódico no worker realiza a varredura de inbounds com status `'received'` e reintroduz seus IDs na fila.

### Cláusula H — Segurança, Handshake e Validação de Webhooks
* **Handshake (Verificação):** Rota `GET /webhooks/whatsapp` responde ao desafio de verificação da Meta:
  * Valida `hub.mode === 'subscribe'`;
  * Valida `hub.verify_token === META_WEBHOOK_VERIFY_TOKEN`;
  * Retorna o valor de `hub.challenge` como corpo de texto puro (`text/plain`) com status HTTP 200.
* **Ingestão:** Rota `POST /webhooks/whatsapp` captura obrigatoriamente o **RAW BODY original** (buffer antes de qualquer transformação JSON).
* **Validação Criptográfica de Assinatura:**
  * O hash de assinatura é computado via `crypto.createHmac('sha256', META_APP_SECRET).update(rawBody).digest('hex')`.
  * A comparação com o header `X-Hub-Signature-256` deve utilizar estritamente tempo constante (`crypto.timingSafeEqual`) contra ataques de temporização.
  * Rejeição imediata com HTTP 401 Unauthorized se a assinatura divergir ou o header estiver ausente.
* **Proteção de Segredos:** O `META_APP_SECRET` nunca deve ser impresso em logs, traces ou exceções.

### Cláusula I — Filas Iniciais Aprovadas (Escopo Enxuto)
* Para manter a complexidade operacional mínima na primeira fase, aprovam-se **apenas duas filas no BullMQ**:
  1. `whatsapp-inbound`: Despacho de mensagens recebidas persistidas para processamento conversacional e de busca.
  2. `whatsapp-outbound`: Despacho de mensagens preparadas na outbox para envio HTTP na Meta Graph API.
* **Proibição de Filas Adicionais Prematuras:** Fica vedada a criação de fila de `media-transcription` neste pacote. A custódia e transcrição de áudios permanecem provisoriamente sob a responsabilidade do workflow auxiliar `media-consumer.json` no n8n ou aguardarão pacote de trabalho específico.

### Cláusula J — Runtime e Isolamento de Processos
* A API e os Workers de mensageria devem constituir **processos de execução independentes**:
  * `contatocerto-api`: Servidor Fastify atendendo tráfego web, rotas internas e webhooks.
  * `contatocerto-worker`: Processo executor executando os workers do BullMQ e schedulers de reconciliação.
* Ambos os serviços compartilham o mesmo repositório, código-fonte e imagem base Docker (`Dockerfile`), porém operam com entrypoints e configurações de réplicas distintas, assegurando:
  * Escalonamento horizontal assimétrico (escalar workers sem multiplicar a API pública);
  * Reinicialização de workers sem derrubar a porta de entrada de webhooks;
  * Isolamento estrito de consumo de CPU/memória.

### Cláusula K — Contrato de Produção do Redis
* Quando o Redis for provisionado em ambiente de produção (via EasyPanel ou serviço gerenciado):
  * **Política de Memória:** Configuração estrita de `maxmemory-policy=noeviction`. O Redis jamais deverá descartar chaves de fila ou jobs silenciosamente sob pressão de memória.
  * **Persistência em Disco:** Habilitação de AOF (`appendonly yes`, `appendfsync everysec`) recomendada para tolerância a falhas transitórias de infraestrutura.
  * **Isolamento de Rede:** O Redis deve ser estritamente privado, acessível exclusivamente pela rede interna do EasyPanel, sem mapeamento de portas públicas na internet.

### Cláusula L — Utilização da API Moderna de Schedulers do BullMQ
* Rotinas periódicas e cron jobs no BullMQ (como o sweeper de reconciliação de outbox) devem utilizar a API moderna de **Job Schedulers** (`Queue.upsertJobScheduler`).
* É vedado o uso da API legada de Repeatable Jobs (`queue.add(..., { repeat: ... })`), descontinuada nas versões recentes do BullMQ.

### Cláusula M — Transactional Outbox e Prevenção de Dual-Write
* Fica vedada a criação de tabelas secundárias de outbox. A tabela `channel_outbound_messages` permanece como o registro durável canônico existente.
* O padrão arquitetural adotado para mitigar o problema do *Dual-Write* (PostgreSQL vs Redis) é:
  1. O serviço de domínio insere a mensagem em `channel_outbound_messages` com `status = 'pending'` **dentro da mesma transação ACID de negócio**;
  2. Imediatamente após a confirmação do `COMMIT`, é disparado um enqueue não bloqueante do job `outbound-<outboundId>` no BullMQ;
  3. **Safety Net (Sweeper de Reconciliação):** Um BullMQ Job Scheduler leve (executado a cada 30 segundos) consulta o PostgreSQL via query com lock não bloqueante (`FOR UPDATE SKIP LOCKED`) por mensagens em `pending` criadas há mais de 15 segundos que não foram consumidas, reinjetando seus IDs na fila de execução.

### Cláusula N — Compatibilidade Integral da Migration 030 (`channel_outbound_receipts`)
* `MIGRATION_030_REUSABLE_WITH_DIRECT_META=YES`.
* A tabela imutável `channel_outbound_receipts`, os índices por `(provider, provider_message_id)`, as triggers de bloqueio a mutações (`OUTBOUND_RECEIPT_IMMUTABLE`) e a geração canônica de fingerprints SHA-256 já suportam nativamente os identificadores WAMID e os estados enviados nos callbacks de status da Meta (`sent`, `delivered`, `read`, `failed`).
* Nenhuma alteração de schema é necessária na Migration 030. Ela permanece inalterada e não será executada em produção neste pacote.

### Cláusula O — Autenticação Profissional Sem Senha (WP-A)
* O design de entrega de OTP sem senha especificado em WP-A (Migration 022) através do payload transitório `template_authentication` (`contatocerto_auth_otp_v1`) já reflete com precisão os parâmetros exigidos pela Meta para templates de autenticação (código OTP no corpo e parâmetro no botão de cópia de código em índice 0).
* O contrato `template_authentication` é 100% reutilizável pelo provedor direto da Meta Cloud API.
* A autenticação de profissionais permanece formalmente **PAUSADA** (`PROFESSIONAL_AUTH_ENABLED=false`).

### Cláusula P — Destino do PR #8 da Evolution API
* O PR #8 do repositório da Evolution API (`fix/cc-meta-status-receipts-hardening`, commit `cacceb34702891ffdedda7f9b1f92bbc96747e16`), projetado para corrigir o tratamento de status de WAMID na camada Evolution, é classificado como:
  * `PR8_STILL_NEEDED_FOR_TARGET_ARCHITECTURE=NO` (a arquitetura-alvo conecta-se diretamente à Meta sem passar pela Evolution);
  * `PR8_MERGE_NOW=NO` (não alterar produção ou instâncias da Evolution desnecessariamente);
  * `PR8_PRESERVE_AS_FALLBACK=YES` (a branch deve permanecer congelada como salvaguarda caso seja necessário operar temporariamente via Evolution).

---

## 4. Invariantes Arquiteturais Estritos

1. **Postgres Primeiro:** Nenhuma mensagem (inbound ou outbound) é processada ou despachada sem estar previamente persistida de forma durável no PostgreSQL.
2. **Sem Fila como Fonte Única:** Nenhum dado crítico de negócio existirá exclusivamente no Redis.
3. **Fencing Obrigatório:** Nenhuma mensagem outbound é despachada externamente sem reserva transacional com lock determinístico no banco (`FOR UPDATE SKIP LOCKED`).
4. **Zero Blind Resend:** Resultados incertos ou timeouts de rede em chamadas à Meta nunca autorizam reenvio automático cego.
5. **Barreira de Autenticidade:** Webhooks sem assinatura válida comprovada via HMAC SHA-256 são descartados na borda e jamais alcançam a camada de domínio.
6. **WAMID Canônico:** O identificador oficial da Meta (`wamid`) é persistido fielmente como `provider_message_id`.
7. **Recibos Observacionais:** Recibos assíncronos (`channel_outbound_receipts`) são puramente de telemetria e auditoria; nunca reiniciam retentativas ou mutam o status de disparo da outbox.
8. **Exclusão Mútua de Provedores:** Evolution e Meta nunca podem despachar simultaneamente mensagens da mesma Outbox.
9. **Chave Única de Envio:** Apenas um provedor outbound ativo estará habilitado por vez em produção (`WHATSAPP_PROVIDER`).

---

## 5. Roteiro Sequencial de Pacotes de Trabalho (WPs)

| Pacote | Nome do Pacote | Objetivo e Escopo |
| :---: | :--- | :--- |
| **WP-DM0** | Architecture Contract Freeze | Formalização do contrato arquitetural canônico em ADR e documentação (este pacote). |
| **WP-DM1** | Direct Meta Provider | Implementação do cliente HTTP tipado `MetaCloudWhatsAppProvider` para envio à Graph API v26.0 com testes de contrato e unitários isolados. |
| **WP-DM2** | Queue + Worker Foundation | Configuração da infraestrutura de Redis, BullMQ, inicialização do processo independente `contatocerto-worker` e schedulers. |
| **WP-DM3** | Direct Meta Webhook | Implementação dos endpoints Fastify `GET /webhooks/whatsapp` e `POST /webhooks/whatsapp` com validação de assinatura `X-Hub-Signature-256`. |
| **WP-DM4** | Outbound Worker Integration | Integração do worker de saída com a tabela `channel_outbound_messages` e `MetaCloudWhatsAppProvider`. |
| **WP-DM5** | Status / Receipt Integration | Conexão do webhook de status da Meta ao serviço `ChannelOutboundService.recordReceipt` e tabela imutável (Migration 030). |
| **WP-DM6** | Shadow / Canary Validation | Validação ponta a ponta em ambiente de homologação e envio de mensagens para números canários autorizados. |
| **WP-DM7** | Controlled Production Cutover | Alternância controlada da variável `WHATSAPP_PROVIDER=meta` em produção e apontamento do webhook no painel Meta Developers. |
| **WP-DM8** | Remove n8n Hot Path & Evolution Drain | Desativação dos workflows `gateway.json`, `shared-delivery.json` e `outbox-dispatcher.json` no n8n após esgotamento de filas. |
| **WP-DM9** | Decommission Evolution | Desligamento do contêiner da Evolution API no EasyPanel e limpeza de configurações legadas. |

> **Nota Técnica sobre o Encadeamento WP-DM1 e WP-DM2:**
> O pacote **WP-DM1** (Direct Meta Provider) é deliberadamente posicionado antes de **WP-DM2** (Queue + Worker Foundation) porque o cliente HTTP de transporte da Meta e seus respectivos testes unitários com fixtures da Graph API são módulos puramente isolados em `@contatocerto/shared` e `apps/api`. Essa ordem permite congelar a camada de comunicação externa com a Meta sem introduzir dependências de runtime de Redis ou workers simultaneamente.

---

## 6. Governança de Contratos Compartilhados

A auditoria no monorepo confirmou que os contratos em `packages/shared/src/schemas/` já foram modelados de forma agnóstica a provedores:
* `channelInboundMessageRequestSchema`
* `channelOutboundMessageClaimResponseSchema`
* `recordChannelOutboundReceiptSchema`
* `channelLocationInputSchema`

**Diretriz:** Fica expressamente **vedada a criação de schemas redundantes** (ex.: `meta-cloud.ts`). O futuro adaptador Meta Cloud API deve simplesmente converter o payload nativo recebido da Graph API nos schemas canônicos já existentes no `@contatocerto/shared`.

---

## 7. Consequências e Compromissos

### Positivas
* **Eliminação de Latência:** Redução drástica do atraso de envio (de ~45 segundos para centenas de milissegundos).
* **Resiliência e Confiabilidade:** Eliminação de desconexões de sessão do WhatsApp Web e garantia oficial de entrega pela Meta.
* **Simplificação Operacional:** Remoção do n8n do caminho crítico de transações, reduzindo o número de contêineres acoplados à jornada de busca do cliente.
* **Segurança Reforçada:** Verificação criptográfica nativa de todos os webhooks com `X-Hub-Signature-256` em tempo constante.

### Negativas / Mitigações
* **Dependência do Redis:** Introduz o Redis como dependência de infraestrutura para os workers, mitigado pela garantia de que o PostgreSQL permanece como a fonte da verdade durável e capaz de operar como rede de segurança (*sweeper*).
* **Custos de Mensageria Meta:** Sujeição às regras e tarifação de conversas de serviço/utilidade da Meta Cloud API, mitigadas pela arquitetura de mensagens atômicas e templates aprovados.
