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

### Áudio e exceção explícita

120 segundos no máximo, duração numérica positiva obrigatória, MIME permitido,
base64 válido até 4 MiB (~3 MiB binário), envelope até 5 MiB. Duração declarada
pela origem não substitui inspeção real de mídia; validar no ensaio controlado.
Groq `whisper-large-v3-turbo` primário; falha/timeout/texto vazio ou >500 caracteres
usa OpenAI `gpt-4o-mini-transcribe`. Multipart file + model + language=pt +
response_format=json, timeout 10s por tentativa, sem retry automático.
Contrato do fallback conferido no [guia oficial OpenAI](https://developers.openai.com/api/docs/guides/speech-to-text);
nenhuma transcrição externa foi executada. Binário original é religado por item,
sem fanout/Merge que possa emitir duas transcrições para a Inbox.

Transcrição válida entra na mesma Inbox com o ID original. Áudio longo/inválido
ou falha total gera aviso fixo, **não uma mensagem fictícia para o domínio**.
A API não possui enqueue de aviso de transporte. Para não criar finalidade/schema
ou alterar contratos de negócio aqui, o aviso é a única exceção direta:
ACK antes de uma tentativa, sem retry, mesma classificação conservadora do
transporte; resultado incerto interrompe para reconciliação. Não cria contato,
busca nem Outbox. Nenhum dos ramos de falha dispara dois avisos na mesma execução.

**Limitação importante:** esse aviso não tem recibo/deduplicação durável. Outra
entrega do mesmo webhook pode repetir o aviso; queda após ACK pode perdê-lo.
Reentrega de áudio válido também pode transcrever novamente e produzir texto
diferente, que a Inbox rejeita como conflito (não duplica efeitos, mas exige
reconciliação). Não usar staticData do n8n como lock distribuído nem prometer
exactly-once. Antes de operação pública: aceitar formalmente a exceção ou criar
admissão durável de mídia/transcrição/avisos em etapa específica. O runbook de
homologação deve coletar esses casos; este checkpoint não remove esse risco.

## Configuração futura (nenhuma aplicada)

**API/EasyPanel:** nenhuma variável ou migration nova. Aplicar todas as pendentes,
inclusive **017, 018, 019**, antes da API compatível. Manter B2=false. Lease existente
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
gateway transcrição até20s + Inbox70s + claim15s + shared55s, execução165s.
O timeout do webhook na origem/proxy deve comportar o ACK (antes do envio, até
~90s com áudio); a Evolution padrão pode repetir em 30s. Homologar configuração
de timeout/retries sem assumir que o ambiente já a alterou. Não desativar
idempotência para contornar reentregas.

## Runbook manual — NÃO executado

1. Confirmar ambiente controlado, versões, SHA/CI, backup criptografado dos
   workflows/credentials/config e banco restaurável; bloquear números não autorizados.
2. Rotacionar as chaves do export compartilhado. Pausar gateway/consumidores antigos
   no ambiente do ensaio. Conferir migrations 001–019 e API/B2 desligada.
3. Importar **inativos** shared-delivery, outbox-dispatcher, inbox-recovery e gateway.
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
9. Reconciliar hold: somente se houver evidência da Evolution, repetir sent com
   token original e provider_message_id; resultado incerto permanece retido.
   Não limpar evidências/leases. Administração de nova tentativa ainda pendente.
10. Coletar SHA, versões, caso, horários, status, IDs opacos e contagens; guardar
    evidências sensíveis separadamente. Revisão humana do áudio/WhatsApp é obrigatória.
11. Rollback de workflow: pausar ingresso/consumidores, reconciliar trabalho em voo,
    restaurar backup **inativo**, revisar antes de ligar. Não restaurar a política
    antiga de retry de qualquer erro nem fazer downgrade do banco para perder holds.
12. Só autorizar ativação após matriz crítica aprovada, segredos rotacionados,
    alertas/timeout/rede validados e decisão explícita sobre durabilidade do áudio.
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
| Áudio longo/falha total | >120s ou dois transcritores falham | Um aviso one-shot | Nenhuma entrada fictícia | Nenhuma (exceção) | Sem dois avisos no mesmo fluxo; sem retry |
| Reentrega de áudio | Repetir evento/derrubar antes do ACK | Medir risco de repetição/aviso | Mesmo ID ou conflito se nova transcrição divergir | Sem novo efeito de negócio | Registrar limitação; decisão sobre fila de mídia antes do público |
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

Próximo checkpoint: homologação controlada e alertas/recibos operacionais, decisão
de durabilidade da mídia/avisos, reconciliação administrativa Outbox, depois
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
