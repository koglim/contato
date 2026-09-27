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
   - Perfis `legacy_unmanaged` mantêm isenção total de assinatura e conta (`state = 'legacy_exempt'`, `has_marketplace_access = true`, `reasons = []`, `subscription_required = false`).
   - Nenhum perfil histórico existente perde elegibilidade de matching ou exige assinatura antes de reivindicação explícita.

3. **Guarda Centralizada de Marketplace**:
   - Perfis gerenciados (`account_managed`) exigem cumulativamente:
     - Identidade ativa e verificada (`eligibleManagedIdentitySql`: conta ativa, membership ativa e pelo menos um `account_identifier` verificado).
     - Direito ativo de marketplace (`activeMarketplaceEntitlementSql`: plano ativo com entitlement `marketplace_access`, período vigente no relógio do banco, sem revogação).
   - A guarda `marketplaceParticipationSql(tableAlias)` unifica esse predicado SQL em todos os pontos do sistema.

4. **Identidade Gerenciada Elegível (`eligibleManagedIdentitySql`)**:
   - Exige que o profissional possua `professional_memberships.status = 'active'`, `accounts.status = 'active'` e pelo menos um `account_identifiers.verified_at IS NOT NULL`.
   - Não restringe o identificador especificamente a telefone (ao contrário do claim legado) nem restringe a roles específicas de owner/admin.

5. **Invariante de Contatos Entregues**:
   - O Outbox Dispatcher não revalida assinatura para mensagens de contatos já gerados: a garantia ocorre no `selectShownMatch`, que revalida participação sob lock de linha `professionals.id FOR UPDATE`.
   - Uma vez que o contato e as mensagens de outbox nascem legitimamente (`status = 'requested'`), o lead é considerado entregue.
   - O profissional pode responder ao contato (`aceito <codigo>` / `recuso <codigo>`) mesmo que sua assinatura venha a expirar ou ser revogada posteriormente.

---

## Modelo de Dados (Migration 025)

A migration `database/migrations/025_add_professional_subscriptions.js` adiciona 4 tabelas:

### 1. `subscription_plans`
Catálogo de planos disponíveis:
- `id` (UUID PRIMARY KEY DEFAULT gen_random_uuid())
- `code` (TEXT NOT NULL UNIQUE, ex.: `'marketplace_standard_v1'`)
- `name` (TEXT NOT NULL)
- `is_active` (BOOLEAN NOT NULL DEFAULT TRUE)
- `created_at` (TIMESTAMPTZ NOT NULL DEFAULT NOW())
- `updated_at` (TIMESTAMPTZ NOT NULL DEFAULT NOW())

### 2. `subscription_plan_entitlements`
Direitos/recursos concedidos por plano:
- `plan_id` (UUID NOT NULL REFERENCES subscription_plans(id) ON DELETE RESTRICT)
- `entitlement_key` (TEXT NOT NULL CHECK (entitlement_key IN ('marketplace_access')))
- `created_at` (TIMESTAMPTZ NOT NULL DEFAULT NOW())
- PRIMARY KEY `(plan_id, entitlement_key)`

### 3. `professional_subscriptions`
Assinatura vinculada ao perfil profissional (relação 1:1 estrita):
- `id` (UUID PRIMARY KEY DEFAULT gen_random_uuid())
- `professional_id` (UUID NOT NULL UNIQUE REFERENCES professionals(id) ON DELETE RESTRICT)
- `plan_id` (UUID NOT NULL REFERENCES subscription_plans(id) ON DELETE RESTRICT)
- `starts_at` (TIMESTAMPTZ NOT NULL)
- `ends_at` (TIMESTAMPTZ NOT NULL)
- `revoked_at` (TIMESTAMPTZ NULL)
- `created_at` (TIMESTAMPTZ NOT NULL DEFAULT NOW())
- `updated_at` (TIMESTAMPTZ NOT NULL DEFAULT NOW())
- CONSTRAINT `check_subscription_period` CHECK (`ends_at > starts_at`)

### 4. `professional_subscription_events`
Log append-only imutável de transições de assinatura:
- `id` (UUID PRIMARY KEY DEFAULT gen_random_uuid())
- `subscription_id` (UUID NOT NULL REFERENCES professional_subscriptions(id) ON DELETE RESTRICT)
- `professional_id` (UUID NOT NULL REFERENCES professionals(id) ON DELETE RESTRICT)
- `action` (TEXT NOT NULL CHECK (action IN ('granted', 'extended', 'revoked', 'reactivated')))
- `source` (TEXT NOT NULL CHECK (source IN ('internal_provisioning')))
- `previous_starts_at` (TIMESTAMPTZ NULL)
- `new_starts_at` (TIMESTAMPTZ NULL)
- `previous_ends_at` (TIMESTAMPTZ NULL)
- `new_ends_at` (TIMESTAMPTZ NULL)
- `created_at` (TIMESTAMPTZ NOT NULL DEFAULT NOW())
- Protegido por trigger `protect_professional_subscription_events()` que impede `UPDATE`, `DELETE` ou `TRUNCATE`, disparando exceção `PROFESSIONAL_SUBSCRIPTION_EVENT_IMMUTABLE` com ERRCODE `P0025`.

### Rollback Protegido
A migration 025 implementa proteção de rollback com código `P0025`: se houver qualquer linha em `professional_subscriptions` ou `professional_subscription_events`, o rollback aborta com erro `PROFESSIONAL_SUBSCRIPTION_ROLLBACK_BLOCKED`. Em banco com apenas dados compatíveis/seed, o rollback reverte tabelas, índices e funções cleanly.

