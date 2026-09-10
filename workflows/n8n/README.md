# Consumidores Inbox/Outbox — exports para homologação

Os três JSONs são importáveis e **inativos**. Foram gerados com nodes nativos
HTTP Request 4.2, Code 2, Execute Workflow 1.2 e Schedule Trigger 1.2. A versão
instalada do n8n e o export atual do gateway ainda precisam ser confirmados.
Testes de contrato e PostgreSQL com provider simulado não equivalem à execução
do motor n8n nem ao envio WhatsApp real.

## Importação manual

1. Conferir/aplicar todas as migrations pendentes, inclusive 017, 018 e 019,
   e a versão correspondente da API em homologação, mantendo B2 desligada.
2. Importar `shared-delivery.json`. Vincular credenciais Header Auth:
   `ContatoCerto Internal API` (header `X-Internal-Key`) e
   `ContatoCerto Evolution` (header `apikey`). Valores somente no cofre do n8n.
3. Configurar os parâmetros abaixo. Conferir que a instância pertence ao ambiente
   de homologação e que a lease da API é de pelo menos 60 segundos.
4. Testar manualmente o subworkflow com resultado de claim real. Entrada é o
   envelope HTTP `{ statusCode, body }`, sem headers ou chave dentro do JSON.
5. Importar `outbox-dispatcher.json`; configurar o ID do subworkflow. Manter todos
   inativos até aprovar os cenários abaixo com números de teste autorizados.
6. No gateway existente, preservar a Inbox e o claim por ID. Após claim, chamar
   **o mesmo subworkflow** passando o envelope HTTP, com execução por item e
   espera pela conclusão. Remover o envio direto desse ramo somente durante a
   homologação manual, depois de conferir o export atual. Não duplicar transporte.
7. Importar `inbox-recovery.json` inativo, vincular somente `ContatoCerto Internal API`.
   Não possui node de Evolution/envio. Homologar fila vazia, dois consumidores,
   reinício/lease, FIFO e quarentena antes de autorizar o agendamento.

Não há URL, ID de instância real ou secret incluído nos exports. URLs/IDs são
parâmetros `$vars`; se a edição/versão do n8n não oferecer Variables, configurar
esses valores não secretos nos nodes equivalentes e revalidar o export local.

| Parâmetro no n8n | Finalidade | Obrigatório/default | Secreto |
| --- | --- | --- | --- |
| `CONTATOCERTO_API_BASE_URL` | Origem da API, sem barra final | Sim / nenhum | Não |
| `EVOLUTION_API_BASE_URL` | Origem da Evolution, sem barra final | Sim / nenhum | Não |
| `EVOLUTION_INSTANCE` | Instância homologada | Sim / nenhum | Não |
| `EVOLUTION_PROVIDER` | Provider persistido na Inbox/Outbox | Sim / nenhum | Não |
| `CONTATOCERTO_DELIVERY_WORKFLOW_ID` | Subworkflow importado | Dispatcher / nenhum | Não |
| Header Auth `X-Internal-Key` | Autenticar consumidor na API | Sim / nenhum | Sim |
| Header Auth `apikey` | Autenticar na Evolution | Sim / nenhum | Sim |

Não há nova variável de ambiente na API/web. A configuração existente
`CHANNEL_OUTBOUND_PROCESSING_LEASE_SECONDS` deve ser >=60 para estes timeouts.
Transportes usam 15s, confirmações 5s por chamada com três tentativas. O transporte
**não** tem retry automático; apenas a API agenda nova tentativa após rejeição
comprovada. O dispatcher consulta a cada 10s, com teto de 10 itens/45s por ciclo.
Uma execução iniciada antes desse teto pode concluir depois; timeout externo 105s.

## Recuperação de entradas

