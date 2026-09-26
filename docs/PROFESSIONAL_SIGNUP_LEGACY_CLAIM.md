# Professional signup, legacy claim and activation readiness v1

## Visão geral

O PR #13 introduz o cadastro self-service unificado via OTP, a descoberta e reivindicação (claim) transacional de perfis legados desvinculados, e a guarda seletiva de matching entre perfis legados (`legacy_unmanaged`) e gerenciados (`account_managed`), mantendo zero ativação em produção (`PROFESSIONAL_AUTH_ENABLED=false` por padrão).

## Fluxo de cadastro e verificação (Signup)

1. **Entrada unificada**: a rota pública de solicitação de desafio (`/api/dashboard/access/challenge`) não distingue login de signup. Qualquer número de WhatsApp válido em formato E.164 pode solicitar um código de 6 dígitos.
2. **Criação provisional**: sob lock consultivo transacional por telefone (`pg_advisory_xact_lock`), se a conta ou o identificador não existirem, são criados atomicamente com status `active` para a conta e `verified_at = NULL` para o identificador.
3. **Idempotência e concorrência**: `ON CONFLICT (kind, normalized_value) DO NOTHING` e locks garantem que requisições concorrentes para o mesmo telefone nunca criem contas ou identificadores duplicados.
4. **Verificação de posse**: enquanto o código OTP não for validado, `verified_at` permanece `NULL`. Uma tentativa incorreta não verifica o telefone. Na validação correta do OTP, `verified_at` é atualizado para `COALESCE(verified_at, NOW())` e a sessão de 7 dias é emitida atomicamente.

## Descoberta e reivindicação de perfil legado (Claim)

1. **Perfis reivindicáveis (`legacy_unmanaged`)**:
   - `management_mode = 'legacy_unmanaged'`
   - `phone_e164` idêntico ao identificador de telefone verificado da conta autenticada
   - Nenhuma membership ativa (`status = 'active'`) associada ao perfil
2. **Listagem (`GET /claimable-profiles`)**:
   - Retorna a lista de perfis correspondentes ao telefone verificado da sessão atual, incluindo ID, nome de exibição, slug, telefone e data de criação.
3. **Reivindicação transacional (`POST /profiles/:professionalId/claim`)**:
   - Executa em transação serializada com `SELECT ... FOR UPDATE` no perfil e na conta.
   - Revalida se o perfil ainda é `legacy_unmanaged` e não possui memberships ativas por outra conta.
   - Atualiza `professionals.management_mode = 'account_managed'`.
   - Insere `professional_memberships` com papel `owner` e status `active`.
   - Registra evento de auditoria append-only em `professional_membership_events` com `source = 'legacy_claim'` e `actor_account_id` da conta autenticada.
   - Idempotente: se a mesma conta já reivindicou o perfil, retorna sucesso sem duplicar membership ou evento.
   - Rejeição estrita de conflito: se outra conta já possuir membership ativa, retorna `409 Conflict`.

## Guarda seletiva de matching (Selective Matching Guard)

O algoritmo de matching diferencia a elegibilidade conforme o `management_mode`:
- **`legacy_unmanaged`**: perfis históricos continuam elegíveis para matching pelo critério de status do perfil (`draft`/`active`) sem exigir membership de conta, preservando integralmente o comportamento do marketplace para perfis pré-existentes.
- **`account_managed`**: perfis criados por self-onboarding ou reivindicados por claim exigem obrigatoriamente:
  - Uma membership com status `active`
  - Uma conta associada com status `active`
  - Pelo menos um identificador de telefone com status `verified_at IS NOT NULL`
- Se a membership for revogada ou a conta for bloqueada (`status = 'blocked'`), o perfil `account_managed` é imediatamente excluído do matching.

## Migration 024 (`024_add_professional_management_mode`)

- Adiciona a coluna `management_mode TEXT NOT NULL DEFAULT 'legacy_unmanaged' CHECK (management_mode IN ('legacy_unmanaged', 'account_managed'))` à tabela `professionals`.
- Backfill seguro: perfis com eventos de membership de origem `'self_onboarding'` são atualizados para `'account_managed'`.
- Restrição de auditoria: expande `professional_membership_events.source` para aceitar `'legacy_claim'` exigindo `actor_account_id IS NOT NULL`.
- Rollback protegido: aborta com `P0024 / PROFESSIONAL_MANAGEMENT_MODE_ROLLBACK_BLOCKED` se houver qualquer perfil `account_managed` ou evento `legacy_claim`.
- Rollback compatível: remove a coluna e reverte a restrição de auditoria quando não existirem dados gerenciados.

## Interface web e BFF

- O formulário de acesso em `/dashboard/access` usa textos unificados: "Entrar ou criar conta", "Informe seu WhatsApp para continuar", "Continuar com WhatsApp".
- No `/dashboard`, contas autenticadas com perfis reivindicáveis visualizam o card "Encontramos perfil existente" com os dados do perfil e o botão "Este perfil é meu".
- A reivindicação é processada pelo BFF em `POST /api/dashboard/claim` com proteção `Same-Origin` estrita e define automaticamente o cookie de seleção do perfil.
