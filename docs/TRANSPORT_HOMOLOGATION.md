# Transporte n8n–Evolution — candidato inativo

Checkpoint iniciado em `4dca0216a74714987a33a6ac856ce1b0e353d6f6`, branch
`codex/marketplace-v1-completion`. Não houve importação, ativação, deploy, mudança
no n8n instalado, chamada a transcritores nem WhatsApp real. B2 permanece desligada.

## Fonte e limites da verificação

| Componente | Versão / evidência |
| --- | --- |
| Evolution API | 2.3.7, commit `cd800f2976e1e5b682fbf86a01ee4d85ae61f370` (tag anotada `6a398a6a08e59eb87dcf98b0f389e8decaf08689`) |
| n8n | 1.123.21, commit `7762bef712ee7da86b5d84f23212463e7a745064` |
| Community node | `n8n-nodes-evolution-api` 1.0.4, manifesto público npm; **não usado pelos novos exports**, nem desinstalado/atualizado |
| Gateway fornecido | `WhatsApp Gateway.json`, SHA-256 `6986269AEDE6C7FFC65FAB588A6D9F4D770A418E13E39561E59215073043F851` |

O export fornecido foi inspecionado localmente, mas não copiado para o Git:
contém credenciais em texto plano. **Operador deve rotacionar as chaves interna,
Groq e OpenAI expostas no export**, revisar cópias/compartilhamentos e vincular
credenciais no cofre. Não reutilizar esses valores em fixtures. Exemplos/testes
deste checkpoint são sintéticos, com `.invalid`, IDs e telefones fictícios.

Verificação estática de código/contratos não é execução do motor n8n. Importação,
resolução das credentials/Variables, JWT real, binário, proxy e associação de itens
exigem o ensaio abaixo nas versões informadas. Não declarar transporte homologado
nem qualidade conversacional B2 com base nestes testes.

## Decisões verificadas na versão exata

