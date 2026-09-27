# V1 — jornada e critérios

A V1 deverá completar o fluxo abaixo:

cliente solicita serviço
→ sistema entende a necessidade
→ identifica localização
→ encontra profissionais
→ apresenta opções
→ cliente escolhe profissional
→ contato é registrado
→ posteriormente é possível avaliar

Busca, ranking, opções, seleção e contato bilateral já existem e possuem testes.
Aceite/recusa e retomada também estão implementados. Identidade individual e
onboarding (PRs #10–#13), assinatura profissional & entitlements v1 (PR #14) e
conclusão bilateral de atendimento (PR #15) já foram entregues. Avaliação e
reputação (PR #16) e homologação final da comunicação continuam como próximas etapas;
gateways de cobrança permanecem explicitamente congelados.

Preservar pool 20, páginas de 3 e teto de 6; cliente gratuito e assinatura do
profissional, sem cobrança por lead. A conversa contextual híbrida faz parte da
V1, assim como o painel e a operação de entrega confiável.

Os critérios de piloto e lançamento e a matriz de aceite estão em
[V1_EXECUTION.md](V1_EXECUTION.md). CI verde não substitui homologação de WhatsApp,
cobrança, suporte ou revisão humana das políticas.