---

## Motor de Entitlements (7 Estados)

O cálculo do snapshot de direitos (`ProfessionalEntitlementSnapshot`) avalia deterministamente utilizando o relógio do PostgreSQL (`NOW() AS db_now`):

| Estado (`state`) | `has_marketplace_access` | `reasons` | Condição |
| :--- | :---: | :--- | :--- |
| `legacy_exempt` | `true` | `[]` | Perfil possui `management_mode = 'legacy_unmanaged'`. |
| `none` | `false` | `["subscription_required"]` | Perfil `account_managed` sem registro em `professional_subscriptions`. |
| `plan_inactive` | `false` | `["subscription_plan_inactive"]` | Plano associado está com `is_active = FALSE` ou sem `marketplace_access`. |
| `revoked` | `false` | `["subscription_revoked"]` | Assinatura possui `revoked_at IS NOT NULL`. |
| `not_started` | `false` | `["subscription_not_started"]` | Assinatura possui `starts_at > db_now`. |
| `expired` | `false` | `["subscription_expired"]` | Período expirou (`ends_at <= db_now`). |
| `active` | `true` | `[]` | Assinatura ativa, dentro do período, sem revogação e com plano ativo. |

Campos do Snapshot (`ProfessionalEntitlementSnapshot`):
- `policy_version`: `"entitlement-v1"`
- `professional_id`: UUID
- `management_mode`: `"legacy_unmanaged" | "account_managed"`
- `subscription_required`: boolean
- `state`: `ProfessionalEntitlementState`
- `plan_code`: string | null
- `starts_at`: string (ISO 8601) | null
- `ends_at`: string (ISO 8601) | null
- `has_marketplace_access`: boolean
- `reasons`: `ProfessionalEntitlementReason[]`

---

## Participação no Marketplace

O predicado centralizador `marketplaceParticipationSql(tableAlias)` garante consistência estrita:

```sql
(
  ${tableAlias}.management_mode = 'legacy_unmanaged'
  OR (
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
   - `selectShownMatch`: ao selecionar um profissional, executa busca estrutural do candidato, adquire lock pessimista `SELECT id FROM professionals WHERE id = $1 FOR UPDATE` como linha de autoridade, e reavalia a elegibilidade fresca (`resumedMatchEligibilitySql`) com `FOR UPDATE OF matches`. Se a assinatura tiver sido revogada ou expirado, a seleção é rejeitada (`match_not_available`) com 0 contatos, 0 outbox e sem marcar `selected_at`.

---

## Rotas Internas de Provisionamento (`/internal/professional-subscriptions`)

Todas as rotas exigem o cabeçalho `x-internal-key: INTERNAL_API_KEY`:

1. **`GET /internal/professional-subscriptions/:professionalId`**
   - Retorna o snapshot atual de direitos (`ProfessionalEntitlementSnapshot`).

2. **`POST /internal/professional-subscriptions/:professionalId/grant`**
   - Input: `{ plan_code: string, starts_at: ISOString, ends_at: ISOString }`.
   - Semântica create-only: cria assinatura para o perfil. Se o perfil já possuir assinatura (ativa ou revogada), retorna `409 subscription_already_exists`. Trata violação única do PG (`23505`) concorrente com `409 subscription_already_exists`.
   - Registra evento `'granted'`.

3. **`POST /internal/professional-subscriptions/:professionalId/extend`**
   - Input: `{ ends_at: ISOString }`.
   - Estende a data de término (`ends_at`). Revalida se o novo término é posterior ao término atual (senão `400 invalid_extension_period`).
   - Registra evento `'extended'`.

4. **`POST /internal/professional-subscriptions/:professionalId/revoke`**
   - Input: corpo estritamente vazio (`undefined` ou `{}`). Rejeita payloads com chaves ou `null` com `400 invalid_request`.
   - Revoga imediatamente o acesso (`revoked_at = NOW()`). Idempotente: se já revogada, retorna snapshot sem duplicar evento.
   - Registra evento `'revoked'`.

5. **`POST /internal/professional-subscriptions/:professionalId/reactivate`**
   - Input: `{ starts_at: ISOString, ends_at: ISOString, plan_code?: string }`.
   - Regra semântica: só é permitida em assinaturas revogadas (`revoked_at IS NOT NULL`) ou expiradas (`ends_at <= NOW()`). Se a assinatura estiver ativa, rejeita com `409 subscription_not_reactivatable` sem gerar eventos.
   - Validação do plano: o plano alvo deve estar ativo (`is_active = TRUE`). Se `plan_code` for omitido, o plano atual deve permanecer ativo, senão retorna `409 plan_inactive`.
   - Limpa `revoked_at = NULL` e atualiza datas e plano.
   - Registra evento `'reactivated'`.

---

## Consulta Self-Service e Dashboard Web

1. **APIs Internas de Autenticação / Perfil**:
   - `GET /internal/professional-auth/profiles/:professionalId/entitlement`: acessível com chave interna e sessão autenticada. Retorna `ProfessionalEntitlementSnapshot`.
   - `GET /internal/professional-auth/profiles/:professionalId/dashboard`: agregado do painel inclui o campo `entitlement` dentro do payload `ready`.

2. **Interface do Painel (`SubscriptionCard`)**:
   - Exibe o status da assinatura de forma clara (Ativo, Expirado, Necessário, Isento para legados).
   - Informa datas de validade quando aplicáveis.
   - Se o perfil estiver publicado mas a assinatura estiver ausente ou expirada, exibe banner informativo claro.
   - Não exibe botões fictícios de checkout ou compra de planos.
