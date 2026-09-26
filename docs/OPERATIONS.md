# Operação e passagem para homologação

Este é um runbook; não significa que backup, restauração ou transporte real já
tenham sido executados. A matriz [V1_ACCEPTANCE.md](V1_ACCEPTANCE.md) registra a
evidência disponível. Nenhuma operação deste documento deve usar produção como
ambiente de teste.

O próximo ensaio de transporte já tem candidato versionado para **n8n 1.123.21 /
Evolution 2.3.7**, cinco exports inativos e runbook específico em
[TRANSPORT_HOMOLOGATION.md](TRANSPORT_HOMOLOGATION.md). Antes de importar,
rotacionar segredos encontrados no export original; configurar JWT dedicado,
Variables/credentials, borda/TLS e alertas sanitizados. Não salvar dados de
execução/binary/headers. Áudio e avisos usam a admissão durável da 020, sem envio
direto no gateway. A revisão cumulativa, o inventário de variáveis e a ordem
completa estão em [CUMULATIVE_REVIEW.md](CUMULATIVE_REVIEW.md).

## Logs e diagnóstico

A API registra request ID gerado no servidor, método, padrão de rota (não URL
bruta), status e duração. Erros registram somente código operacional permitido;
mensagem, stack, causa e detalhes PostgreSQL/provider não são serializados. O
campo `msg` também é sanitizado quando há objeto de erro. Headers, query, corpo,
IP e valores de parâmetros não pertencem ao evento HTTP. Não aceitar request ID
fornecido pelo cliente como conteúdo livre de log.

