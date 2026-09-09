# Entrega WhatsApp e reconciliação

O gateway imediato e o dispatcher usam a mesma Outbox. A API persiste os textos
e as decisões; o transporte somente envia o conteúdo reivindicado. O dispatcher
é necessário para notificações independentes ao profissional e ao cliente.

## Contrato do consumidor

- `POST /internal/channel/outbound/next/claim`: 204 encerra normalmente; 200 com
  `status=processing` fornece o ID, token, destinatário, texto, finalidade e provider.
- `POST /internal/channel/outbound/:id/claim`: `sent` encerra sem envio; 409 não
  autoriza transporte nem `/failed`. Nunca usar telefone do webhook para enviar
  uma mensagem independente.
- Só enviar após validar integralmente o payload e conservar o par ID/token
  daquele item. Timeout do transporte deve ser inferior à lease (default 60s).
- Aceitação comprovada pelo provider: `POST /:id/sent` com `processing_token` e
  `provider_message_id`. Repetição idêntica retorna 200; token ou ID diferente
  retorna 409. `sent_at`, `shown_at` e conteúdo não mudam no replay.
- Rejeição comprovada: `POST /:id/failed` com token e `error_code` controlado.
  Falhas 1–4 agendam 30/60/120/240s; quinta falha encerra em `failed`.
- Timeout de resultado desconhecido: `POST /:id/hold` com token e
  `reason=transport_outcome_unknown`. Quando o provider aceitou mas `/sent` não
  foi confirmado: repetir `/sent`; se a confirmação continuar indisponível,
  registrar `reason=confirmation_pending` em `/hold`.

`/hold` retorna `{ id, status: "processing", delivery_status: "reconciliation_required" }`.
Não expõe conteúdo, telefone ou token. Repetir a mesma retenção é seguro. A mensagem
retida não pode ser reivindicada novamente, mesmo com lease vencida. `/failed`
não remove a retenção; `/sent` com o token original e ID comprovado conclui a
reconciliação. Token alheio nunca pode confirmar a mensagem.

Se a API inteira estiver indisponível após o envio, nem a retenção pode ser
registrada: interromper o consumidor, preservar a execução protegida e alertar
o operador. Não transformar essa situação em envio confirmado nem em rejeição.
Exactly-once externo depende do transportador e não é garantido por esta API.

## Concorrência e ordenação

Claim usa `FOR UPDATE SKIP LOCKED`, agenda de retry e lease. A quinta lease
abandonada termina em `failed`, com `last_error_code=lease_attempt_limit`; nunca
há sexta reserva automática. A fila pode entregar outros destinatários enquanto
um está em processamento.

Notificações independentes (`professional_contact_notification` e
`customer_contact_update`) respeitam ordem `(created_at,id)` por provider/telefone.
Uma retenção impede novas notificações independentes ao mesmo destinatário até
reconciliação. Respostas inline mantêm seu contrato: uma nova confirmação de
consentimento pode ser entregue mesmo se o prompt anterior não foi enviado.
Obsolescência de respostas inline ainda precisa de política específica; não
tratar toda mensagem antiga como descartável.

## Dados e release

Migration 017 adiciona hash SHA-256 do token confirmado e motivo de retenção,
sem copiar tokens de mensagens antigas e sem novos secrets/variáveis. O token
ativo continua protegido pelos endpoints internos; o hash não é devolvido.
Recibos legados ausentes não são inventados: claim de mensagem antiga `sent`
encerra, mas uma confirmação antiga sem recibo não ganha autorização retroativa.

Aplicar 017 manualmente antes desta versão da API. Não executar migrations no
startup. Down bloqueia com `P0017 / OUTBOUND_RECEIPT_ROLLBACK_BLOCKED` se houver
recibo ou retenção. Usar roll-forward ou restauração integral validada; nunca
limpar evidências de produção para liberar rollback.

## Operação manual de uma retenção

1. Pausar o envio para o item e conferir a execução/ID no provider com acesso restrito.
2. Se houver aceitação comprovada, chamar `/sent` com o ID retornado e token original.
3. Se não houver prova do resultado, manter a retenção e investigar. Não reenviar.
4. A interface administrativa para autorizar nova tentativa com motivo/auditoria
   ainda está pendente. Não usar SQL ad hoc que apague histórico.

## Diagnóstico sem dados pessoais

`GET /internal/channel/outbound/queue-status`, com chave interna, retorna contagens
por finalidade, retenções, leases expiradas, falhas terminais e criação mais antiga
não enviada. Não altera a fila nem expõe destinatários, conteúdo ou tokens.
Consultar a semântica dos contadores em [API.md](API.md). Começar a investigação
quando houver retenção/dead-letter ou crescimento persistente da idade/pendências;
não disparar um novo envio apenas com base nessas contagens.

Alertas, dashboard operacional, obsolescência, recuperação de Inbox e homologação
n8n continuam pendentes na matriz [V1_EXECUTION.md](V1_EXECUTION.md).
