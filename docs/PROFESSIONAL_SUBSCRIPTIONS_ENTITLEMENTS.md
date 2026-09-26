# Professional Subscription & Entitlements v1

## Visão Geral

O PR #14 implementa o domínio agnóstico de assinaturas e direitos de acesso (*entitlements*) para perfis profissionais no ContatoCerto, sem acoplamento a provedores de pagamento externos (Stripe, Mercado Pago, etc.), sem webhooks de billing e sem variáveis de ambiente novas.

O sistema introduz um motor determinístico de direitos de acesso com 7 estados possíveis, centraliza a participação no marketplace (matching inicial, consultas de matches retomados, paginação e seleção bilateral), fecha a brecha residual de identidade do PR #13 e preserva integralmente a compatibilidade com perfis legados.

## Princípios Arquiteturais

1. **Provider-Neutral (Neutro de Provedor)**:
   - Todo o ciclo de vida da assinatura é modelado no PostgreSQL através de planos, assinaturas e eventos imutáveis de auditoria.
   - O provisionamento e manutenção são operados via rotas internas autenticadas por chave (`x-internal-key`).
   - Não há checkout mockado, nem dependências externas de gateway financeiro.

2. **Isenção Legada (Legacy Exemption)**:
   - Perfis `legacy_unmanaged` mantêm isenção total de assinatura e conta (`state = 'legacy_exempt'`, `has_access = true`, `reason_code = 'legacy_profile_exempt'`).
   - Nenhum perfil histórico existente perde elegibilidade de matching ou exige assinatura antes de reivindicação explícita.

3. **Guarda Centralizada de Marketplace**:
   - Perfis gerenciados (`account_managed`) exigem cumulativamente:
     - Identidade ativa e verificada (`eligibleManagedIdentitySql`: conta ativa, membership ativa de dono/admin, telefone verificado).
     - Direito ativo de marketplace (`activeMarketplaceEntitlementSql`: plano ativo com `marketplace_access`, status válido, período vigente, sem revogação).
   - A guarda `marketplaceParticipationSql(tableAlias)` unifica esse predicado SQL em todos os pontos do sistema.

4. **Correção do GAP de Identidade do PR #13**:
   - `resumedMatchEligibilitySql` agora aplica `marketplaceParticipationSql("current_professional")`.
   - Se uma membership for revogada ou a conta for bloqueada após a criação do match, o profissional é imediatamente excluído de `listShown`, `findShownByPosition`, `listNextUnshown`, `selectShownMatch` e do despacho do outbox.

5. **Invariante de Contatos Entregues**:
   - Matches já convertidos em contatos entregues permanecem respondíveis (`accepted` / `declined`) mesmo se a assinatura do profissional expirar ou for revogada posteriormente.

---

## Modelo de Dados (Migration 025)

A migration `database/migrations/025_add_professional_subscriptions.js` adiciona 4 tabelas:

### 1. `subscription_plans`
Catálogo de planos disponíveis:
- `id` (UUID PK)
- `key` (VARCHAR(64) UNIQUE, ex.: `'marketplace_standard_v1'`)
- `name` (VARCHAR(128))
- `status` (VARCHAR(32), `'active' | 'archived'`)
- `price_cents` (INTEGER NOT NULL DEFAULT 0)
- `currency` (VARCHAR(3) NOT NULL DEFAULT 'BRL')
- `interval_unit` (VARCHAR(16), `'month' | 'year' | 'day'`)
- `interval_count` (INTEGER NOT NULL DEFAULT 1)
- `created_at`, `updated_at`

### 2. `subscription_plan_entitlements`
Direitos/recursos concedidos por plano:
- `id` (UUID PK)
- `plan_id` (FK `subscription_plans.id` ON DELETE CASCADE)
- `entitlement_key` (VARCHAR(64) NOT NULL, ex.: `'marketplace_access'`)
- Unique constraint em `(plan_id, entitlement_key)`.

### 3. `professional_subscriptions`
Assinatura vinculada ao perfil profissional:
- `id` (UUID PK)
- `professional_id` (FK `professionals.id` ON DELETE CASCADE)
- `plan_id` (FK `subscription_plans.id`)
- `status` (VARCHAR(32), `'trialing' | 'active' | 'past_due' | 'canceled' | 'expired'`)
- `starts_at` (TIMESTAMPTZ)
- `current_period_starts_at` (TIMESTAMPTZ)
- `current_period_ends_at` (TIMESTAMPTZ)
- `canceled_at` (TIMESTAMPTZ NULL)
- `revoked_at` (TIMESTAMPTZ NULL)
- `notes` (TEXT NULL)
- Índice único parcial: `professional_subscriptions_one_active_idx` em `(professional_id)` onde `status IN ('trialing', 'active', 'past_due') AND revoked_at IS NULL`.

### 4. `professional_subscription_events`
Log append-only imutável de transições de assinatura:
- `id` (UUID PK)
- `subscription_id` (FK `professional_subscriptions.id` ON DELETE CASCADE)
- `event_type` (VARCHAR(64), ex.: `'granted'`, `'extended'`, `'revoked'`, `'reactivated'`)
- `from_status` (VARCHAR(32) NULL)
- `to_status` (VARCHAR(32) NOT NULL)
- `metadata` (JSONB NOT NULL DEFAULT '{}')
- `created_at` (TIMESTAMPTZ NOT NULL DEFAULT NOW())
- Protegido por trigger `protect_professional_subscription_events()` que impede `UPDATE` ou `DELETE`.

