# Transporte durável — checkpoint 020

Base: `9b4646e78d05d5724ca4b12eb03a0735792868c1`, branch
`codex/marketplace-v1-completion`. Implementação para homologação, **não ativada**.
Não houve WhatsApp, transcrição, geocoding ou avaliação B2 paga nesta etapa.
B2 continua desligada. Nenhuma conclusão sobre naturalidade/qualidade de áudio
real pode ser obtida dos mocks.

## Fluxo e identidade

Webhook autenticado → `POST /internal/channel/media/events` → commit PostgreSQL
→ ACK. O mesmo namespace `provider + instance:key.id` identifica a entrada.
A API reserva uma Inbox `media_pending=true` antes de responder. Ela não pode ser
processada e bloqueia entradas posteriores do mesmo telefone pela ordenação
existente `(created_at,id)`. Texto normal mantém seu contrato anterior.

O evento guarda hash SHA-256 dos bytes (ou da representação inválida), fingerprint
dos metadados, MIME, duração declarada, tentativas, lease e resultado. Admissões
concorrentes usam a unicidade existente da Inbox e o vínculo UNIQUE da mídia.
Evento repetido devolve o mesmo ID/status e `duplicate=true`; conteúdo ou
destinatário divergente gera 409 e quarentena sem reescrever o original.
Uma mídia histórica anterior à 020, sem fingerprint persistido, não é adotada
automaticamente: conflito exige análise, não uma segunda transcrição/entrada.

O consumidor de áudio separado reivindica uma mídia por execução com
`FOR UPDATE SKIP LOCKED`. A transcrição externa ocorre **fora da transação**.
Lease de 60s; no máximo três claims, sem nova variável de configuração.
Groq primário; OpenAI fallback somente se necessário. Cada chamada tem 10s,
sem retry de HTTP automático. A repetição de POST do resultado usa o mesmo corpo.
Reentrega do webhook não chama nenhum transcritor. Queda antes do resultado pode
repetir trabalho externo depois da lease: no máximo seis chamadas de transcrição
por evento; isso não garante cobrança externa exactly-once.

O resultado validado de 1–500 caracteres é persistido na mesma transação que
libera a Inbox original para o recovery. Nenhum workflow inventa raw_text de
erro. Crash antes do commit não deixa resultado parcial; depois do commit o
recovery continua sem retranscrever. Replay de resultado idêntico é idempotente.
Outro texto/provider para evento/hash com token anteriormente emitido coloca
mídia e Inbox em quarentena; o texto original e as evidências ficam preservados.
Token desconhecido, hash divergente e callback expirado sem resultado aceito
retornam 409. Se efeitos já foram concluídos antes de uma divergência tardia,
eles não são revertidos nem executados novamente: análise humana é necessária.

## Avisos, Outbox e FIFO

Longo, formato não suportado, conteúdo inválido, falha dos dois transcritores ou
expiração geram **um** `channel_notice`, com business key por evento. Texto fixo
pertence a `channel-media.policy.ts`; o contrato de admissão não aceita reply_text.
Criação do aviso e fechamento controlado da Inbox-placeholder são atômicos.
O notice não passa pelo Router, Matching, seleção ou consentimento.

Dispatcher → Shared Outbox Delivery é o único caminho de envio dos avisos.
Timeout/5xx/aceitação inconclusiva usam hold; não há envio one-shot no gateway.
Uma resposta posterior não ultrapassa aviso pendente/retido; um aviso não
ultrapassa Outbox anterior não terminal do destinatário. A exceção histórica
entre respostas inline continua existindo para renovar prompts de consentimento.
Fechamento administrativo libera a fila, mas **não** marca matches como enviados.

## Retenção e segurança da mídia

- Máximo 3 MiB binário; JSON de admissão até 5 MiB. MIME permitido: OGG, MPEG,
  MP4/M4A, WAV, WebM; base64 canônico e assinatura mínima do contêiner conferidos.
- Até 120s pela duração declarada na origem autenticada. Isso **não** é decodificação
  completa nem verificação independente da duração; ensaio real segue obrigatório.
- BYTEA temporário no PostgreSQL evita novo serviço externo. Pior caso de bytes
  ativos: 3 MiB × fila admitida, além de TOAST/WAL/backups. Não foi feito benchmark
  de carga; limitar tráfego no proxy e observar idade/tamanho antes do público.