1. O [WebhookController 2.3.7](https://github.com/evolution-foundation/evolution-api/blob/cd800f2976e1e5b682fbf86a01ee4d85ae61f370/src/api/integrations/event/webhook/webhook.controller.ts)
   suporta headers locais e `jwt_key`: produz JWT HS256, `app=evolution`,
   `action=webhook`, `iat` e `exp` de dez minutos, enviado em Authorization.
   Configurar webhook **local**, somente `MESSAGES_UPSERT`, `byEvents=false`,
   `base64=true`; desabilitar duplicação pelo webhook global.
2. O [Webhook do n8n fixado](https://github.com/n8n-io/n8n/blob/7762bef712ee7da86b5d84f23212463e7a745064/packages/nodes-base/nodes/Webhook/utils.ts)
   valida JWT com algoritmo restrito pela credential e expiração; injeta
   `jwtPayload` fora do body. O gate verifica app/action, janela, instância,
   `server_url`, formato, evento e destinatário. **JWT autentica a origem, não
   assina o body**: não contém hash do evento, nonce individual ou audience.
   Um bearer capturado é reutilizável na janela; TLS, rede restrita, segredo
   dedicado e deduplicação são necessários. Instância/server_url não provam
   origem sozinhos. Nunca confiar em `body.jwtPayload` ou `body.apikey`.
3. [sendMessageWithTyping](https://github.com/evolution-foundation/evolution-api/blob/cd800f2976e1e5b682fbf86a01ee4d85ae61f370/src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts)
   pode converter erro **posterior ao envio** em 400. Logo, 400/403/404/422/429
   genéricos também vão para hold. Somente o envelope exato de 401 do
   [authGuard](https://github.com/evolution-foundation/evolution-api/blob/cd800f2976e1e5b682fbf86a01ee4d85ae61f370/src/api/guards/auth.guard.ts)
   comprova rejeição antes do controller. Mesmo nesse caso o retry é da API,
   limitado/backoff; corrigir a credential, não insistir manualmente no envio.
4. Sucesso usa o `key` da raiz, retornado pelo HTTP direto: ID não vazio,
   `fromMe=true` e `remoteJid` exatamente correspondente ao claim. Não usar o
   wrapper `data.key` do community node. JID divergente fica retido, inclusive
   se a Evolution normalizar um número de forma diferente da esperada.
5. O [HTTP Request V3](https://github.com/n8n-io/n8n/blob/7762bef712ee7da86b5d84f23212463e7a745064/packages/nodes-base/nodes/HttpRequest/V3/HttpRequestV3.node.ts)
   tenta JSON.parse em body string no formato JSON, inclusive vazio. Os exports
   usam **fullResponse + text + outputPropertyName=body**, depois parse controlado.
   204 não depende de JSON válido; corpo inválido jamais autoriza transporte.

### Compatibilidade estática dos nodes

| Node usado | typeVersion | Contrato conferido na tag n8n |
| --- | --- | --- |
| Webhook | 2.1 | POST, jwtAuth, responseNode, jwtPayload verificado |
| Respond to Webhook | 1.4 | JSON, código via options.responseCode, conserva item de entrada |
| HTTP Request | 4.2 | multipart, fullResponse, text/body, neverError, timeout, redirects desligados |
| Code | 2 | execução por item; runOnceForAllItems nos budgets/loops |
| If | 2.2 | condições booleanas, options.version=2, duas saídas |
| Convert to File | 1.1 | toBinary, sourceProperty, binaryPropertyName, fileName/mimeType |
| Execute Workflow | 1.2 | source=database, workflowId resource locator mode=id, mode=each, espera |
| Execute Workflow Trigger | 1.1 | inputSource=passthrough |
| Schedule Trigger | 1.2 | intervalo em segundos, dez segundos |

Fontes de nodes estão sob `packages/nodes-base/nodes` no commit n8n acima:
`Webhook`, `RespondToWebhook`, `HttpRequest/V3`, `Code`, `If/V2`,
`Files/ConvertToFile`, `ExecuteWorkflow` e `Schedule`. `onError=continueRegularOutput`
retorna erro para o gate, não para retry de transporte. `$vars` depende também da
edição/licença/configuração instalada: validar antes de ativar; se indisponível,
parametrizar valores não secretos nos nodes e revalidar o export do ambiente.
O manifesto 1.0.4 declara Node >=18.10 e peer n8n-workflow `*`; isso não comprova
execução de suas operações. Ele deixa de ser dependência deste transporte.

## Caminhos implementados

Texto/extendedTextMessage → JWT/envelope/filtros → Inbox → ACK → claim por ID →
**Shared Outbox Delivery**. A resposta citada não vira comando; captions/grupos/
broadcast/próprias e outros eventos não entram na Inbox. `@lid` só usa o telefone
do `remoteJidAlt` do mesmo evento autenticado; dois telefones conflitantes rejeitam.
E.164 não é inferido a partir de LID, sender, texto ou campo arbitrário.

Preservado o namespace instalado: `provider_message_id = instance + ':' + key.id`.
Não mudar para somente key.id: isso quebraria a deduplicação histórica. Texto
é limitado a 500 caracteres (contrato real da Inbox), sem truncar comandos.
O gateway envia objetos JSON, não interpolação de string com conteúdo do usuário.
Uma execução faz uma chamada à Inbox; reentregas usam o mesmo ID e o servidor
garante efeitos/Outbox únicos. Payload conflitante continua 409, sem sobrescrita.

ACK ocorre após resultado durável da Inbox, antes do claim/envio. Resultado 409
de processamento em andamento recebe ACK, pois recovery recupera o registro.
Falha de API/corpo inválido não recebe falso sucesso. 200 sem Outbox válida é erro;
204 sem corpo é encerramento seguro. O contrato normal atual sempre tem Outbox.
Recovery só processa entradas, sem Evolution; o dispatcher entrega sua Outbox.
Gateway e dispatcher podem disputar; apenas um token autoriza o envio.

Shared usa exclusivamente destinatário/texto/finalidade/token do claim. 204/409/
sent encerram; claim inválido ou erro de autenticação interrompem sem envio.
Timeout/conexão/5xx/aceitação inválida → hold. `/sent` pode ser repetido (3×),
nunca o transporte. Confirmação perdida → hold confirmation_pending; ID recebido
é conservado na saída mínima do consumidor, sem incluir texto/telefone/token.
O recibo fica no banco quando `/sent` chega. Se toda a API cair, nem hold nem
recibo podem ser persistidos: **parar consumidores e reconciliar antes da lease
ser reutilizada**. Não existe garantia exactly-once fora do banco/provider.

### Áudio durável (020)

A exceção one-shot foi removida. Gateway persiste mídia/aviso na API antes do ACK;
consumer separado transcreve sob lease; Inbox Recovery processa o resultado;
Shared Delivery entrega o notice. Limites, quarentena, expurgo e intervenção em
[TRANSPORT_DURABILITY.md](TRANSPORT_DURABILITY.md). Transcrição real permanece
pendente. Nenhum workflow foi importado/ativado.

## Configuração futura (nenhuma aplicada)

**API/EasyPanel:** nenhuma variável nova; nova migration020. Aplicar todas as pendentes,
inclusive **017, 018, 019, 020**, antes da API compatível. Manter B2=false. Lease existente
da Outbox >=60s. Os exports precisam de API com holds/recibos/fencing da branch.

**Variables n8n** (nenhuma é segredo; obrigatório, sem default):

| Nome | Uso |
| --- | --- |
| CONTATOCERTO_API_BASE_URL | Origem interna da API, sem barra final |
| EVOLUTION_API_BASE_URL | Origem da Evolution confiável, sem barra final |
| EVOLUTION_INSTANCE | Instância permitida, idêntica à já usada no namespace |
| EVOLUTION_PROVIDER | Provider existente, ex.: evolution; não renomear dados |
| CONTATOCERTO_DELIVERY_WORKFLOW_ID | ID após importar Shared Outbox Delivery |
| EVOLUTION_WEBHOOK_ORIGIN | **Nova**: server_url exato anunciado pela Evolution (pode diferir da URL interna) |

**Credentials n8n** (somente nomes/tipos no export):

| Nome | Tipo e configuração, valores somente no cofre |
| --- | --- |
| ContatoCerto Internal API | httpHeaderAuth, X-Internal-Key |
| ContatoCerto Evolution | httpHeaderAuth, apikey |
| ContatoCerto Evolution Webhook JWT | jwtAuth, keyType=passphrase, algorithm=HS256, segredo aleatório dedicado igual a webhook.headers.jwt_key |
| ContatoCerto Groq Transcription | httpHeaderAuth, Authorization: Bearer (chave Groq) |
| ContatoCerto OpenAI Transcription | httpHeaderAuth, Authorization: Bearer (chave OpenAI) |

Nunca colocar JWT secret em `$vars`, URL, JSON versionado ou INTERNAL_API_KEY.
Preferir webhook acessível só pela rede interna e TLS. Na borda exigir POST/JSON,
limite real de corpo 5 MiB (antes do parser), taxa inicial conservadora por origem
de 5 req/s com burst 20, revisar com carga e retries; negar acesso público direto
ao backend. Limite no gate não evita alocação no parser. Desativar logging de
body/headers e tracing/binary externo; verificar a configuração efetiva do proxy.
Desabilitar o log WEBHOOKS da Evolution: o envelope 2.3.7 contém apikey e dados
pessoais. Não salvar success/error/manual/progress no n8n para estes exports.
Isso exige alertas sanitizados (ID/código) e investigação restrita no provider/API,
não a reativação indiscriminada de dumps. Política de retenção exige responsável.

Timeouts: envio 15s; confirmações 5s, até três tentativas; shared 55s. Dispatcher
10 itens/45s para iniciar, execução até105s; recovery HTTP70s/execução120s;
gateway Inbox70s + claim15s + shared55s, execução140s; áudio usa admissão15s.
Consumer de mídia: transcrição até20s + persistência5s×3, execução55s/lease60s.
O timeout do webhook na origem/proxy deve comportar o ACK (antes do envio, até
70s para texto ou15s para admissão de áudio); a Evolution padrão pode repetir em30s. Homologar configuração
de timeout/retries sem assumir que o ambiente já a alterou. Não desativar
idempotência para contornar reentregas.

## Runbook manual — NÃO executado

1. Confirmar ambiente controlado, versões, SHA/CI, backup criptografado dos
   workflows/credentials/config e banco restaurável; bloquear números não autorizados.
2. Rotacionar as chaves do export compartilhado. Pausar gateway/consumidores antigos
   no ambiente do ensaio. Conferir migrations 001–020 e API/B2 desligada.
3. Importar **inativos** shared-delivery, outbox-dispatcher, inbox-recovery, media-consumer e gateway.
   Não ligar gateway antigo e novo ao mesmo tempo.
4. Criar Variables/credentials da tabela. Associar o ID real do shared nos dois
   consumidores. Conferir nomes/IDs de credentials, origem e todas as URLs.
5. Configurar webhook local Evolution com jwt_key dedicado, JSON, instância,
   MESSAGES_UPSERT/base64 e URL interna; proxy limita corpo/taxa/método. Conferir
   persistência dos headers após reinício. Assinatura ausente/incorreta/expirada
   deve falhar antes da Inbox. Validar JWT sem registrar seu bearer.
6. Com autorização separada para transcrição e um número de teste, executar a matriz
   abaixo. Identificar remetentes cliente/profissional distintos. Observar DB/API
   com acesso restrito; nunca compartilhar dumps de telefone/áudio/token.
7. Injetar falhas em proxy de teste (não produção): recusa auth, timeout após aceite,
   desconexão e perda da confirmação. Conferir holds/recibos/sem reenvio.
8. Disputar gateway e dispatcher, repetir webhook, reiniciar consumidor e consultar
   diagnósticos. Conferir shown_at somente após sent; seleção/consentimento intactos.
9. Reconciliar hold com `/outbound/:id/disposition` e evidência verificada na Evolution:
   confirm/retry/close/retain, request_id e operator_id. Resultado incerto permanece
   retido. Não limpar evidências/leases; ação administrativa revoga o token antigo.
10. Coletar SHA, versões, caso, horários, status, IDs opacos e contagens; guardar
    evidências sensíveis separadamente. Revisão humana do áudio/WhatsApp é obrigatória.
11. Rollback de workflow: pausar ingresso/consumidores, reconciliar trabalho em voo,
    restaurar backup **inativo**, revisar antes de ligar. Não restaurar a política
    antiga de retry de qualquer erro nem fazer downgrade do banco para perder holds.
12. Só autorizar ativação após matriz crítica aprovada, segredos rotacionados,
    alertas/timeout/rede e durabilidade do áudio020 validados no ambiente de ensaio.
    Sem esse gate, manter inativo. O ensaio não autoriza B2 real nem lançamento V1.

| Caso | Ação no ensaio | WhatsApp | Inbox | Outbox | Evidência / aprovação |
| --- | --- | --- | --- | --- | --- |
| Texto/extended/citação | Enviar pedido com aspas/emoji e resposta citada | Uma resposta ao texto novo | Um processed | Uma customer_reply/sent | Texto fiel, sem comando extra |
| Próprio/grupo/unsupported | Reemitir envelopes | Nenhuma resposta | Nenhuma linha | Nenhuma linha | Zero efeito |
| Auth/origem | JWT ausente/errado/expirado, instância alheia | Nenhuma | Nenhuma | Nenhuma | 401/403 antes do domínio |
| Borda | Método/MIME/corpo/taxa inválidos | Nenhuma | Nenhuma | Nenhuma | Rejeição antes do processamento |
| Duplicado | Mesmo ID/payload duas vezes | Uma resposta | Mesmo ID/result | Mesmo ID | duplicate=true, uma entrega |
| Conflito | Mesmo ID/conteúdo diferente | Sem nova ação | Conflito auditado | Original preservada | 409, sem sobrescrita |
| Fila vazia/sent | Consumir sem trabalho/reclamar sent | Nenhum reenvio | Intacta | 204 ou sent | Sem transporte |
| Corrida | Gateway e dispatcher juntos | Uma entrega | Intacta | Uma lease efetiva | Token vencedor único |
| Aceitação | 201 com key consistente | Texto da Outbox | Processed | Sent/recibo/ID | Destinatário correto; shown_at após sent |
| Corpo/JID/ID ruim | Simular 2xx incompleto ou destinatário divergente | Incerto, não repetir | Processed | Hold | Nunca marcar sent sem evidência |
| 401 comprovado | Credential de teste inválida | Não entregue | Processed | Pending/backoff → limite | Uma falha por token |
| 400/403/404/422/429 genérico | Simular erro sem prova de rejeição | Incerto | Processed | Hold | Sem retry cego |
| Timeout/reset/5xx | Falhar depois de aceite | Pode ter chegado, sem nova tentativa | Processed | Hold | Evidência provider para reconciliar |
| Confirmação perdida | Perder resposta de sent | Uma entrega | Processed | Sent via replay ou hold | Repetir confirmação, nunca envio |
| Recovery | Queda após persistência Inbox | Entrega posterior | Retomada/FIFO/fencing | Shared pelo dispatcher | Mesmos efeitos/resultados |
| Áudio válido | Até120s, primary/fallback | Uma resposta do domínio | Uma transcrição/ID | Uma customer_reply | Binário sem logs, conteúdo validado por humano |
| Áudio longo/falha total | >120s ou dois transcritores falham | Um aviso durável da API | Placeholder fechado sem domínio | channel_notice único | Shared Delivery, hold e replay sem duplicação |
| Reentrega de áudio | Repetir evento/derrubar antes/depois do ACK | Mesmo evento durável | Mesmo ID e transcrição persistida; divergência em quarentena | Sem novo efeito de negócio | Homologar consumer e expurgo da020 |
| Notificação profissional | Outbox independente em teste | Destinatário da própria Outbox | Sem inbound necessário | Purpose/recibo preservados | Não usa telefone do gateway |

## Evidência automatizada e próximo checkpoint

`gateway-contract.test.mjs` cobre normalização, autenticação estrutural, filtros,
limites, transcrição/fallback, erros da Inbox, 204, grafo gerado e versões nativas.
`delivery-contract.test.mjs` cobre claims/finalidades, envio/hold/recibo e budgets.
`gateway-delivery.integration.test.ts` usa API e PostgreSQL reais, transporte
simulado: corrida gateway/dispatcher, replay/conflito, holds que bloqueiam claims,
auth rejection/backoff e transcrição na mesma Inbox. Suíte existente mantém
leases, seleção/shown_at, recovery, migrations protegidas/down/reaplicação.

Os 32 itens solicitados estão cobertos por esses contratos/integrações; autenticação
criptográfica no motor, envio real, áudio real e exactly-once externo não são
comprovados por simulação. Quantidades/CI final pertencem ao relatório de entrega
e ao run do SHA, não à versão de um export instalado.

Próximo checkpoint: homologação controlada da durabilidade/reconciliação implementadas
na020 e alertas/recibos operacionais, depois
avaliação B2 paga somente com autorização. Identidade/onboarding e demais etapas
da V1 continuam pendentes; este transporte não as conclui.

### Registro de QA

Run inicial [34499232704](https://github.com/koglim/contato/actions/runs/34499232704):
lint/typecheck/build, 303 API + 12 web + 40 workflows, B2 300 + readiness18,
127 integrações iniciais e migrations/rollbacks/reaplicação passaram. Na segunda
rodada houve uma falha preexistente probabilística no fixture B2: UUID concatenado
ao nome do serviço gerou oito ou mais dígitos, removidos corretamente pelo
sanitizador de PII, divergindo da asserção de texto literal. Os quatro testes
novos de transporte passaram nas duas rodadas. Correção restrita ao fixture:
suffix único somente alfabético; preservadas proteção, corpus e asserção estrita.
O CI final deve ser conferido no SHA posterior, não considerar esse run aprovado.

Correção validada: `860c3048e0c2ea838ef45e91fc09f4568c654c06`,
[CI 34500007769](https://github.com/koglim/contato/actions/runs/34500007769), **success**.
Instalação congelada, lint/typecheck/build, API303/web12/workflows40, B2 simulado300
e readiness18, 127 integrações PostgreSQL **nas duas rodadas**, migrations até019,
down protegido/compatível e reaplicação aprovados. Localmente passaram lint,
typecheck, build, testes e avaliações simuladas; PostgreSQL foi executado no CI
descartável (sem Docker/psql local). Exports reproduzíveis e diff sem erros.
Nenhum segredo do export original encontrado nos arquivos do repositório pelo
scan local, que não imprime valores. Isto não elimina a necessidade de rotação
das chaves que já estavam no arquivo compartilhado.


## Checkpoint 020 — durabilidade de áudio e intervenção

Implementação e critérios de aceite em [TRANSPORT_DURABILITY.md](TRANSPORT_DURABILITY.md).
Nova migration020; áudio/aviso antes do ACK, resultado persistido, leases/quarentena,
retenção, disposição auditada e diagnóstico agregado. CI inclui PostgreSQL real,
rollback protegido/compatível020–008 e reaplicação até020. Serviços externos
simulados; versões fixadas e exports inativos. Nenhuma variável/credential nova.
Publicação futura: todas as migrations pendentes (017–020 quando aplicável) antes
da API; depois cinco workflows ainda inativos e homologação autorizada. B2 off.
Não houve deploy/merge/envio/avaliação paga. V1 comercial continua incompleta.

---

## Homologação em Produção — Golden E2E #2 (2026-10-01)

Em 2026-10-01, após a unificação da consistência de identidade de cliente no fluxo contextual (PR #24) e atualização do contrato de transporte (PR #23), foi realizado o ensaio formal autorizado de ponta a ponta com instâncias ativas do n8n (`v1.123.21`), Evolution API (`v2.3.7`) e ContatoCerto API (`contatocerto-api` @ `909ab53853a5df2f5da2795ff86a653041fc7863`).

### 1. Arquitetura em Execução Validada
* **WhatsApp Gateway (`HwNYhTmAUT2NI7HW`):** Webhook de entrada ativo, validando payloads da Evolution API e despachando inbounds para o Channel Inbox (`/internal/channel/inbound`).
* **Shared Outbox Delivery (`qQYr6YpBsCttwO1S`):** Subworkflow de entrega unificada, executando classificação estrita de transporte (SHA-256 `09e44b9c8a618bc557e9697951b174c4728bba1ea9b4cf641675020c561b49b0`), envio HTTP para a Evolution API e confirmação idempotente via `/sent`.
* **Outbox Dispatcher (`L6aOjHDfdztAslwT`):** Worker periódico ativo (Schedule Trigger 30s) com orçamento e dreno de mensagens assíncronas de notificação.

### 2. Evidências do Ciclo E2E em Produção

| Etapa do Ciclo | Inbound / Gatilho | Gateway Exec ID | Outbound ID / Finalidade | Shared Delivery Exec ID | Dispatcher Exec ID | Evolution Provider Msg ID | Status Transporte |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **1. Busca / Apresentação** | Inbound texto "Preciso de um eletricista em Sinop" (`Contato Certo:3A4C00420AE15018A405`) | `957356` | `72ffe433-10e6-4890-ac29-3a9a2e18cf40` (`customer_reply`) | `957357` | N/A (entrega direta via Gateway) | `3EB033290A4CC069A552D0` | `sent` (201 Created) |
| **2. Seleção do Cliente (Farol)** | Inbound texto "2" (`Contato Certo:3ACC301E46EF43654338`) | `957450` | `c294a30f-11f3-4fe5-9917-c6260896f577` (`customer_reply`) | `957451` | N/A (entrega direta via Gateway) | `3EB0D8866D13B8800C9199` | `sent` (201 Created) |
| **3. Notificação ao Profissional** | Fila Outbox assíncrona gerada pela seleção | N/A | `efccaf96-e7ec-4947-86d8-85aa1a6b8d6d` (`professional_contact_notification`) | `957461` | `957460` | `3EB0B8E7A96BFA9E134B92` | `sent` (201 Created) |
| **4. Declaração de Conclusão** | Inbound profissional "Concluído CC-XKVLBBTF" (`Contato Certo:A54F9E724C150127401A9C8F595E34AD`) | `972785` | `600df159-2bec-4596-b0ac-62e28b49f6c9` (`professional_reply`) | `972786` | N/A (entrega direta via Gateway) | `3EB0597FA10F48B3059293` | `sent` (201 Created) |
| **5. Solicitação ao Cliente** | Fila Outbox assíncrona gerada pela declaração | N/A | `bd1efb81-7e89-4f25-a402-fa7eb7f866fb` (`customer_contact_update`) | `972794` | `972791` | `3EB07DAC2F01B9EE979CE6` | `sent` (201 Created) |
| **6. Confirmação do Cliente** | Inbound cliente "confirmar CC-XKVLBBTF" (`Contato Certo:3A8C35510FB1F1913F20`) | `973235` | `4653ae1a-f77e-487c-85fd-8c3600323462` (`customer_reply`) | `973236` | N/A (entrega direta via Gateway) | `3EB0D18D9F44920DA0E700` | `sent` (201 Created) |
| **7. Notificação Final Profissional** | Fila Outbox assíncrona gerada pela confirmação | N/A | `a1bd9919-a4d1-4049-899f-467492c25b43` (`professional_contact_notification`) | `973243` | `973240` | `3EB0C8A8F5BDE736DD95D1` | `sent` (201 Created) |

### 3. Invariantes de Transporte Comprovados em Produção
* **Zero Falhas de Transporte / Zero Holds:** Todos os 7 outbounds do Golden E2E #2 ficaram `status=sent`, com `provider_message_id` persistido e `delivery_hold_reason IS NULL`.
* **Conexão Estabelecida sem Aceite Prévio:** Contato `35c4ab81-fb23-4562-bb96-a09258546f31` estabelecido imediatamente como `shared` com código público `CC-XKVLBBTF`, notificando ambas as partes simultaneamente.
* **Ciclo Bilateral de Conclusão Confirmado:** A transição `pending_confirmation` -> `confirmed` -> `completed` ocorreu com total rastreabilidade de eventos no banco de dados e notificação recíproca.
* **Diferenciação Estrita de Evidências:**
  * **EVIDÊNCIA AUTOMATIZADA / CI:** Testes unitários, de arquitetura e integração (`apps/api/integration/`, 53 testes de workflow, mocks e banco isolado de CI).
  * **EVIDÊNCIA REAL DE PRODUÇÃO:** Execuções no n8n / EasyPanel documentadas na tabela acima com números e instâncias reais do WhatsApp e banco PostgreSQL de produção.

---

## Homologação em Produção — Edge Flows: Indisponibilidade (T29) e Contestação (T34) (2026-10-01)

Em 2026-10-01, após a homologação do happy path no Golden E2E #2, foram executados ensaios formais autorizados em produção real para os fluxos de exceção/borda:

### 1. Edge Flow #1: Indisponibilidade Profissional e Segunda Seleção na Mesma Busca (Subfluxo de Mesma Busca de T29)

* **Contexto de Busca:** `search_request_id: 5f95b215-2e79-4bd9-9217-12f38af8f7f7`, `conversation_id: f444c327-fb07-4d7b-a3dd-ef8bda3286a5`.
* **Primeiro Contato (Farol — `d85e04ba-850f-487e-8cbf-f3e8e6703350`, `CC-PT89QEVJ`):**
  * Inbound do profissional: `233fa962-b22c-4eb5-9e78-342607454363` (`unavailability_declared`).
  * Evento de indisponibilidade imutável criado: `db1716e6-2198-4a81-8b4a-5471a8f53c08`.
  * Notificação ao cliente (Evolution ID `3EB0FD05F2E627D1ADF900`) e resposta ao profissional (Evolution ID `3EB06B006337332801CBF1`) observadas com status=sent no transporte e zero holds.
  * Estado intermediário: `search_request.status=matched`, `conversation.status=active`, `conversation.pending_slot=selection`, contato anterior mantido como `shared` e 0 transport holds.
* **Segundo Contato (Julia — `cc13a85c-e79f-469c-8519-c43316bf437c`, `CC-HMRKEW65`):**
  * Inbound de seleção do cliente na mesma busca: `1a4dd56b-ab7a-4b1a-94f2-eb2db1072a31`.
  * Segundo contato estabelecido diretamente como `shared` na mesma busca (`5f95b215-2e79-4bd9-9217-12f38af8f7f7`).
  * Resposta de seleção ao cliente (Evolution ID `3EB0F257061714E96418E6`) e notificação inicial à profissional (Evolution ID `3EB015831CCA09F6E1CF1C`) observadas com status=sent no transporte e zero holds.
  * Estado final: `same_search_request=true`, `different_professionals=true`, `farol_contact_still_shared=true`, `farol_unavailability_preserved=true`, `julia_second_contact_shared=true`, `transport_holds=0`, `search_final_status=selected`, `conversation_final_status=completed`. O ramo de T29 que trata de preservação/retomada com outra busca ativa foi homologado em produção real em 2026-10-09 (ver Edge Flow #3 abaixo e [`docs/launch-readiness/02-t29-real-e2e-closeout.md`](launch-readiness/02-t29-real-e2e-closeout.md)).

### 2. Edge Flow #2: Contestação Bilateral de Conclusão (T34)

* **Contato Alvo:** `cc13a85c-e79f-469c-8519-c43316bf437c` (`CC-HMRKEW65`).
* **Agregado de Conclusão:** `9d24efd9-82bf-4f2e-a67d-e72cf70dc09d`.
* **Declaração pelo Profissional:** Evento `59915c03-b55d-45ff-b6fc-3a482eae1f5c` registrado.
  * Prompt de confirmação ao cliente: Outbound `02a05352-27bb-4fd1-9bf0-b6ffb6b5642f` (Evolution ID `3EB0684D55715F234C2460`, `status=sent`).
  * Resposta de registro ao profissional: Outbound `74f7f047-008d-4342-8a5e-dd30ed240a66` (Evolution ID `3EB04DB9CAE74E1FB85A02`, `status=sent`).
* **Contestação pelo Cliente:** Evento `6a9571b8-816b-4244-af46-1eb51f9cbe7b` registrado.
  * Notificação de contestação ao profissional: Outbound `77188dbf-40de-4ab6-9aa4-660b78f1425d` (Evolution ID `3EB0DB236CAC0299155F86`, `status=sent`).
  * Resposta de contestação ao cliente: Outbound `e71bb54b-aac3-498d-9332-332feb5b1f32` (Evolution ID `3EB0DE3F82BED016915D03`, `status=sent`).
* **Estado Final Comprovado:** `completion.state=contested`, `declared_by=professional`, `confirmed_at=null`, `contested_at` preenchido, `contact.status=shared`, 1 evento de declaração profissional, 1 evento de contestação de cliente, 0 eventos de confirmação, todos os inbounds processados sem erro e 0 transport holds.

### 3. Edge Flow #3: Preservação e Retomada de Busca com Outra Busca Ativa (T29 Completo — 2026-10-09)

* **Contexto de Buscas Concorrentes:** Busca A (`450ba090-ffc0-4e16-903c-e81dae33bbfc`, código `CC-3SXZCVE8`, contato `a6cc997d-89e2-462a-b7de-eec2dfc24e9c` compartilhado com Richard) e Busca B (`2da79047-f0cd-4c5a-b1f6-51b6c392e2bd`, ativa em `pending_slot=location`).
* **Recusa do Profissional (Richard):**
  * Inbound do profissional via botão Quick Reply: `68712ecc-c3c6-481f-9cfa-fc136e209ecd` (`"Não consigo atender"`).
  * Token interativo consumido: `d5bf1e85-8940-415c-8143-5851628c65c1` (`declare_unavailability`).
  * Evento de indisponibilidade imutável criado: `0584c353-94af-4269-a0c8-4463bfb5daa5`.
  * Busca B preservada como ativa (`pending_slot=location`). Busca A suspensa associada ao código `CC-3SXZCVE8`.
  * Notificação ao cliente (Outbound `418678be-0adf-484c-b6a5-70e1c8c654be`, `status=sent`, `wamid.HBgMNTU5OTg0MTE5MDcwFQIAERgSRjM5Rjg4RTQzNEYwNzY5NUE3AA==`), informando continuidade da Busca B e instruindo `"retomar CC-3SXZCVE8"`. Zero transport holds.
* **Retomada e Troca de Contexto pelo Cliente:**
  * Inbound do cliente via WhatsApp: `c3ba57e6-63b8-42a7-ba30-bda98dc757b8` (`"retomar CC-3SXZCVE8"`, `status=processed`, `route=opportunity`, `kind=resumed`).
  * Troca atômica de contexto: Busca B salva/suspensa (`status=completed`, `resume_slot=location`, `resume_code=CC-N6BXRNT8`); Busca A reativada (`status=active`, `pending_slot=selection`).
  * Confirmação ao cliente (Outbound `9c6507a6-dbe1-4894-a02b-689030e92177`, `status=sent`, `wamid.HBgMNTU5OTg0MTE5MDcwFQIAERgSMjNFRDBFMTk0QTcxMjhFMjU1AA==`), entregue com sucesso no WhatsApp.
* **Estado Final:** `ACTIVE_CONVERSATION_COUNT = 1`, zero duplicações, zero holds e `T29_REAL_E2E_RESULT = PASS` (evidências completas em [`docs/launch-readiness/02-t29-real-e2e-closeout.md`](launch-readiness/02-t29-real-e2e-closeout.md)).

### 4. Tabela Consolidada de Transporte dos Edge Flows

| Etapa | Inbound / Gatilho | Outbound ID / Finalidade | Evolution / Meta Provider Msg ID | Status Transporte |
| :--- | :--- | :---: | :---: | :---: |
| **Indisponibilidade (Farol) — Notificação Cliente** | Inbound recusa Farol (`233fa962-b22c-4eb5-9e78-342607454363`) | Outbound (`customer_contact_update`) | `3EB0FD05F2E627D1ADF900` | `sent` |
| **Indisponibilidade (Farol) — Resposta Profissional** | Inbound recusa Farol (`233fa962-b22c-4eb5-9e78-342607454363`) | Outbound (`professional_reply`) | `3EB06B006337332801CBF1` | `sent` |
| **Reescolha (Julia) — Resposta Cliente** | Inbound seleção Julia (`1a4dd56b-ab7a-4b1a-94f2-eb2db1072a31`) | Outbound (`customer_reply`) | `3EB0F257061714E96418E6` | `sent` |
| **Reescolha (Julia) — Notificação Profissional** | Fila Outbox assíncrona gerada pela seleção | Outbound (`professional_contact_notification`) | `3EB015831CCA09F6E1CF1C` | `sent` |
| **Conclusão — Prompt Cliente** | Inbound declaração Julia | `02a05352-27bb-4fd1-9bf0-b6ffb6b5642f` (`customer_contact_update`) | `3EB0684D55715F234C2460` | `sent` |
| **Conclusão — Resposta Profissional** | Inbound declaração Julia | `74f7f047-008d-4342-8a5e-dd30ed240a66` (`professional_reply`) | `3EB04DB9CAE74E1FB85A02` | `sent` |
| **Contestação — Notificação Profissional** | Inbound contestação cliente | `77188dbf-40de-4ab6-9aa4-660b78f1425d` (`professional_contact_notification`) | `3EB0DB236CAC0299155F86` | `sent` |
| **Contestação — Resposta Cliente** | Inbound contestação cliente | `e71bb54b-aac3-498d-9332-332feb5b1f32` (`customer_reply`) | `3EB0DE3F82BED016915D03` | `sent` |
| **T29 Completo — Notificação Recusa Richard** | Inbound recusa Richard botão (`68712ecc-c3c6-481f-9cfa-fc136e209ecd`) | `418678be-0adf-484c-b6a5-70e1c8c654be` (`customer_contact_update`) | `wamid.HBgMNTU5OTg0MTE5MDcwFQIAERgSRjM5Rjg4RTQzNEYwNzY5NUE3AA==` | `sent` |
| **T29 Completo — Confirmação Retomada Cliente** | Inbound retomada cliente (`c3ba57e6-63b8-42a7-ba30-bda98dc757b8`) | `9c6507a6-dbe1-4894-a02b-689030e92177` (`customer_reply`) | `wamid.HBgMNTU5OTg0MTE5MDcwFQIAERgSMjNFRDBFMTk0QTcxMjhFMjU1AA==` | `sent` |

---

## Homologação em Produção — Contexto Obsoleto / Seleção Expirada (T18)

A revalidação em produção real do tratamento determinístico de seleção contra lista expirada (T18) foi executada no runtime `contatocerto-api` @ `69bbf770026e72caacb69bd4b3d7ba5d6bf3f9b0` (busca originada em 2026-10-01 UTC, ensaio executado em 2026-10-02 UTC com inbound às `2026-10-02T02:38:20.742Z` e outbound às `2026-10-02T02:38:21.744Z`):

### 1. Evidências do Ciclo T18 em Produção

| Etapa | Inbound / Gatilho | Outbound ID / Finalidade | Evolution Provider Msg ID | Status Transporte |
| :--- | :--- | :---: | :---: | :---: |
| **Seleção em Lista Expirada ("2")** | Inbound texto "2" (`ca42f314-2ed0-49ca-8960-8c03285bc9c7`, `Contato Certo:3ADBCBBB4F159D366BEB`) | `02979644-88d5-4976-a3e6-509b5807e035` (`customer_reply`) | `3EB0341F401FF10E9E72E8` | `sent` |

### 2. Invariantes Comprovados
* **Garantia de 0 Chamadas a IA / Geocodificador (Testes Automatizados):** A suíte de testes de integração comprova execução via fast-path determinístico (`CONTEXTUAL_EXPIRED_SELECTION`) com 0 chamadas de interpretação, 0 chamadas de composição e 0 geocodificações.
* **Zero Mutações de Negócio em Produção:** 0 contatos criados, 0 novas buscas, 0 matches selecionados, 0 notificações a profissionais.
* **Transporte Concluído em Produção:** Mensagem com `status=sent`, `provider_message_id` persistido, `delivery_hold_reason=null` e mensagem recebida pelo cliente.
* **Resultado:** `T18_REAL_PRODUCTION_FINAL=PASS`.


