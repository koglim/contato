# Transporte — quatro exports inativos

Alvo informado: **n8n 1.123.21 / Evolution 2.3.7**. Código das versões conferido;
homologação no motor/WhatsApp real ainda não executada. O community node 1.0.4
permanece instalado no ambiente, mas os novos exports não dependem dele.

| Export | Responsabilidade |
| --- | --- |
| gateway.json | Webhook JWT, texto/áudio, Inbox, claim por ID e chamada do shared |
| shared-delivery.json | Entrega de negócio: gate, Evolution HTTP, sent/failed/hold |
| outbox-dispatcher.json | Claim da fila, orçamento e chamada do mesmo shared |
| inbox-recovery.json | Recuperação de entradas persistidas; não envia WhatsApp |

O gateway mantém `instance:key.id` como identidade histórica. Nunca enviar
reply_text diretamente nem usar telefone do webhook para uma Outbox independente.
Shared recebe envelope HTTP completo, corpo texto ou JSON; 204, sent e 409
não autorizam envio. Corpo inválido não passa no gate.

**Importação/configuração:** seguir
[TRANSPORT_HOMOLOGATION.md](../../docs/TRANSPORT_HOMOLOGATION.md), com SHAs das
versões, credentials, Variables, matriz, limites, runbook e rollback.
Não importar/ativar automaticamente. O export original tinha chaves explícitas:
**exige rotação pelo operador**; não copiá-lo para Git ou chamados.

Variables: CONTATOCERTO_API_BASE_URL, EVOLUTION_API_BASE_URL, EVOLUTION_INSTANCE,
EVOLUTION_PROVIDER, CONTATOCERTO_DELIVERY_WORKFLOW_ID e a nova
**EVOLUTION_WEBHOOK_ORIGIN**. Credentials: Internal API, Evolution,
Evolution Webhook JWT, Groq Transcription e OpenAI Transcription (nomes completos
e tipos no runbook). Segredos só no cofre, nunca em Variables.

JWT HS256 autentica origem, não assina conteúdo. Conferir TLS, URL interna,
body/taxa na borda, expiração e persistência do segredo após reinício.
Não reutilizar INTERNAL_API_KEY. Nenhuma variável API/web ou migration nova:
aplicar todas as pendentes, inclusive 017/018/019, antes da API; B2 desligada.

HTTP Request usa fullResponse, **text/body**, parse controlado e redirects
desligados. Trata 204 sem erro no parser JSON. Transporte nunca usa retryOnFail;
somente confirmação API tem três tentativas. 400/401/403/404/422/429 genéricos
não provam rejeição. Envelope exato 401 do authGuard → failed/backoff;
outros resultados incertos → hold. ID aceito é conservado para confirmação.

Áudio até120s, limitado, Groq primário/OpenAI fallback e uma saída para Inbox.
**Exceção:** aviso de áudio inválido/falha total é one-shot direto, sem retry ou
entrada fictícia. Não tem deduplicação durável entre webhooks; reentrega,
transcrição variável e queda antes da Inbox são pendências explícitas.
O runbook exige decisão antes do público, não promete exactly-once.
Não salvar dados de execução success/error/manual/progress.

Lease Outbox >=60s; envio15s, confirmação5s×3, shared55s. Dispatcher10 itens/45s
por ciclo, timeout105s; recovery HTTP70s/execução120s; gateway165s.
Conferir timeout da origem/proxy para ACK depois da Inbox e antes do envio.
API indisponível após envio exige pausa/reconciliação, não liberação automática.

Desenvolvimento: alterar delivery-contract.mjs, gateway-contract.mjs e
build-workflows.mjs; executar `pnpm build:workflows`, `pnpm test:workflows`
e versionar quatro JSONs. CI verifica exports determinísticos e PostgreSQL;
HTTP, transcrição e grafo n8n simulados não substituem homologação.