Eventos de domínio devem usar código/finalidade/IDs opacos e durações, nunca
payloads, telefones, OTP, tokens ou chaves. A remoção defensiva de campos conhecidos
não autoriza registrar estruturas arbitrárias. Testes com sentinelas sensíveis
verificam o logger real em erro de banco, 404, query/headers/corpo e erro inesperado.
A configuração usa os recursos nativos de
[logging do Fastify](https://fastify.dev/docs/latest/Reference/Logging/).

`GET /internal/channel/outbound/queue-status` permite monitorar a fila por finalidade
sem PII. Contadores de retenção/dead-letter e crescimento da idade exigem
investigação. Alertas automáticos, SLOs e painel de operação ainda não estão
implantados; não confundir endpoint de diagnóstico com monitoramento ativo.

`GET /internal/channel/inbound/queue-status` acrescenta diagnóstico da entrada:
elegíveis, backoff, processamento, leases vencidas, quarentena/encerramento, idade,
tentativas, recuperações e fencing. Sem telefone, texto, prompt ou token. Alertas
iniciais e significados estão em [INBOX_RECOVERY.md](INBOX_RECOVERY.md).

## Incidente de entrada (Inbox)

1. Conferir SHA/migrations e diagnóstico agregado; restringir investigação de um
   ID a pessoal autorizado. Não publicar payload/execuções em chamados.
2. Entradas recuperáveis são processadas por `/internal/channel/inbound/next/process`;
   204 é normal, inclusive durante backoff. O export agendado está inativo no repo.
3. Quarentena não libera FIFO. Reconciliar evidências; usar `:id/disposition` com
   request_id, operator_id, ação/razão estritas. Retry/close são auditados e
   idempotentes, sem representar consentimento ou compartilhar contatos.
4. Não alterar SQL manualmente para zerar contagem, remover token ou apagar evento.
   Resultado/proposta corruptos e legado com efeitos incertos não admitem retry
   cego. `close` preserva evidências e libera a continuidade explicitamente.
5. B2 desligada mantém entradas contextuais aguardando, sem consumi-las pelo
   caminho legado. Monitorar essa fila; ativação continua exigindo homologação.
6. Operador declarado via chave interna não é RBAC individual. Manter endpoint
   restrito e registrar responsabilidade operacional fora de logs com PII.

## Incidente de entrega

1. Identificar ambiente, SHA e ID da Outbox usando acesso restrito. Consultar
   contagens/códigos, não publicar dump de execução n8n nem telefone em chamados.
2. Interromper o consumidor afetado se houver resultado incerto. Não usar outro
   consumidor para contornar uma retenção.
3. Se o provider confirmar aceitação com ID correspondente, repetir `/sent`
   com o token original. A repetição não envia mensagem novamente.
4. Se o resultado for desconhecido, usar `/hold` e preservar evidências com
   acesso restrito. Se a API estiver indisponível, preservar a execução e manter
   envio pausado até reconciliar; não classificar timeout como rejeição.
5. Não apagar tokens, recibos, reservas ou vínculos para liberar retry. A disposição
   administrativa da Outbox retida está implementada na 020, exige evidências e
   registra auditoria. Não confundir esse recurso com a disposição da Inbox nem
   com autorização para reenviar dead-letter ou fechar páginas indiscriminadamente.
6. Depois de resolver a causa, homologar um caso de teste autorizado e acompanhar
   a fila. Comunicar impacto, ações e estado final sem expor dados pessoais.

## Backup e restauração — ensaio obrigatório antes de produção

- Operador confirma projeto, banco, versão PostgreSQL/PostGIS, papel de acesso e
  destino criptografado. Credenciais em serviço/cofre, nunca argumento versionado.
- Produzir backup consistente de dados **e** schema; preservar sequência de
  migrations, snapshots, Outbox, recibos, reservas, eventos e sessões quando existirem.
- Restaurar em banco descartável novo, isolado de n8n/providers. Não iniciar
  consumidores nem enviar mensagens a partir do banco restaurado.
- Verificar extensões, constraints, migrations, contagens e fingerprints dos
  registros críticos. Rodar integrações somente em fixtures isolados compatíveis.
- Simular recuperação do serviço e reconciliar envios que possam ter ocorrido
  depois do ponto do backup: restaurar uma Outbox para pending não prova que não
  houve entrega. Bloquear o consumidor até essa investigação terminar.
- Registrar duração, ponto de recuperação e resultado. RPO/RTO, retenção e
  permissão de restauração real precisam de aprovação operacional. O CI prova
  migrations/rollbacks; não substitui esse ensaio de recuperação de backup.

## Ordem de release deste checkpoint (manual, após revisão)

1. Revisar a branch/CI e confirmar backup restaurável e ambiente de homologação.
2. Pausar ingresso e consumidores durante a troca; conferir `pgmigrations` e
   aplicar todas as pendentes pelo runner, incluindo **017, 018, 019 e 020**. Não
   presumir 017/018 existentes. Não executar migrations no startup da API.
3. Publicar API compatível com 020, B2 desligada. Não manter réplicas antigas
   gravando sem fencing. Verificar `/health/db` e diagnósticos Inbox/Outbox.
4. Publicar web do mesmo SHA cumulativo: ele inclui a proteção do BFF e status/
   telefone somente leitura. Isso ainda não oferece identidade multiusuário.
5. Importar exports **inativos** e configurar credenciais/parâmetros conforme
   [workflows/n8n/README.md](../workflows/n8n/README.md). Conferir versão e export do
   gateway antes de substituir seu ramo de transporte; usar o novo gateway
   inativo e o runbook específico, preservando instance:key.id histórico.
6. Homologar os cinco componentes (gateway, shared delivery, dispatcher, recovery
   e media consumer), números distintos, queda/lease/FIFO, quarentena/admin e
   ausência de duplicação lógica. Ativar somente com autorização.

Não há nova variável API/web neste checkpoint de Inbox. Manter
`CONVERSATION_AI_ENABLED=false`; `OPENAI_CONVERSATION_MODEL` e a chave B2
conservam seus contratos. `OPENAI_CONVERSATION_TIMEOUT_MS` controla tanto o
timeout do SDK quanto o watchdog do orquestrador e usa `20000` ms por padrão.
Timeout, erro HTTP/rede e saída estruturada inválida mantêm o fallback
determinístico. Falhas posteriores à interpretação (catálogo, orçamento,
persistência, resolução de serviço/localização e controlador) seguem a mesma
telemetria. O log `conversation_ai_fallback` registra somente `reason`,
`duration_ms`, modelo, estágio e o status HTTP da OpenAI quando disponível;
nunca prompt, mensagem do cliente, telefone ou chave. Os nomes `CONTEXTUAL_CONVERSATION_*` são apenas aliases
temporários de compatibilidade.
Parâmetros não secretos e credenciais n8n estão
listados no README dos workflows. A lease existente precisa comportar os timeouts.

Rollback 017 é protegido quando há recibos/retenções. Não limpar registros para
forçá-lo nem voltar a uma API que ignore retenções. Preferir correção roll-forward;
restauração integral só após avaliação do operador e reconciliação de envios.
018/019/020 também têm down protegido quando há dados incompatíveis. Nunca excluir
memória, eventos ou quarentena para forçar downgrade. Casos legados classificados
`legacy_effects_uncertain` no upgrade exigem análise antes de retomar a fila.

# Publicação futura da020

Seguir [TRANSPORT_DURABILITY.md](TRANSPORT_DURABILITY.md): drenar/pausar caminho
antigo, backup, migrations pendentes até020 (incluindo017 e018) antes da API,
cinco exports inativos, credenciais já existentes e homologação autorizada.
Monitorar GET /internal/channel/transport/diagnostics; retenção de bytes exige
consumer ativo ou /media/purge agendado. Falhas totais do worker deixam a expiração
lógica preservada mas atrasam exclusão física. Nunca reenviar hold sem evidência
nem limpar auditoria para rollback. B2 off; sem alteração operacional neste checkpoint.
# Professional auth rollout

Keep `PROFESSIONAL_AUTH_ENABLED=false` until verified account identifiers and memberships have been provisioned and the versioned n8n workflows have been reviewed. Enabling requires an API-only `PROFESSIONAL_AUTH_PEPPER` with at least 32 bytes; the API derives separate OTP, Outbox and public-reference keys and rejects weak configuration. Never reuse or expose the pepper to the browser. Roll back migration 022 only before any challenge, session or authentication outbox data exists; otherwise down fails with `P0022`. The 30-second authentication delivery margin is versioned in code and must not be bypassed operationally. Rollout does not require or authorize a remote n8n or EasyPanel change.
## Migration 023 rollback

Migration 023 may be rolled back only before any membership event contains its provenance. Once present, rollback fails closed with SQLSTATE `P0023` and `PROFESSIONAL_ONBOARDING_AUDIT_ROLLBACK_BLOCKED`. Preserve the evidence and investigate instead of deleting audit rows. See [Professional onboarding and eligibility v1](PROFESSIONAL_ONBOARDING_ELIGIBILITY.md).
