# ADR-003: Congelamento Formal de Gateways de Pagamento e Cobrança

* **Status:** ACCEPTED
* **Data:** 2026-09-27
* **Decisores:** Liderança Executiva e Arquitetura ContatoCerto

---

## Contexto

A monetização do ContatoCerto é baseada em assinaturas recorrentes pagas pelos profissionais prestadores de serviços, garantindo gratuidade total aos clientes e eliminando o modelo predatório de cobrança por lead avulso.

No entanto, a escolha de um intermediador financeiro específico (ex.: Stripe, Mercado Pago, Asaas, Pagar.me, etc.) envolve decisões fiscais, bancárias, regulatórias, taxas percentuais e complexidade de integração com Pix e boletos que poderiam atrasar a consolidação do produto principal.

No PR #14, o domínio de assinaturas e direitos de acesso (*entitlements*) foi modelado com sucesso de forma puramente agnóstica (`subscription_plans`, `professional_subscriptions`), provendo garantias de concorrência e controle de acesso a novas oportunidades.

## Decisão

1. **Congelamento Estrito de Gateways de Pagamento:** Está formalmente congelada qualquer atividade de desenvolvimento, prototipação ou integração com provedores de pagamento no repositório.
2. **Vedação de Artefatos Financeiros:** Fica expressamente proibida a criação de código, rotas, abstractions, mocks ou tabelas destinadas a:
   * Checkout web ou mobile;
   * Geração de QR Code Pix de cobrança ou processamento de cartões de crédito/débito;
   * Webhooks de notificação de faturas, chargebacks ou inadimplência bancária;
   * Mecânicas promocionais de cupons, testes gratuitos (*trials*) ou descontos monetários vinculados a gateways;
   * Programas de afiliados ou premiações por indicação com repasse financeiro direto.
3. **Operação Temporária Agnóstica:** As assinaturas continuarão sendo gerenciadas em nível de domínio e atribuídas de forma manual ou administrativa no banco de dados enquanto o congelamento estiver ativo.

## Consequências

* **Positivas:**
  * Mantém o foco absoluto da equipe de engenharia na experiência do usuário, liquidez do marketplace, precisão geográfica e estabilidade da mensageria no WhatsApp.
  * Evita acoplamento precoce a um provedor financeiro antes da definição do modelo societário e tributário definitivo da operação.
  * O domínio de *entitlements* já entregue garante que o sistema está pronto para plugar qualquer gateway no futuro sem refatorar a lógica de entrega de leads.
* **Negativas / Compromissos:**
  * O processo de onboarding comercial e ativação de planos pagos de profissionais requer intervenção operacional/manual até que a integração financeira seja descongelada.
