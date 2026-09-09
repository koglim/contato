# API Product Core — contato bilateral

## Rodada atual: `feat/bilateral-contact`

Base exata: `a3135a7f2b6543ce069c1b0b65b0bf428272bbd6`. Sem merge, frontend, n8n, gateway, IA ou variável de ambiente nova. Esta rodada implementa somente a etapa 3; aceite/recusa profissional, avaliações, assinaturas e autenticação permanecem fora do escopo.

### Jornada e decisões

1. Cliente recebe página numerada com aviso curto `bilateral-v1`. Versão e conteúdo ficam na Outbox real; reserva não é exposição. `shown_at` só muda após `sent`.
2. Escolha por número/nome após envio do aviso é consentimento suficiente, sem segunda pergunta. A transação valida ownership entre cliente, conversa, busca, match e apresentação.
3. Em apresentação legada sem essa evidência, a escolha cria somente uma pendência e um prompt sem telefone. Estado persiste em `search_conversations.bilateral_pending`. Confirmação afirmativa após envio do prompt efetiva a oportunidade; recusa volta às opções. Perguntas/hipóteses não consentem. Cancelar/recomeçar mantêm prioridade e TTL não é renovado implicitamente.
4. Contato, snapshot, código público, escolha, conclusão e as duas mensagens são atômicos. Cliente recebe dados do profissional e código; profissional recebe código, serviço/local disponíveis, resumo limitado e telefone do cliente. Sem IDs/ranking/PII desnecessária. Ainda não há comandos profissionais de aceite/recusa.
5. UUID do inbound continua chave idempotente. Replay após crash encontra contato/snapshot mesmo com conversa concluída; resposta ao cliente já está na Outbox. Confirmação/recusa legada também possui recuperação persistida. Replays não criam outro contato nem notificação e preservam mensagens `sent`.

Código: oito caracteres aleatórios seguros após `CC-`, índice único case-insensitive e retry limitado para colisões reais. Snapshot contém apenas dados autorizados/limitados e evidência versionada da escolha. Trigger impede sua alteração; edição de perfil não muda o resultado escolhido. `createIndependent` exige chave única de negócio, compara destinatário/finalidade/conteúdo e não executa UPDATE no replay.

### Migration 014 e barreira operacional aprovada

Não modificar o histórico aplicado 010/012. Não arquivar PII em tabelas auxiliares/shadow, não criar inbound fictício e não apagar dados para permitir downgrade.

O down 014 adquire locks e faz preflight **antes de qualquer alteração destrutiva**. Se houver notificações independentes, chaves de idempotência, snapshots, códigos, consentimentos, pendências ou avisos auditáveis, aborta integralmente com `P0014 / BILATERAL_ROLLBACK_BLOCKED`. Dados, schema, histórico de migrations e estados de envio permanecem iguais; mensagens enviadas não voltam a pending.

Essa é a estratégia de **rollback protegido**, não uma deficiência. Em ambiente com dados incompatíveis, usar correção evolutiva/roll-forward; quando realmente necessário, restauração integral de backup verificado e reconciliação dos envios externos. Não existe caminho parcial que esconda ou transforme PII.

CI distingue cenário A (erro específico esperado, rollback real bloqueado com fingerprints iguais antes/depois e fixtures vivas) e cenário B (dados legados compatíveis mantidos durante down 014 → 008, verificações, reaplicação e todas as integrações novamente). Qualquer erro diferente do esperado reprova A. Limpeza dos fixtures de A acontece somente depois da prova, não para viabilizar seu rollback.

### Compatibilidade e operação

Migration não inventa consentimento/snapshot/código para legado. Contatos antigos continuam sem notificação retroativa. Campos novos nulos significam ausência de evidência. Pool 20, página 3, teto 6, ranking fair-v1, comandos globais e endpoints atuais permanecem. Contrato compartilhado adiciona `consent_required`, `consent_declined` e código opcional no `selected`.

