# Recuperação da Inbox — checkpoint 019

Base: `916dbf6d004ab85e816be554cec0095457da0e9a`, branch
`codex/marketplace-v1-completion`. Implementação independente de n8n instalado,
B2 desligada por padrão. Não significa homologação do transporte nem V1 pronta.

Atualização de transporte: gateway JWT inativo foi preparado para n8n 1.123.21 /
Evolution 2.3.7. O consumidor recovery conserva endpoints/budget e não envia
mensagens; HTTP completo usa text/body para aceitar 204 vazio. O dispatcher
compartilhado entrega saídas recuperadas. Ver [TRANSPORT_HOMOLOGATION.md](TRANSPORT_HOMOLOGATION.md).
Nenhuma alteração na API de recuperação ou migration 019 neste checkpoint.

## Evidência do checkpoint

Código validado: `103a7cb76bdef3d16a6e752bb170e7196d9eed4b`,
[Actions 34484998845](https://github.com/koglim/contato/actions/runs/34484998845).
Esse SHA passou por instalação congelada, lint, typecheck, build shared/API/Next,
testes e ciclo completo de migrations. A consolidação posterior alinha o índice
parcial à condição FIFO (inclui resultado processado em quarentena) e documenta
o checkpoint; o **CI do HEAD final** deve ser conferido separadamente pelo SHA,
nunca inferido desta execução de código. O relatório de entrega informa seu link.

| Validação | Evidência executada |
| --- | --- |
| `pnpm install --frozen-lockfile` | Local e CI, sem dependência nova |
| Lint / typecheck / build | Local e CI aprovados; shared, API e web |
| API unitária | 303/303 |
| Web | 12/12, sem alteração do frontend |
| Workflows | 8/8; geração dos três JSONs idêntica à fonte |
| B2 congelada | 300/300 simulados, zero chamadas de modelo |
| Readiness B2 | 18/18 simulados, zero chamadas de modelo |
| PostgreSQL/PostGIS | 123/123 antes e 123/123 depois da reaplicação no CI |
| Migration 019 / down protegido | Aplicada, índice/constraints verificados, P0019 e dados preservados |
| Rollback/reaplicação | 019–008 compatível e 008–019 reaplicada; proteções anteriores preservadas |
| `git diff --check` | Sem erro |

Total das suítes API/web/workflows: **323**. Integrações: **123 cenários**, executados
duas vezes (246 execuções), separados dos 318 casos simulados de avaliação.
Não somar essas categorias como se fossem conversas humanas homologadas.
PostgreSQL foi executado apenas no CI descartável: Docker/psql indisponíveis
neste computador; nenhuma conexão com banco de produção foi usada.

Commits de implementação: `1665234` (fila/fencing/quarentena), `d79e2a5` (integrações
e consumidor inativo), `1749a87` (tipagem SQL/FIFO), `103a7cb` (memória e fallback).
O índice e os documentos são consolidação posterior na mesma branch, sem merge.

## Contrato e acionamento

Todas as operações abaixo exigem `X-Internal-Key`.

| Operação | Resultado |
| --- | --- |
| `POST /internal/channel/inbound/next/process` | 204 sem mensagem elegível; 200 `{ id, status }` |
| `GET /internal/channel/inbound/queue-status` | Contagens/idades agregadas, sem payload/telefone/token |
| `POST /internal/channel/inbound/:id/disposition` | Disposição explícita e idempotente de quarentena |

Status do processador: `processed`, `retry_scheduled`, `quarantined`, `processing`.
A resposta **não** contém telefone, texto, prompt ou token. Cada chamada processa
no máximo uma entrada. Falhas de infraestrutura antes do claim podem retornar
5xx; não são uma fila vazia. Um 204 pode significar também que há entradas
bloqueadas, em backoff, em lease ou aguardando B2; consultar o diagnóstico.

O export `workflows/n8n/inbox-recovery.json` é gerado, inativo, usa a credencial
interna existente e consulta a API a cada 10 segundos. Teto: dez entradas ou
45 segundos para iniciar novas chamadas; uma chamada em andamento pode concluir
depois (timeout HTTP 70 s, execução 120 s). Não envia WhatsApp. O dispatcher
Outbox existente entrega o resultado persistido usando o mesmo claim/recibo
do gateway; um gateway não deve enviar diretamente um `reply_text` de recovery.
Se o HTTP de conclusão se perder, a entrada já processada não é revendicada e
sua Outbox continua disponível no dispatcher compartilhado.

O acionamento agendado **não está instalado nem ativado**. A capacidade automática
foi implementada no repositório; avanço contínuo em produção depende de importar,
homologar e ativar esse consumidor mediante autorização. A API não inicia timer
oculto nem executa migrations no startup.

## Ordem, leases e tentativas

- Ordem total `(created_at,id)`, FIFO por `phone_e164` (inclusive entre providers).
  ID é somente desempate, nunca substitui a data. Uma entrada anterior não
  concluída impede as posteriores, inclusive em quarentena. `closed` libera
  continuidade explicitamente. Outros telefones progridem independentemente.
- A seleção/alteração da lease é um único `WITH candidate ... FOR UPDATE SKIP
  LOCKED ... UPDATE RETURNING`. Não ter item ou perder o lock não consome tentativa.
- `CHANNEL_INBOUND_PROCESSING_LEASE_SECONDS` continua existente, default 60 s.
  A expiração é persistida no claim. Tokens antigos/vencidos são rejeitados no
  banco, inclusive antes de outro claim. O relógio da barreira é `clock_timestamp()`.
- Cinco tentativas efetivas por ciclo administrativo. `attempt_count` aumenta
  no claim; `total_attempts` conserva tentativas através de retries administrativos.
  Um abandono já consumiu sua tentativa: o sweep não conta duas vezes.
- Falha transitória/abandono: `failed` recuperável, `next_attempt_at` em
  30/60/120/240 segundos. Quinta falha/abandono: quarentena, sem sexta execução.
  Replay com token anterior não aumenta contagem nem agenda novamente.
- Contenção de conversa/página/contexto adia cinco segundos e devolve a tentativa,
  sem apagar checkpoints. Não esgotar cinco tentativas esperando envio de página.
- Sweep de até 100 leases expiradas por chamada, também com `SKIP LOCKED`.
  Não há promessa de latência de recuperação independente de tamanho de fila;
  monitorar idade e capacidade. Meta inicial: iniciar após elegibilidade em ≤60 s.

## Efeitos e contexto

B2 mantém modelo/geocoder fora da transação final. Proposta/rascunho estão ligados
à revisão e fingerprint; a aquisição, gravação e conclusão verificam também a
lease da Inbox. Corrupção persistida não vira fallback silencioso. Resultado
válido já concluído é reproduzido sem nova IA; erro externo sem proposta salva
pode precisar de nova tentativa. Composição/fallback já salvo é reutilizado.

O fluxo determinístico legado passa a executar seus repositórios em uma unidade
transacional da Inbox, propagada por `AsyncLocalStorage` **somente nesse caminho**.
Busca/conversa/seleção/consentimento/reserva/Outbox e conclusão ficam no mesmo
commit. Nenhum efeito fica visível se a escrita final falhar. Consultas HTTP do
legado ainda podem ocorrer nessa transação: limites locais de statement e idle
são 20 s e a conclusão exige lease válida. É uma escolha de compatibilidade;
separar uma proposta legada durável é evolução futura para reduzir duração de
locks, não uma alegação de que não existe transação durante geocoding legado.
No caminho B2, chamadas externas continuam fora da transação, como antes.
Fallbacks de IA/geocoder já convertidos em uma resposta útil são conclusão lógica,
não erro a ser repetido automaticamente: persistir e entregar essa resposta.
Backoff é para processamento que não conseguiu concluir. Assim uma indisponibilidade
do modelo não gera um loop de novas chamadas quando já há fallback concluído.

O fingerprint da busca ativa é capturado no primeiro claim. Se ela mudar/expirar
entre tentativas (inclusive revisão da memória sem alteração da conversa), a
mensagem antiga não escolhe alguém na busca nova: persiste
uma orientação de esclarecimento, preservando estado e dados confirmados. B2
revalida também memória, TTL e elegibilidade; não reutiliza hipótese incompatível,
match não apresentado ou consentimento ausente. Regras do domínio permanecem
autoritativas. `shown_at` continua dependente de `/sent`.

B2 desligada: novas entradas seguem o fluxo atual. Entradas contextuais ainda
não concluídas aguardam a B2; não são reinterpretadas silenciosamente pelo fluxo
legado nem consomem tentativas enquanto aguardam. Replays já concluídos funcionam
mesmo com a flag desligada. Modelo real/revisão humana continuam pendentes.

## Quarentena e disposição

`recovery_state` é separado do status histórico da Inbox. Quarentena registra
razão/data e evento imutável; não simula `processed`, não apaga payload, resultado,
proposta, resposta, contato nem Outbox. Conflito de payload preserva o original
e acrescenta fingerprint SHA-256 do conflitante, sem duplicar PII no evento.
O conteúdo conflitante não é armazenado; diagnóstico completo do envelope
rejeitado depende da trilha de transporte com acesso/retensão aprovados.

Razões permanentes incluem proposta/rascunho/resultado inválido, estado impossível,
dependência classificada permanente e tentativas esgotadas. Dados processados
corrompidos também bloqueiam a fila; não regenerar uma resposta para ocultar isso.

Exemplo de corpo administrativo (UUIDs gerados pelo operador, sem secrets):

```json
{
  "request_id": "11111111-1111-4111-8111-111111111111",
  "operator_id": "22222222-2222-4222-8222-222222222222",
  "action": "retry",
  "reason": "dependency_restored"
}
```

Ações: `retry` ou `close`. Razões permitidas: `dependency_restored`,
`payload_reviewed`, `context_reviewed`, `unrecoverable`, `duplicate_confirmed`.
`retry` reinicia o ciclo sem apagar total/evidência. Não é permitido para resultado
já concluído, artefato persistido corrupto ou legado com efeitos incertos. Esses
casos exigem reconciliação e encerramento explícito, não repetir efeitos cegamente.
`close` encerra a recuperação e libera o próximo inbound, preservando o status
de processamento real. Não é consentimento, seleção nem compartilhamento.

Mesma chave/corpo reproduz confirmação sem nova mutação; chave com outro corpo
retorna 409. Inexistente: 404; estado/ação inseguros: 409. `operator_id` é uma
identidade **declarada pelo portador da chave interna**, não identidade individual
autenticada: RBAC/sessão administrativa ainda precisam ser implementados. Manter
essa API inacessível ao público e a credencial fora de workflows de usuário.

## Migration e rollout futuro

019 adiciona contadores, agendamento, lease persistida, fingerprint de contexto,
quarentena e eventos/indexes. Não altera migrations 001–018. Falhas/processamentos
legados sem `contextual_queue` existentes no upgrade ficam em
`legacy_effects_uncertain`: antes da 019 podiam ter efeitos parciais. Rever e
reconciliar; não inventar resultado nem disparar automaticamente novamente.

Down protegido P0019 quando há eventos, quarentena/encerramento, retry agendado
ou tentativas de entradas não concluídas. Dados legados compatíveis e entradas
normais concluídas podem fazer down; contadores operacionais de concluídas são
metadados removidos, não se apagam seus resultados/Outboxes. Não eliminar
evidência para forçar downgrade. Preferir roll-forward.

Publicação futura: backup/verificação → pausar consumidores/ingresso durante a
troca de contrato de recuperação → aplicar **todas as migrations pendentes em
ordem, inclusive 017, 018 e 019** → publicar API com B2 desligada → verificar
saúde/diagnóstico → importar export inativo → homologar → ativar somente por
decisão do operador. Não manter réplicas antigas gravando sem fencing após 019.
Nenhuma variável de ambiente ou dependência nova; parâmetros n8n existentes.

## Alertas iniciais e limites

Diagnóstico: elegíveis, retries futuros, processing, leases vencidas,
quarentenas/encerrados, falhas permanentes, idade máxima por estado,
tentativas 0/1/2–4/5, recuperações concluídas, conflitos de fencing e telefones
bloqueados agregados (inclui quem tem uma entrada pendente, mesmo sem sucessora).
Não retorna os telefones. Não logar texto, prompt, resposta integral, token ou chave.

Alertas propostos: qualquer nova quarentena; ≥1 lease vencida por dois ciclos;
entrada elegível mais antiga >120 s; crescimento de fila por cinco minutos;
cinco conflitos de fencing/5 min; fila bloqueada sem redução por 15 min.
Limiar não é SLO medido; ajustar após homologação/carga. Endpoint não instala
alertas por si só. Auditoria e dados requerem retenção/backup com política aprovada.

Garantia: idempotência dos efeitos lógicos internos e recuperação controlada.
**Não** entrega exatamente uma vez no WhatsApp. Recibo incerto, hold e
reconciliação da Outbox continuam necessários. Transporte real, modelo pago,
revisão humana, carga e operações de produção não executados neste checkpoint.

## Cobertura dos 30 cenários solicitados

Os números abaixo são os IDs do prompt deste checkpoint, não novos IDs T01–T60.
As integrações usam PostgreSQL/PostGIS real; IA/geocoder/transportes são simulados.
Injeção de falha por trigger ocorre somente no banco descartável de CI. Teardown
remove exclusivamente fixtures criados pelo teste; não apaga evidências reais
para permitir rollback. A proteção é assertada **antes** do teardown.

| IDs | Prova automatizada |
| --- | --- |
| 1 | Recovery 204 sem corpo; autenticação e gates do export |
| 2–3 | `(created_at,id)` e empate de timestamp em `inbox-recovery.integration.test.ts` |
| 4–6 | Workers concorrentes, claims únicos, FIFO mesmo telefone e avanço independente |
| 7–8 | Abandono, backoff, tentativa antiga sem commit/memória/proposta/rascunho/efeitos |
| 9–12 | B2 interrompida antes/depois de proposta/rascunho; consumidor autônomo reutiliza artefatos; commit antigo rejeitado |
| 13–14 | Triggers após busca/Outbox causam rollback; repetição após conclusão retorna mesmo texto/Outbox; consumidor seguinte não reclama processada |
| 15–16 | Cinco falhas e cinco abandonos, delays 30/60/120/240, token repetido não soma tentativa; sem sexta execução |
| 17–18 | Dependência permanente, proposta/resultado corruptos e payload conflitante entram em quarentena preservando original |
| 19–21 | Disposição autenticada, request_id repetido sem reset/efeito; close não simula processed, permite próxima mensagem |
| 22–23 | TTL expirado impede seleção; revisão/fingerprint alterados preservam contexto e checkpoint, sem reutilizar escolha antiga |
| 24–26 | B2 desligada não consome entradas contextuais; B2 simulada ligada; IA/geocoder indisponíveis no recovery geram fallback persistido, replay sem chamadas |
| 27–28 | Legado/B2/contato bilateral: rollback após efeitos e Outbox, retry e concorrência sem cliente/conversa/contato/notificação duplicados |
| 29 | Agregados validados no schema, sem telefone/texto/token/ID da mensagem; logger real mantém sanitização |
| 30 | Down 019 rejeitado P0019 preserva dados e 018; pipeline down compatível 019–008, reaplica 008–019 e repete integrações |

Além desses casos, regressões de consentimento, candidatos mostrados/elegíveis,
seleção numérica/nome, páginas e resposta profissional continuam na suíte completa.
Testes antigos que tentavam ultrapassar uma entrada pendente agora completam essa
entrada pelo consumidor antes da seguinte; não se removeu a barreira FIFO.

O corpus B2 continua congelado, sem ajuste de labels/prompts ou execução paga.
`300/300` e `18/18` são simulações, não comprovação de naturalidade com modelo real.
Falhas de CI intermediárias foram registradas: inferência SQL do parâmetro de erro,
fixtures que ultrapassavam FIFO e validação de fallback determinístico como texto
de IA. As correções mantêm constraints e acrescentam regressão específica.

## Interação com mídia durável020

Inbox media_pending não é elegível e bloqueia entradas posteriores do telefone.
A transcrição libera o mesmo registro; avisos técnicos fecham o placeholder sem
chamar o domínio. Divergência coloca-o em quarentena preservando resultado e
contexto. API e migrations até020 devem preceder os consumidores. Ver
[TRANSPORT_DURABILITY.md](TRANSPORT_DURABILITY.md); não usar retry administrativo
genérico para inventar uma transcrição ou remover o bloqueio de mídia.