`inbox-recovery.json` usa o mesmo `CONTATOCERTO_API_BASE_URL` e Header Auth,
sem parâmetro novo. Agenda a cada 10s, máximo dez entradas ou 45s para iniciar
chamadas. `POST /internal/channel/inbound/next/process`: 204 encerra normalmente;
200 informa ID/status, sem texto/telefone/token; resposta inesperada interrompe
com código estável. Timeout HTTP 70s; workflow 120s. Sem retry HTTP cego.

A API faz claim/efeitos/conclusão; o workflow não muda SQL/leases. Saída persistida
é entregue pelo dispatcher compartilhado, nunca diretamente pelo recovery.
Confirmação HTTP perdida após commit não exige nova geração: a Outbox já existe.
FIFO e quarentena podem deixar entradas bloqueadas com 204: consultar o diagnóstico
e alertar operador, sem liberar continuidade automaticamente. Contratos/admin em
[INBOX_RECOVERY.md](../../docs/INBOX_RECOVERY.md). Não confundir fim do código com
ativação em produção; nenhuma alteração foi feita no n8n instalado.

## Proteções

- Somente claim `processing` válido autoriza enviar. `sent`, 204 e 409 encerram.
- Destinatário/texto/provider/token vêm do próprio claim. Cada item conserva sua
  associação; o subworkflow executa uma vez por item.
- Sucesso exige ID, `fromMe=true` e `remoteJid` correspondente. Homologar o formato
  real da resposta de `POST /message/sendText/:instance` da Evolution instalada.
- 400/401/403/404/422/429 são rejeições explícitas. Timeout, 5xx, resposta ambígua
  ou sucesso sem evidência entram em `/hold`, não em retry cego.
- Falha de `/sent` tenta confirmar novamente e depois reter como
  `confirmation_pending`. Nunca volta ao node de envio.
- Erro de confirmação/hold interrompe a execução. Configurar alerta operacional
  com apenas ID/código; não encaminhar telefone, texto, token ou credenciais.
- Execuções de sucesso não são gravadas; execuções com erro podem conter dados
  pessoais e token operacional. Restringir acesso e retenção no n8n antes de
  ativar; política de expurgo exige decisão do operador. OTP não é suportado por
  estes exports e não deve ser incluído sem proteção própria.

## Homologação obrigatória

Fila vazia; claim sent; disputa gateway/dispatcher; duas notificações distintas;
cliente e profissional diferentes; profissional aceita/recusa e cliente recebe
atualização sem novo webhook; rejeição 429; timeout incerto; `/sent` repetido;
falha de confirmação; reinício do consumidor; loop com IDs/tokens distintos.
Verificar que não existe envio adicional ao repetir inbound ou confirmação.

## Gateway e áudio pendentes

`normalizeEvolutionText` é um contrato puro testado para texto, resposta citada,
aspas, multiline, emoji, eventos próprios/grupos e instância. Não autentica por
si só: o webhook/proxy deve verificar segredo/assinatura **antes** de chamar essa
função. Não derivar identidade de corpo recebido sem autenticidade comprovada.
JIDs `@lid` são ignorados até existir resolução confiável; nunca inventar telefone.

O export do gateway atual não foi fornecido nesta execução. Não foi substituído
nem alegada compatibilidade com seus nodes de áudio. Áudio, autenticação da
origem e aceitação durável ainda precisam da integração com esse export e da
versão instalada. Recovery só recupera o que **já foi persistido na Inbox**;
eventos perdidos antes dela continuam responsabilidade do gateway/transporte.

## Desenvolvimento

Alterar `delivery-contract.mjs` e `build-workflows.mjs`, executar
`pnpm build:workflows`, `pnpm test:workflows` e publicar os JSONs gerados juntos.
O CI verifica que os exports correspondem ao código-fonte testado. Os testes
PostgreSQL usam os contratos reais com transporte simulado, sem mensagem externa.

Referências primárias:
[HTTP Request](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest/)
e [Execute Sub-workflow](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.executeworkflow/).