Aplicar migration 014 em homologação antes desta API, com backup verificado. Nenhuma alteração automática no EasyPanel foi feita. O consumidor por ID segue intacto; a fila profissional usa o dispatcher existente, mas conectar um consumidor n8n para notificações independentes continua uma ação separada. Não foi prometido envio externo nesta etapa.

### Privacidade e riscos restantes

Confirmar juridicamente a redação/base legal, finalidade e retenção do aviso, consentimento, snapshots, Outbox e backups; não se declara conformidade LGPD absoluta. Há minimização/sanitização de texto e isolamento por identidade, não detecção semântica infalível de toda PII em texto livre. Revisar configuração e acesso aos logs do próprio PostgreSQL. Erros das rotas afetadas não serializam exceções SQL com dados sensíveis.

Um transportador pode aceitar o envio antes de uma queda impedir `/sent`; exactly-once externo continua dependendo de idempotência/reconciliação do transportador. Códigos aleatórios têm retry limitado, não espaço infinito. Política de expiração da conversa permanece; uma confirmação recebida antes de `sent` não autoriza compartilhamento.

### Evidências da rodada

- `59496835fd1aa2da9bdea5bc57dd920ed683a5ae`: migration/rollback protegido. [CI aprovado](https://github.com/koglim/contato/actions/runs/34303492772), com sete provas de bloqueio em PostgreSQL.
- `2ff53a8b138bed6d43dec45bbc3eaea3b1fdd126`: integração bilateral; 235 API + 6 web passaram localmente. O [CI](https://github.com/koglim/contato/actions/runs/34304629613) identificou fixture `sent` sem `provider_message_id`, corrigida no checkpoint seguinte; esse run não é aprovação da etapa.
- `ba75d1730e0d1176a40f7a5648360b75cf6a8b66`: [CI aprovado](https://github.com/koglim/contato/actions/runs/34304900527): 237 API, 6 web e 43 integrações antes e depois da reaplicação, nenhuma ignorada.
- `9bad5ef72f3107ae7fa0570bd031739640ee17f6`: preservação dos vínculos de conversa/busca no replay após crash, timestamps comparados diretamente no PostgreSQL e confirmação por prompt repetido efetivamente enviado. Adicionada recuperação real do prompt legado antes de `processed`. [CI aprovado](https://github.com/koglim/contato/actions/runs/34305532350): 237 API + 6 web; 44 integrações em sete arquivos, antes e depois da reaplicação; sete cenários de bloqueio protegido e rollback compatível 014 → 008 aprovados, sem testes ignorados.
- Validações locais da revisão: `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test` (237 API + 6 web), lint explícito da migration 014, `git diff --check` e 39 testes direcionados aprovados. Logs completos locais ficaram no diretório temporário da máquina, fora do repositório.
- Os resultados finais, contagens e link do SHA final devem ser conferidos na entrega desta rodada. PostgreSQL/PostGIS e Docker não estão disponíveis localmente; provas reais usam somente o banco descartável do GitHub Actions, nunca o banco do EasyPanel.

### Arquivos desta rodada

```text
.github/workflows/ci.yml
database/migrations/014_add_bilateral_contact.js
apps/api/integration/bilateral-rollback.integration.test.ts
apps/api/integration/channel-outbox.dispatcher.integration.test.ts
apps/api/integration/matching-pagination.integration.test.ts
apps/api/integration/selection-match.repository.integration.test.ts
apps/api/src/modules/bilateral-contact/bilateral-contact.policy.ts
apps/api/src/modules/bilateral-contact/bilateral-contact.policy.test.ts
apps/api/src/modules/bilateral-contact/bilateral-contact.transaction.ts
apps/api/src/modules/channel-inbox/channel-inbox.repository.ts
apps/api/src/modules/channel-inbox/channel-inbox.routes.ts
apps/api/src/modules/channel-inbox/channel-inbox.service.ts
apps/api/src/modules/channel-inbox/channel-inbox.service.test.ts
apps/api/src/modules/channel-outbox/channel-outbox.repository.ts
apps/api/src/modules/channel-outbox/channel-outbox.repository.test.ts
apps/api/src/modules/channel-outbox/channel-outbox.routes.ts
apps/api/src/modules/channel-outbox/channel-outbox.types.ts
apps/api/src/modules/customer-search/customer-search.routes.ts
apps/api/src/modules/customer-search/customer-search.service.ts
apps/api/src/modules/match-selection/match-selection.repository.ts
apps/api/src/modules/match-selection/match-selection.repository.test.ts
apps/api/src/modules/match-selection/match-selection.types.ts
apps/api/src/modules/message-presentation/message-presentation.service.ts
apps/api/src/modules/message-presentation/message-presentation.service.test.ts
apps/api/src/modules/selection-command/selection-command.service.ts
apps/api/src/modules/selection-command/selection-command.service.test.ts
apps/api/src/modules/selection-command/selection-command.types.ts
apps/api/src/modules/selection-message/selection-message.mapper.ts
apps/api/src/modules/selection-message/selection-message.presenter.ts
packages/shared/src/schemas/selection-message.ts
docs/ARCHITECTURE.md
docs/DATA_MODEL.md
docs/API.md
docs/API_PRODUCT_CORE_HANDOFF.md
```

---

## Checkpoint histórico — etapas 0–2 (8 de setembro de 2026)

O conteúdo abaixo registra a base anterior. As observações antigas sobre etapa 3 pendente ou migration 012 ainda não integrada foram superadas pela rodada descrita acima; não são instruções para reescrever migrations aplicadas ou iniciar etapas 4–8.

## Escopo entregue e limites

Branch: `feat/api-product-core`, criada da foundation `db8716c84e153ed098b9fb73d70216812581713a`. Não houve merge, deploy, alteração do frontend, n8n, segredos ou variáveis de ambiente.

Esta entrega conclui a estabilização da base e o recorte implementado das etapas 1 e 2: pool/páginas e ranking auditável. **Não é a conclusão do núcleo completo do produto.** As etapas 3–8 abaixo ainda não foram iniciadas. A política de elegibilidade por assinatura depende da etapa 6 e não está ativa.

### Etapa 0 — foundation

O remoto já continha a correção solicitada no fixture de lease abandonada (`attempt_count` 1 → 2). Nenhum commit artificial foi criado para repeti-la. Foundation validada localmente com lint, typecheck, build, 228 testes API e 6 web; [CI original aprovado](https://github.com/koglim/contato/actions/runs/34275998125).

### Etapa 1 — pool e apresentação

- Pool interno fixo de até 20; página padrão/máxima de 3; máximo de 6 apresentados por busca.
- `limit` legado continua aceito de 1 a 10; 1/2 reduzem a página, 4–10 são limitados a 3. `meta.limit` informa o limite efetivo. Formato de resposta preservado.
- Rank absoluto, candidatos 7–20 auditáveis mas fora da paginação. `hasMore` não fica preso por candidatos fora do teto.
- Reserva pendente bloqueia outra página. Reserva não conta como exposição; confirmação `sent` conta uma única vez, preservando a data original.
- Leituras defasadas e páginas concorrentes são validadas novamente na transação da Outbox.
- Mensagem de um dígito aceita pela Inbox/Customer Search, sem reduzir a exigência de chave idempotente para escolha.
- PostgreSQL cobre 0/1/2/3/4/6/20/25 elegíveis, limites legados, envio, falha/retry, replay, concorrência e seleção na segunda página.

O primeiro cenário usava uma frase sem marcador de localização reconhecido e foi corrigido para `aqui em Sinop`. Uma execução posterior revelou deadlock real: locks `KEY SHARE` obtidos pelas FKs da Inbox eram promovidos para `FOR UPDATE` simultaneamente. A reserva agora usa `FOR NO KEY UPDATE`. Uma barreira no teste PostgreSQL garante que ambas as transações já possuem os locks de FK antes de reservar: o resultado exigido é uma reserva e um conflito controlado, nunca deadlock.

### Etapa 2 — ranking fair-v1

Ordem: disponibilidade recente → banda de distância de 2 km → verificação → banda de reputação de 0,5 → menor carga de exposição → reputação exata → distância → UUID.

Reputação bayesiana: `(soma + 20) / (quantidade + 5)`. Sem histórico, prior 4. Só entram avaliações publicadas de contatos concluídos com cliente/profissional correspondentes, excluindo telefone próprio. Carga: exposições confirmadas em 7 dias + 3 × contatos em 7 dias + 5 × repetição do cliente em 30 dias. Profissionais comparáveis e pouco expostos podem entrar no pool mesmo que estivessem fora dos 20 anteriores. Não há aleatoriedade, promessa de cotas, IA no ranking ou exposição de sinais privados ao usuário.

Policy/version e todos os sinais ficam no `score_breakdown`; ordenação é aplicada antes do limite do pool. Persistência em lote, sem `INSERT` por profissional. Migration 013 adiciona apenas três índices de sinais, reversíveis sem alteração de dados. A existência de área representa cobertura operacional no schema atual; não foi inventado um campo de ativação ou entitlement inexistente.

## Commits de implementação

| SHA | Entrega |
| --- | --- |
| `9041a55ce3d69a7f1f96b9f2841e8f79c3175854` | Separação pool/página/teto e integrações |
| `05570e9d10ce415e4eb346c597a3a43754ca88f0` | Correção do texto de localização do fixture |
| `de388954af230fbb33b8f6324dba9f783887dd2c` | Ranking, sinais, índices e CI ampliado |
| `156e6bf8bfeb27fa8b69558045195ff77f306cc3` | Correção de deadlock e regressão determinística |
| `41195bb1540851478598e2e4cce8091535c5b702` | Descoberta explícita dos 41 arquivos de testes API e lint de scripts/integrações |

O commit de documentação deste handoff é posterior; consulte `git log` para seu SHA.

## Validações e evidências

- `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test`: aprovados localmente; 231 testes API + 6 web, nenhum ignorado.
- ESLint executado também nos dois novos arquivos de integração e na migration 013. O script API `lint` agora inclui `src scripts integration` permanentemente.
- Não há PostgreSQL/PostGIS ou Docker disponível neste ambiente local. **Integrações e migrations não foram executadas localmente**, nem contra EasyPanel.
- GitHub Actions usa exclusivamente PostgreSQL/PostGIS descartável. Executa migrations completas, integrações, verificações de schema, rollback individual 013 → 012 → 011 → 010 → 009 → 008, verificação de preservação e reaplicação. As integrações rodam novamente depois da reaplicação.
- Os comandos `psql` agora usam `ON_ERROR_STOP=1`, para que uma asserção SQL realmente reprove o job.
- Integrações executam arquivos sequencialmente para isolar a fila global do dispatcher. Os cenários concorrentes continuam usando conexões reais simultâneas.
- A auditoria dos logs mostrou que os checkpoints anteriores executavam somente 13 testes unitários API no Linux: a expansão de `src/**/*.test.ts` pelo shell omitia os módulos e `app.test.ts`. O runner agora descobre arquivos recursivamente e passa caminhos explícitos ao Node/tsx nas duas suítes. O CI de `41195bb` comprovou 231 testes API + 6 web, todos aprovados, além de 27 integrações PostgreSQL antes e 27 depois da reaplicação, sem falhas ou testes ignorados. O CI final deve comprovar essas mesmas contagens, não apenas o status verde anterior.

Execuções dos checkpoints:

- [9041a55 — fixture de localização falhou; corrigido](https://github.com/koglim/contato/actions/runs/34298389298).
- [05570e9 — paginação aprovada](https://github.com/koglim/contato/actions/runs/34298706062).
- [de38895 — concorrência revelou deadlock; corrigido](https://github.com/koglim/contato/actions/runs/34299114107).
- [156e6bf — correção de concorrência, ranking e 27 integrações aprovadas antes/depois dos rollbacks](https://github.com/koglim/contato/actions/runs/34299441392).
- [41195bb — aprovado com descoberta completa e portável de testes](https://github.com/koglim/contato/actions/runs/34300018630).

O resultado e link do CI do commit final de documentação acompanham a entrega; nunca tomar um run de SHA anterior como validação do HEAD.

## Arquivos alterados em relação à foundation

- `.github/workflows/ci.yml`
- `apps/api/package.json`
- `apps/api/scripts/run-tests.mjs`
- `apps/api/integration/matching-pagination.integration.test.ts`
- `apps/api/integration/matching-ranking.integration.test.ts`
- `apps/api/src/modules/matching/matching-policy.ts`
- `apps/api/src/modules/matching/matching-policy.test.ts`
- `apps/api/src/modules/matching/matching-ranking.ts`
- `apps/api/src/modules/matching/matching.repository.ts`
- `apps/api/src/modules/match-selection/match-selection.repository.ts`
- `apps/api/src/modules/match-selection/match-selection.repository.test.ts`
- `apps/api/src/modules/channel-outbox/channel-outbox.repository.ts`
- `apps/api/src/modules/channel-outbox/channel-outbox.repository.test.ts`
- `apps/api/src/modules/selection-command/selection-command.service.ts`
- `apps/api/src/modules/selection-command/selection-command.service.test.ts`
- `apps/api/src/modules/selection-message/selection-message.presenter.ts`
- `apps/api/src/modules/selection-message/selection-message.mapper.test.ts`
- `packages/shared/src/schemas/channel-inbox.ts`
- `packages/shared/src/schemas/customer-search.ts`
- `database/migrations/013_add_matching_signal_indexes.js`
- `docs/API.md`
- `docs/ARCHITECTURE.md`
- `docs/DATA_MODEL.md`
- `docs/API_PRODUCT_CORE_HANDOFF.md`

## Configuração e ações manuais

| Nome | Finalidade | Obrigatória | Default | Secreta | Quando configurar |
| --- | --- | --- | --- | --- | --- |
| Nenhuma variável nova/alterada | Etapas 0–2 usam política interna versionada | Não | Pool 20 / página 3 / teto 6 | Não | Nenhuma ação no EasyPanel |

As variáveis existentes mantêm seus contratos e valores; `.env.example` não foi alterado. Autenticação profissional/OTP **não foi criada**, portanto não existem segredos novos para ativá-la nesta entrega. Nenhum gateway foi escolhido.

Após revisão e autorização futura, executar migrations pendentes em ambiente de homologação com backup/plano de rollback. A 013 cria índices normais dentro da transação: em tabelas grandes, medir duração/locks e planejar janela ou migração operacional concorrente antes de produção. Não aplicar nada no EasyPanel apenas por causa deste handoff.

Nenhuma ação n8n é necessária para o que foi implementado. O dispatcher geral ainda demandará um consumidor separado em etapa futura; manter o workflow atual por ID até essa integração ser autorizada. Gateway de pagamento, entrega efetiva de OTP e requisitos jurídicos de consentimento/retenção continuam decisões e integrações futuras.

## Backlog exato para continuação

### Etapa 3 — contato bilateral (próxima)

1. Avisar sobre compartilhamento do número em cada apresentação e registrar versão/contexto do aviso e da escolha. Tratar apresentações legadas sem aviso explicitamente, sem presumir consentimento retroativo.
2. Criar código público curto aleatório e único por oportunidade, sem UUID/PII; persistir snapshot necessário para replay estável da seleção/notificação.
3. Seleção, contato e intenção profissional na mesma transação. Notificação sanitizada: código, serviço, cidade/UF, bairro quando pertinente, resumo limitado e telefone do cliente somente após escolha consciente.
4. Revisar migration 012 ainda não integrada à main: finalidades `customer_reply`, `professional_contact_notification`, `customer_contact_update`, `review_request`, `auth_otp`; preferir representação evolutiva segura. Adicionar vínculo/chave de idempotência de negócio para mensagens independentes. Hoje `createIndependent` não possui essa unicidade e não deve ser ligado à seleção assim.
5. Migration seguinte livre é **014**; não reutilizar 013. Se alterar 012, tratar explicitamente bancos de desenvolvimento que já a aplicaram, sem reescrever histórico silenciosamente.
6. Provar rollback com dados independentes presentes. O down atual de 012 exige ausência dessas linhas; o CI atual limpa fixtures antes desse rollback e não prova compatibilidade de registros independentes vivos.
7. Testes reais de seleção simultânea, replay/crash, unicidade de contato/notificação, rollback do INSERT e PII, usando repositório de produção. Não enviar mensagens reais.

### Etapa 4 — resposta profissional

Máquina de estados e eventos auditáveis; aceite/recusa idempotentes e condicionais; propriedade validada por identidade resolvida. Contexto de cliente/profissional não é exclusivo por telefone. Código explícito tem prioridade; uma única oportunidade pendente admite comando inequívoco; múltiplas oportunidades pedem esclarecimento. Cada transição cria no máximo uma resposta Outbox ao cliente. Recusa nunca seleciona substituto automaticamente; modelar reabertura/oferta das opções já apresentadas. Concorrência aceitar × recusar e profissional incorreto obrigatórias no PostgreSQL.

### Etapa 5 — conclusão e avaliações

Conclusão rastreável, solicitação de avaliação não bloqueante e uma avaliação por contato concluído, enviada pelo cliente correto. Nota inteira 1–5, comentário limitado/sanitizado, origem, idempotência, prevenção de autoavaliação e moderação sem apagar histórico. Não aceitar apenas conhecimento de UUID. Integrar o cálculo de reputação existente sem contar avaliações pendentes/ocultas/inválidas.

### Etapa 6 — assinatura e entitlement

Planos/assinaturas/eventos provider-agnostic, administração manual interna, períodos/trial/grace/expiração/suspensão, sem SDK ou gateway fictício. Backfill/acesso legado explícito preserva elegíveis existentes. Novos sem direito ativo ficam fora. Política central de entitlement integra o matching; suspensão prevalece. Provar rollback com dados. Até isso existir, não alegar que o ranking já exclui inadimplentes.

### Etapa 7 — autenticação e API profissional

OTP com hash, validade, consumo único, tentativas/cooldown/rate limit e proteção contra enumeração. Sessões opacas com hash, revogação/logout/ownership. Entrega por Outbox, sem Evolution direto; resolver a proteção e retenção do conteúdo sensível da mensagem OTP, não alegar “somente hash” se seu conteúdo estiver em texto na Outbox. Configuração opcional/desabilitada por padrão até haver segredos necessários. Rotas profissionais de perfil, serviços/preços, áreas/disponibilidade, contatos/transições, avaliações, assinatura/métricas e sessões. Identidade sempre da sessão, nunca do `professionalId` enviado. Manter `/internal` administrativo.

### Etapa 8 — operação e privacidade

`next_attempt_at`, backoff limitado, máximo de tentativas, dead-letter, recuperação individual interna e unicidade de negócio. Preservar endpoints por ID/n8n atual, claim estável com `SKIP LOCKED`, sem transação durante envio. Listagens paginadas/limitadas e métricas agregadas; rever logs de exceções PostgreSQL para impedir detalhes com PII. Retenção de mensagens, anonimização com integridade, moderação lógica e revogação de sessões. Validar com jurídico consentimento/retenção; não declarar conformidade LGPD absoluta. Sem Redis ou serviço externo desnecessário.

### Riscos adicionais a validar

- Medir planos de matching/sinais com volume real antes de otimizar agregados; 25 fixtures não provam escala de produção.
- Replay da seleção atualmente consulta dados vivos de profissional/serviço. Preservar snapshot quando a etapa bilateral exigir texto original imutável mesmo após edição de perfil.
- Provar crash no início da busca entre criar `selection` e persistir a primeira Outbox, além do crash de seleção já coberto. Não presumir que replay de inbound processado cobre todas as janelas.
- Validar recuperação lazy de Outbox legada e formatos antigos com mais de três matches antes de migrar instalações que tenham esses resultados persistidos.
- Repetir provas de lock entre cancelamento, seleção e reserva de página quando ampliar as transações; não trocar `NO KEY UPDATE` por `UPDATE` sem revisar os locks de FK.

## Prompt de continuação

Continue `koglim/contato` na branch `feat/api-product-core`, atualizando somente por fast-forward a partir do remoto. Leia os AGENTS aplicáveis, este handoff, README, docs de arquitetura/modelo/API, migrations e código/testes afetados. Confira o SHA e o CI do HEAD. Preserve os commits de pool, ranking e correção de deadlock. Etapas 0–2 estão entregues no recorte descrito; siga agora a etapa 3 (contato bilateral) deste backlog e depois 4–8 sequencialmente. Use 014 como próxima migration; revise 012 somente com estratégia explícita para quem já a aplicou. Consentimento, telefone, snapshot de replay, código público e unicidade Outbox são obrigatórios antes de ligar notificação profissional à seleção. Não implemente assinatura/OTP de fachada. Faça commits pequenos, valide lint/typecheck/build/test e PostgreSQL real antes/depois dos rollbacks/reaplicação; mantenha ON_ERROR_STOP=1 no CI. Faça push dos checkpoints e aguarde o Actions do SHA correto. Não faça merge, deploy, alterações de frontend/n8n ou uso do banco real. Se a rodada terminar antes de todas as etapas, deixe apenas entregas completas, árvore limpa e atualize este backlog com evidências reais.
# Resposta profissional e contexto retomável — aguardando revisão da branch

Decisão aprovada: recusa preserva integralmente outra busca ativa. A busca anterior
fica retomável; somente comando explícito inequívoco troca o foco. A busca atual
fica suspensa/retomável, nunca apagada. “Manter atual” e “continuar aqui” preservam
o contexto. TTL não é renovado artificialmente; expiração exige nova busca.
Revalidar profissionais restantes, preservar shown_at, não selecionar substituto.
Ao suspender a busca atual, retornar seu código de retomada para permitir voltar
mesmo que ambas as buscas sejam do mesmo serviço. Não renovar o TTL nessa troca.

Branch: feat/professional-opportunity-response. Migration nova: 015, com up/down
protegido. Não executar em produção nem fazer deploy nesta etapa. Confirmar CI
PostgreSQL e rollbacks antes de aprovar. n8n, frontend e variáveis não alterados.

Cobertura: decisões naturais/código, ambiguidade, proprietário, dupla identidade,
aceite/recusa concorrentes, recusa com/sem busca ativa, suspensão/retomada, TTL,
falha de Outbox e falha antes de concluir inbound, replay, alternativas elegíveis,
próxima página, confirmação de envio e proteção de rollback. Testes usam Inbox,
serviços/repositórios reais e banco descartável do CI, sem integração de produção.
O consumidor futuro deve continuar confirmando por ID/lease, sem enviar mensagens
fora da Outbox. A etapa não garante entrega externa até o consumidor ser integrado.