### Rollback Protegido
A migration 025 implementa proteção de rollback com código `P0025`: se houver qualquer linha em `professional_subscriptions` ou `professional_subscription_events`, o rollback aborta com erro `PROFESSIONAL_SUBSCRIPTION_ROLLBACK_BLOCKED`. Em banco com apenas dados compatíveis/seed, o rollback reverte tabelas, índices e funções cleanly.

---

## Motor de Entitlements (7 Estados)

O cálculo do snapshot de direitos (`ProfessionalEntitlementSnapshot`) avalia deterministamente:

| Estado (`state`) | `has_access` | `reason_code` | Condição |
| :--- | :---: | :--- | :--- |
| `legacy_exempt` | `true` | `legacy_profile_exempt` | Perfil possui `management_mode = 'legacy_unmanaged'`. |
| `none` | `false` | `no_active_subscription` | Perfil `account_managed` sem registro em `professional_subscriptions`. |
| `plan_inactive` | `false` | `subscription_plan_inactive` | Plano associado à assinatura está com `status != 'active'`. |
| `revoked` | `false` | `subscription_revoked` | Assinatura possui `revoked_at IS NOT NULL AND revoked_at <= NOW()`. |
| `not_started` | `false` | `subscription_not_started` | Assinatura possui `starts_at > NOW()`. |
| `expired` | `false` | `subscription_period_ended` | Período da assinatura expirou (`current_period_ends_at <= NOW()`). |
| `active` | `true` | `active_entitlement` | Assinatura ativa, dentro do período, sem revogação e com plano ativo. |

---

## Participação no Marketplace

O predicado centralizador `marketplaceParticipationSql(tableAlias)` garante consistência estrita:

```sql
(
  -- Perfis legados continuam operando normalmente
  ${tableAlias}.management_mode = 'legacy_unmanaged'
  OR (
    -- Perfis gerenciados exigem identidade ativa E assinatura/entitlement ativo
    ${tableAlias}.management_mode = 'account_managed'
    AND ${eligibleManagedIdentitySql(tableAlias)}
    AND ${activeMarketplaceEntitlementSql(tableAlias)}
  )
)
```

### Pontos de Aplicação:
1. **Matching Inicial** (`matching.repository.ts`):
   - Avalia elegibilidade durante a busca e ranking de profissionais para novas solicitações.
   - O cálculo do ranking (`fair-v1`) permanece estritamente inalterado; apenas profissionais elegíveis entram na ordenação.
2. **Consultas de Matches Retomados** (`resumed-match-eligibility.ts`):
   - `listShown`: matches exibidos para o cliente só aparecem se o profissional mantiver participação válida.
   - `findShownByPosition`: revalida identidade e entitlement ativo.
   - `listNextUnshown`: profissionais com assinatura revogada ou expirada são saltados na paginação de novos candidatos.
   - `selectShownMatch`: ao selecionar um profissional, revalida participação ativa. Se a assinatura expirou ou a conta foi bloqueada, a seleção é rejeitada (`match_not_available`) sem criar contato, sem gerar snapshot bilateral e sem enfileirar outbound.
   - `Outbox Dispatcher`: não notifica profissionais que perderam participação ativa.

---

## Rotas Internas de Provisionamento (`/internal/professional-subscriptions`)

Todas as rotas exigem o cabeçalho `x-internal-key: INTERNAL_API_KEY`:

1. **`POST /internal/professional-subscriptions/:professionalId/grant`**
   - Cria uma nova assinatura para o perfil com o plano especificado (`plan_key`, padrão `'marketplace_standard_v1'`).
   - Define `starts_at`, `current_period_starts_at` e `current_period_ends_at` conforme a duração informada (`duration_days`).
   - Registra evento `'granted'` em auditoria.
   - Rejeita com `409 Conflict` se já houver assinatura ativa para o perfil.

2. **`POST /internal/professional-subscriptions/:professionalId/extend`**
   - Estende a data de término do período atual (`current_period_ends_at`).
   - Revalida se o novo término é posterior ao término atual.
   - Registra evento `'extended'`.

3. **`POST /internal/professional-subscriptions/:professionalId/revoke`**
   - Revoga imediatamente o acesso (`revoked_at = NOW()`, `status = 'canceled'`).
   - Idempotente: se já revogada, retorna o estado atual sem lançar erro.
   - Registra evento `'revoked'`.

4. **`POST /internal/professional-subscriptions/:professionalId/reactivate`**
   - Reativa uma assinatura expirada ou revogada, limpando `revoked_at` e definindo novo período.
   - Registra evento `'reactivated'`.

Todas as operações de mutação utilizam lock pessimista de linha (`SELECT ... FOR UPDATE`) sobre a assinatura e transações ACID.

---

## Consulta Self-Service e Dashboard Web

1. **API de Consulta**:
   - `GET /profiles/:professionalId/entitlement`: acessível por profissionais autenticados com membership ativa. Retorna `ProfessionalEntitlementSnapshot`.
   - `GET /dashboard`: agregado do painel inclui o campo `entitlement` dentro do payload `ready`.

2. **Interface do Painel (`SubscriptionCard`)**:
   - Exibe o status da assinatura de forma clara (Ativo, Expirado, Necessário, Isento para legados).
   - Informa datas de validade quando aplicáveis.
   - Se o perfil estiver publicado mas a assinatura estiver ausente ou expirada, exibe banner informativo claro.
   - Não exibe botões fictícios de checkout ou compra de planos.