- TTL de uma hora. Cada claim varre até 100 expirados/leases esgotadas; `/media/purge`
  permite drenagem adicional. Nenhum expirado é entregue ao transcritor. Após
  conclusão/falha/quarentena, bytes são removidos na própria transação.
- Com todos os consumidores desligados, expiração lógica não executa remoção
  física sozinha. Manter o consumer/purge agendado após homologação e alertar se
  a idade exceder uma hora. Não há timer no startup da API nem cron externo criado.
- Transcrição, telefone e metadados são PII e seguem a retenção de Inbox/auditoria,
  que ainda requer política comercial/jurídica. Remoção de BYTEA não apaga WAL ou
  backups: retenção, criptografia em repouso, acesso restrito e descarte desses
  artefatos são responsabilidade operacional, não garantia desta migration.
- Base64 nunca aparece em diagnóstico/logs. Resposta do claim contém apenas
  mídia/MIME/hash/id/token necessários, sem telefone. Endpoints internos exigem
  X-Internal-Key, TLS/rede restrita; respostas `Cache-Control: no-store`.
- Exports desabilitam persistência de execuções inclusive erros/manuais. Conferir
  políticas de task runners/binary manager do n8n na homologação; não pressupor
  que remover bytes da API apaga cópias em outro sistema.

## Contratos internos adicionais

Todos sob `/internal/channel`, autenticados. Sem rota duplicada de claim Outbox.

| Método / caminho | Retorno / finalidade |
| --- | --- |
| POST `/media/events` | 200 `{id,status,duplicate}` só depois de persistir; 409 conflito |
| POST `/media/next/claim` | 204 vazio; 200 `{id,processing_token,media_hash,mime_type,audio_base64}` |
| POST `/media/:id/result` | token/hash + `result:{status:'transcribed',provider:'groq'|'openai',text}` ou `{status:'failed',error_code:'transcription_unavailable'}`; 200 resumo; 409 fencing/conflito |
| POST `/media/purge` | `{purged}`; lote até100, sem binário na resposta |
| POST `/outbound/:id/disposition` | ação administrativa abaixo; 200 resultado persistido; 400 evidência inválida; 409 conflito/estado inseguro |
| GET `/transport/diagnostics` | contagens/idades agregadas; nenhum dado pessoal |

Os status de mídia são `pending`, `processing`, `completed`, `failed`, `quarantined`.
`completed` significa **transcrição persistida**, não busca/contato/envio concluído.
Corpo inválido ou API indisponível jamais recebe ACK de sucesso. Um 200 com
`quarantined` significa evento durável em intervenção, não processamento aprovado.

### Disposição administrativa

Corpo estrito: `request_id` e `operator_id` UUID; `action`, `reason`,
`evidence_hash` SHA-256 de evidência mantida em local restrito e, para confirmação,
`provider_message_id`. O hash não prova por si só que o envio ocorreu: operador
deve consultar o provider e verificar o evento/destinatário antes da ação.
Esta API usa a mesma chave interna administrativa existente; operator_id é
declarado pelo operador, **não login individual nem assinatura de identidade**.
Não compartilhar esse endpoint com clientes; RBAC individual continua pendente.

| action | reason obrigatório | Condições |
| --- | --- | --- |
| confirm | delivery_proven | evidência + provider_message_id; não contradiz recibo já registrado; marca sent e shown_at via mesma transação |
| retry | non_delivery_proven | evidência, sem recibo registrado, menos de cinco tentativas; pending com backoff, sem zerar contagem |
| close | delivery_impossible | evidência; failed com fechamento administrativo, sem claim futuro |
| retain | evidence_insufficient | conserva hold; nenhuma tentativa de envio |

Cada disposição exige hold atual. Request ID repetido com corpo idêntico retorna
a resposta salva (`duplicate=true`), não reexecuta a ação. Corpo diferente retorna
409 e registra conflito. Row lock serializa operadores/worker; token antigo é
revogado inclusive em retain. Histórico `channel_transport_events` é append-only:
UPDATE/DELETE são proibidos. Nenhuma ação troca texto/telefone, apaga recibos,
reseta tentativas, concede consentimento ou escolhe outro profissional.

`/hold` aceita opcionalmente provider_message_id para conservar o recibo quando
`/sent` não foi confirmado. Shared Delivery envia esse ID em confirmation_pending.
Callback `/sent` não pode substituir um recibo por outro. Se a API inteira cair
depois de um envio, não é possível garantir persistência do recibo/hold: pausar
consumidores e reconciliar na origem antes de nova lease. O provider ainda não
oferece exactly-once comprovado por estes testes.

### Diagnóstico e intervenção

`holds`: quantidade por motivo, oldest_seconds e awaiting_reconciliation.
`dispositions`: confirm/retry/close/conflict. `audio`: notices_pending,
pending (inclui processing), failed, quarantined, oldest_media_seconds e
purged_by_retention. Idades são null quando a população é vazia.
Não contém telefone, texto, áudio, token, prompt, IDs de profissionais ou secrets.
Alertas automáticos/dashboard não estão instalados. Hold/quarentena exigem
análise; nunca usar ausência de recibo como prova de não envio.

## Migration e publicação futura

020 adiciona mídia, media_pending, trilha de transporte, finalidade channel_notice,
data de hold/fechamento e índices. **001–019 intactas**. Nenhuma credencial ou
configuração real foi modificada. Down protegido P0020 bloqueia dados de mídia,
auditoria, placeholders e avisos/fechamentos administrativos. Não apagar dados
de produção para fazer rollback: preferir roll-forward/restauração validada.
TRUNCATE encontrado em testes é exclusivamente teardown de PostgreSQL descartável.

Ordem, somente após autorização de publicação:

1. Backup e ensaio de restauração; pausar consumidores/gateway antigo na troca,
   drenar execuções e remover o ramo antigo de áudio direto (sem caminhos paralelos).
2. Aplicar **todas** as migrations pendentes até020, incluindo017/018/019, antes da API.
3. Publicar API compatível, B2 desligada; conferir health e contratos com fixtures.
4. Importar ainda inativos Shared Delivery, dispatcher, Inbox Recovery, gateway e
   novo `media-consumer.json`; vincular credentials e IDs.
5. Homologar PostgreSQL/mídia/n8n/Evolution reais com números restritos e autorização
   específica. Só então ativar consumer de áudio, recovery/dispatcher e gateway.

API/EasyPanel: **nenhuma variável nova/alterada**. Política de mídia em código.
n8n Variables: **nenhuma nova**; continuam CONTATOCERTO_API_BASE_URL,
CONTATOCERTO_DELIVERY_WORKFLOW_ID, EVOLUTION_API_BASE_URL, EVOLUTION_INSTANCE,
EVOLUTION_PROVIDER e EVOLUTION_WEBHOOK_ORIGIN.
Credentials: **nenhuma nova**. Reutilizar Internal API, Evolution, Webhook JWT,
Groq Transcription e OpenAI Transcription; as duas últimas agora no consumer.
Não reenviar credenciais expostas no export original; rotacioná-las manualmente.

## Evidências e próximos passos

Testes unitários: limites, assinatura, schema, evidência e autenticação.
Grafo gerado (HTTP/n8n simulados): ACK durável, primário/fallback/erro, reuso de
binário, claim204, finalidade no Shared Delivery e ausência de envio direto.
Integração PostgreSQL: transações reais, ACK/replay, crash antes/depois do commit,
consumidores/lease, divergência/quarentena, retenção, FIFO, retry/admin/auditoria,
contratos sem PII e down protegido. CI também faz down compatível020→008,
reaplicação008→020 e repete integrações. Referência final por SHA no relatório.

Cobertura do pedido: 1–7 política e primário/fallback; 8–12 identidade/crash/lease;
13 retenção; 14–17 notice/Shared/hold; 18–24 administração/fencing/request ID;
25 FIFO; 26 diagnóstico; 27–28 down protegido/compatível/reaplicação.

Próximo checkpoint é homologação manual, não V1 concluída. Permanecem pendentes:
motor n8n e mídia reais, fonte/duração real, carga/armazenamento/backups, alertas,
reconciliação humana de transcrição divergente e eventual garantia de transporte
do provider. B2 real somente mediante autorização, seguida de revisão humana.
