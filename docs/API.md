# API interna

Checklist cumulativo de compatibilidade, migrations 017–020 e variáveis:
[CUMULATIVE_REVIEW.md](CUMULATIVE_REVIEW.md). A ordem de atualização é banco antes
da API; B2 permanece desligada e os cinco exports n8n permanecem inativos.

## Diagnóstico de entrega

`GET /internal/channel/outbound/queue-status` exige `X-Internal-Key`, é somente
leitura e retorna 200 com `{ items: [...] }` e `Cache-Control: no-store`. Fila sem
pendências retorna `items: []`. Cada item contém uma finalidade e somente:
`pending`, `scheduled_retry`, `processing`, `expired_lease`,
`reconciliation_required`, `failed`, `dead_letter`, `oldest_unfinished_at`.
Finalidades sem mensagens não enviadas são omitidas. Não retorna telefone,
conteúdo, IDs de mensagem, tokens ou erros livres do provider.

Os contadores se sobrepõem: retry agendado está em pending; retenção está em
processing; dead-letter está em failed. Lease expirada exclui retenções e usa a
mesma duração configurada do consumidor. A leitura não reclama nem terminaliza
mensagens. Pending não significa imediatamente enviável: agenda e ordem por
destinatário ainda são verificadas pelo claim. Registros sent ficam fora do
agregado; o timestamp mais antigo inclui falhas terminais para operação.

## Limite de autosserviço do painel

O BFF `PATCH /api/dashboard` autentica a sessão demonstrativa e valida método,
ação, UUIDs e payload antes de usar a chave interna. Para `action=profile`, aceita
somente `display_name`, `email`, `bio` e `profile_image_url`. Campos administrativos
(`status`, `is_verified`), telefone e ownership são rejeitados, não ignorados.
Status/telefone são somente leitura na interface; a futura troca de telefone
depende de verificação de identidade. O contrato administrativo `/internal`
permanece restrito à chave interna, sem alteração neste checkpoint.

Serviços e áreas preservam os contratos existentes; UUIDs não podem alterar o
caminho da API. O profissional vem da configuração **servidora** atual, nunca do
corpo do navegador. Isso fecha F02, mas não implementa contas individuais (F03):
o acesso por senha demonstrativa não deve ser oferecido como painel multiusuário.
O BFF aceita somente JSON, retorna 401 sem sessão e 400 para mutações inválidas.

Os exports do consumidor ficam em [workflows/n8n](../workflows/n8n/README.md),
inativos e sem credenciais. Inbox/claim por ID continuam sendo o caminho imediato;
o dispatcher chama `next/claim` e usa o mesmo subworkflow de entrega. Homologação
da versão instalada e autenticidade do gateway permanecem pendentes.

## Confirmação e reconciliação Outbox (017)

`POST /internal/channel/outbound/:id/sent` aceita repetição idêntica com o token
original e o mesmo `provider_message_id`, sem alterar timestamps. ID/token
conflitantes continuam retornando 409. Recibos legados não são inventados.

Novo `POST /internal/channel/outbound/:id/hold`, protegido por `X-Internal-Key`:
`{ "processing_token": "<uuid>", "reason": "transport_outcome_unknown" }`.
Também aceita `confirmation_pending`. Retorna 200 com
`{ "id": "<uuid>", "status": "processing", "delivery_status": "reconciliation_required" }`.
Uma retenção impede reclaim e `/failed`; o token original ainda pode confirmar
`/sent` quando houver prova de aceitação. Corpo inválido: 400; sem chave: 401;
ID ausente: 404; token inválido: 409. Nenhum payload privado na resposta.

Contrato completo, limites e operação: [OUTBOUND_DELIVERY.md](OUTBOUND_DELIVERY.md).

## Contato bilateral — contrato atual

Esta seção atualiza a jornada Inbox/Outbox descrita nas etapas históricas abaixo. Endpoints e consumidor por `outbound.id` permanecem compatíveis; nenhuma variável de ambiente nova ou alteração n8n foi introduzida. Aplicar a migration 014 antes de executar esta versão da API.

Novas apresentações, inclusive “mostrar mais”, incluem o aviso versionado `bilateral-v1`: “Ao escolher, vocês receberão o telefone um do outro somente para combinar o atendimento solicitado.” Nenhum telefone é exibido antes da escolha autorizada. Somente a apresentação confirmada como enviada pode fundamentar o consentimento pela escolha.

O resultado discriminado `route: selection` aceita dois novos estados estritos:

```json
{ "kind": "consent_required", "professional_name": "Ana Eletricista" }
```

```json
{ "kind": "consent_declined" }
```

São usados para apresentações legadas sem aviso auditável. A confirmação pede compartilhamento bilateral e aceita afirmações completas como “sim”, “pode”, “quero”, “confirmo” e “pode compartilhar”; perguntas e hipóteses não autorizam. “não”/“não quero” recusam e voltam às opções sem compartilhar telefone. Os comandos globais continuam prioritários. O prompt precisa ter sido confirmado como enviado antes do inbound de confirmação. A pendência é persistida e respeita o TTL da conversa.

Em contatos novos, `selected` adiciona `public_code` opcional para compatibilidade com resultados históricos:

```json
{
  "kind": "selected",
  "professional_name": "Ana Eletricista",
  "service_name": "Eletricista",
  "professional_phone_e164": "+5566988888888",
  "public_code": "CC-7K4P9Q2M"
}
```

Não expõe `contactId`, `matchId`, `professionalId`, `replayed` ou telefone do cliente nesse contrato. O contato, consentimento, snapshot e as intenções de resposta ao cliente e notificação profissional são confirmados na mesma transação. Se a Inbox cair antes de `processed`, recupera pelo UUID do inbound e reutiliza a resposta existente. Replay utiliza o texto persistido da Outbox, mesmo depois de edição de perfil ou evolução do presenter.

A segunda intenção tem `purpose: professional_contact_notification`, sem inbound e com chave interna única por contato. Contém somente código público, serviço, cidade/UF disponíveis, bairro quando explicitamente informado, resumo sanitizado, telefone do cliente e orientação para combinar atendimento. Não inclui aceite/recusa profissional. O dispatcher `/internal/channel/outbound/next/claim` já pode reservá-la; nenhum envio externo ou consumidor n8n novo foi implementado nesta rodada. A resposta da Inbox continua apontando exclusivamente à mensagem destinada ao cliente.

**Operação de banco:** o down 014 é protegido. Dados incompatíveis (consentimento, snapshots, chaves, avisos ou notificações independentes) bloqueiam a tentativa com `BILATERAL_ROLLBACK_BLOCKED`, sem alterações de schema/dados/envios. Não forçar removendo registros. Corrigir evolutivamente ou restaurar backup integral verificado. Sem esses dados, o CI executa rollback 014 → 008 e reaplicação completos.

## Proteção temporária

As rotas administrativas usam a variável de ambiente `INTERNAL_API_KEY`. Envie o valor configurado no header abaixo:

```http
X-Internal-Key: <INTERNAL_API_KEY>
```

Essa é uma proteção temporária para administração, testes e integrações internas. Ela **não** é a autenticação final dos profissionais. Se a variável estiver ausente, a chave for inválida ou o header não for enviado, a API responde `401` com `{"error":"unauthorized"}`. Os health checks permanecem públicos.

## Profissionais

Todas as rotas abaixo são internas e exigem `X-Internal-Key`.

### `POST /internal/professionals`

Cria um profissional em status `draft`.

```json
{
  "display_name": "João Elétrica",
  "phone_e164": "+5565999999999",
  "email": "joao@example.com",
  "bio": "Eletricista residencial e comercial.",
  "profile_image_url": "https://example.com/joao.jpg"
}
```

`display_name` e `phone_e164` são obrigatórios. Telefone deve estar no formato E.164. O slug é gerado pela API; nomes repetidos recebem sufixos numéricos, como `joao-eletrica-2`.

Retorna `201` com o profissional criado. Campos administrativos e timestamps não são aceitos na entrada.

### `GET /internal/professionals`

Lista profissionais por `created_at DESC`.

Query parameters opcionais:

- `limit`: de 1 a 100; padrão `20`.
- `offset`: padrão `0`.
- `status`: `draft`, `active` ou `suspended`.
- `q`: busca por nome, email, telefone ou slug.

Resposta:

```json
{
  "items": [],
  "pagination": { "total": 0, "limit": 20, "offset": 0 }
}
```

### `GET /internal/professionals/:id`

Retorna um profissional pelo UUID. Quando não existe, retorna `404` com:

```json
{ "error": "professional_not_found" }
```

### `PATCH /internal/professionals/:id`

Permite atualizar `display_name`, `phone_e164`, `email`, `bio`, `profile_image_url` e `status`. Os campos opcionais `email`, `bio` e `profile_image_url` aceitam `null` para remoção.

O slug permanece estável quando `display_name` muda. A API não aceita alterações de `id`, `slug`, verificações, disponibilidade ou timestamps.

### `PATCH /internal/professionals/:professionalId/availability`

Confirma a disponibilidade imediata de um profissional. Aceita exclusivamente um booleano real:

```json
{ "is_available_now": true }
```

Retorna uma resposta específica da operação:

```json
{
  "professional_id": "UUID",
  "is_available_now": true,
  "available_now_updated_at": "2026-08-30T12:00:00.000Z"
}
```

Somente profissionais com status `active` podem definir `is_available_now` como `true`; caso contrário, retorna `409 professional_not_active`. Definir `false` é permitido para qualquer status. Em ambas as operações, inclusive quando o valor já é igual ao solicitado, `available_now_updated_at` é atualizado por `NOW()` no PostgreSQL. Esse campo registra a última confirmação de disponibilidade; ainda não há expiração automática, e a política de freshness será definida pelo futuro matching.

Quando um profissional passa para `draft` ou `suspended`, a API desliga automaticamente a disponibilidade se ela estava ligada e registra o horário no banco.

## Catálogo de serviços

### `GET /internal/catalog/services`

Retorna os serviços ativos do catálogo, já acompanhados de sua categoria. Aceita os filtros opcionais `q` (nome ou slug) e `category_id` (UUID). A ordenação é alfabética por categoria e depois por serviço.

```json
{
  "items": [
    {
      "id": "UUID",
      "name": "Eletricista",
      "slug": "eletricista",
      "description": null,
      "is_active": true,
      "category": { "id": "UUID", "name": "Casa e Manutenção", "slug": "casa-e-manutencao" }
    }
  ]
}
```

## Serviços oferecidos pelo profissional

As rotas abaixo são internas e exigem `X-Internal-Key`. Valores monetários são sempre inteiros em centavos — por exemplo, `15000` representa R$ 150,00. Nunca envie valores em ponto flutuante.

### `GET /internal/professionals/:professionalId/services`

Lista todos os vínculos do profissional, inclusive os inativos. Retorna `404` com `professional_not_found` quando o profissional não existe; para um profissional sem serviços retorna `{"items":[]}`.

Cada item inclui a configuração do vínculo, serviço, categoria e timestamps ISO.

### `POST /internal/professionals/:professionalId/services`

Vincula um serviço do catálogo a um profissional. O vínculo nasce ativo e inclui `service_id`, `price_mode` e, opcionalmente, `description` de até 2.000 caracteres.

Quatro modos de preço são aceitos:

```json
{ "service_id": "UUID", "price_mode": "quote" }
```

`quote` não aceita preços.

```json
{ "service_id": "UUID", "price_mode": "fixed", "price_from_cents": 12000 }
```

`fixed` exige `price_from_cents` e não aceita `price_to_cents`.

```json
{ "service_id": "UUID", "price_mode": "from", "price_from_cents": 15000 }
```

`from` exige `price_from_cents` e não aceita `price_to_cents`.

```json
{
  "service_id": "UUID",
  "description": "Instalação e manutenção elétrica.",
  "price_mode": "range",
  "price_from_cents": 10000,
  "price_to_cents": 30000
}
```

`range` exige ambos os valores, e o máximo deve ser maior ou igual ao mínimo. Todos os valores são inteiros maiores ou iguais a zero.

Uma associação ativa já existente retorna `409 professional_service_already_exists`. Caso a associação exista, mas esteja inativa, o mesmo `POST` atualiza a configuração, reativa o registro existente e retorna `200`; um vínculo novo retorna `201`.

### `PATCH /internal/professionals/:professionalId/services/:professionalServiceId`

Permite atualizar apenas `description`, `price_mode`, `price_from_cents`, `price_to_cents` e `is_active`. O corpo não pode ser vazio. A API valida o estado final do preço antes de persistir; ao mudar para `quote`, os dois preços são automaticamente limpos. Para mudar de `quote` para `fixed`, `from` ou `range`, envie os valores exigidos pelo novo modo.

Use `{ "is_active": false }` para desativar sem apagar histórico. Uma reativação só é permitida se o serviço correspondente no catálogo continuar ativo.

## Áreas de atendimento

As áreas de atendimento usam PostGIS e coordenadas já conhecidas; geocoding será uma etapa futura. O banco armazena o centro como `GEOGRAPHY(Point, 4326)` e o raio sempre em metros.

### `GET /internal/professionals/:professionalId/service-areas`

Lista as áreas do profissional, com a primária primeiro e as demais por ordem de criação. Retorna `404 professional_not_found` se o profissional não existir.

### `POST /internal/professionals/:professionalId/service-areas`

Cria uma área. São obrigatórios `city`, `state`, `country_code`, `latitude`, `longitude` e `radius_meters`; `label`, `neighborhood` e `is_primary` são opcionais. `country_code` é normalizado para letras maiúsculas e `is_primary` inicia como `false` quando ausente.

```json
{
  "label": "Sinop e região",
  "city": "Sinop",
  "state": "MT",
  "country_code": "BR",
  "neighborhood": null,
  "latitude": -11.8608,
  "longitude": -55.5091,
  "radius_meters": 30000,
  "is_primary": true
}
```

Latitude deve estar entre `-90` e `90`; longitude entre `-180` e `180`. O raio deve ser um inteiro entre `1` e `200000` (200 km). Ao criar uma área primária, a API desmarca qualquer primária anterior em uma única transação.

### `PATCH /internal/professionals/:professionalId/service-areas/:areaId`

Atualização parcial de `label`, `city`, `state`, `country_code`, `neighborhood`, `latitude`, `longitude`, `radius_meters` e `is_primary`. Se apenas uma coordenada for enviada, a outra é preservada. `is_primary: true` transfere a primariedade; `false` pode deixar o profissional sem área primária. Área ausente ou pertencente a outro profissional retorna `404 service_area_not_found`.

### `DELETE /internal/professionals/:professionalId/service-areas/:areaId`

Remove fisicamente uma área operacional e retorna `204`. Não promove outra área automaticamente. Área inexistente ou de outro profissional retorna `404 service_area_not_found`.

## Matching determinístico

### `POST /internal/matching/search`

Rota interna protegida por `X-Internal-Key` para executar o matching quando o serviço e as coordenadas do pedido já foram resolvidos por uma etapa externa. Ela não interpreta texto, não faz geocoding e não é uma API pública de busca.

```json
{
  "raw_text": "Preciso de um eletricista perto de casa.",
  "service_id": "UUID",
  "latitude": -11.8608,
  "longitude": -55.5091,
  "city": "Sinop",
  "state": "MT",
  "neighborhood": null,
  "limit": 3
}
```

`raw_text`, `service_id`, `latitude` e `longitude` são obrigatórios. O texto aceita até 2.000 caracteres; latitude e longitude precisam estar nas faixas geográficas válidas. Os metadados de localização são opcionais e `limit` é opcional, com padrão `3` e intervalo aceito de `1` a `10`. Por política de apresentação, a resposta limita a página a `min(limit, 3)` e informa esse valor em `meta.limit`; valores 1 e 2 continuam funcionando. O matching persiste até 20 candidatos independentemente de `limit`, sem expor o pool completo na resposta. Esta é uma limitação intencional de quantidade para clientes legados que pediam 4–10 resultados, sem mudança de formato.

No canal, “mostrar mais” usa a mesma busca e apresenta no máximo seis profissionais ao todo. Uma página pendente retorna `409 selection_show_more_pending`, sem outra Outbox; pode ser tentada novamente após envio. Ao esgotar as posições apresentáveis, retorna seleção `no_more_options`, mesmo que o pool auditável contenha mais candidatos. Mensagens de um único dígito são aceitas pela Inbox e pelo Customer Search; executar seleção ainda exige chave idempotente interna.

Em uma única transação, a API valida que o serviço existe e está ativo, registra um `search_request` com o ponto PostGIS, identifica os profissionais elegíveis e persiste um `match` para cada resultado. Um profissional só entra se estiver ativo, oferecer o serviço de forma ativa e possuir uma área ativa cujo raio contenha o ponto consultado. Quando possui várias áreas elegíveis, somente a mais próxima é considerada.

O campo `effective_available_now` é verdadeiro apenas quando a disponibilidade está ligada e foi confirmada nos últimos 240 minutos. A disponibilidade não elimina candidatos. O ranking `fair-v1` compara disponibilidade, banda de distância de 2 km, verificação, banda de reputação bayesiana e menor carga de exposição/contatos/repetição; reputação exata, distância e UUID desempatarão. A política e os sinais são preservados internamente em `score_breakdown`, sem expansão do contrato de resposta. A resposta não expõe telefone ou e-mail. As regras completas e limites de elegibilidade atuais estão em `ARCHITECTURE.md`.

Se não houver candidatos, a resposta ainda é `200`, com `matches: []` e `status: "ready"`. Com candidatos, o status é `"matched"`.

Erros específicos:

- `404 service_not_found` para serviço inexistente.
- `409 service_inactive` para serviço desativado.

## Resolução determinística de serviço

### `POST /internal/service-resolution/resolve`

Rota interna protegida por `X-Internal-Key` que transforma somente o texto em um serviço do catálogo. Ela precede o matching: não recebe localização, não consulta profissionais e não executa o algoritmo geográfico.

```json
{ "text": "Preciso de um eletricista em Sinop" }
```

`text` é obrigatório, não pode ser vazio e aceita até 2.000 caracteres. A normalização remove acentos e pontuação, converte para minúsculas e compacta espaços. A resolução considera exclusivamente serviços ativos, usando nome, slug e aliases do catálogo.

As tentativas ocorrem nesta ordem:

1. `exact`: texto inteiro igual a um nome, slug ou alias normalizado.
2. `phrase`: termo inteiro dentro do texto, com fronteiras de tokens — nunca substring parcial de outra palavra.
3. `fuzzy`: somente após as duas anteriores, por `pg_trgm`, comparando termos com pelo menos cinco caracteres.

Por padrão, o fuzzy exige similaridade mínima de `0.53` e retorna `ambiguous` quando os dois primeiros candidatos diferem em até `0.10`. Esses parâmetros podem ser calibrados, sem segredos, pelas variáveis `SERVICE_RESOLUTION_FUZZY_THRESHOLD` e `SERVICE_RESOLUTION_FUZZY_AMBIGUITY_GAP`; ambas aceitam apenas números entre `0` e `1`. Resultados exact e phrase têm confiança `1`; os fuzzy retornam a similaridade do PostgreSQL. Ausência de confiança suficiente retorna `200` com `status: "unresolved"`, e nunca um palpite arbitrário.

Exemplo resolvido:

```json
{
  "status": "resolved",
  "normalized_text": "preciso de um eletricista em sinop",
  "match": {
    "service": { "id": "UUID", "name": "Eletricista", "slug": "eletricista" },
    "method": "phrase",
    "matched_term": "eletricista",
    "confidence": 1
  },
  "candidates": []
}
```

Se mais de um serviço for igualmente relevante, o retorno é `ambiguous`, sem `match`, e contém até três candidatos. A resposta nunca contém dados de profissionais ou contatos.

O seed inicial agora inclui aliases de alta precisão para eletricista, encanador, ar-condicionado, montador de móveis, diarista, pintor e chaveiro. Eles são inseridos de forma idempotente por `pnpm db:seed`; esse comando continua sendo manual e não é disparado pela API ou por deploy.

## Resolução de localização

### `POST /internal/location-resolution/resolve`

Rota interna protegida por `X-Internal-Key` que converte uma **consulta de localização já isolada** em coordenadas estruturadas. Não extrai localização de uma frase completa, não consulta profissionais e não chama o matching.

```json
{ "query": "Sinop, MT", "country_code": "BR", "limit": 5 }
```

`query` aceita de 2 a 500 caracteres e preserva texto útil para endereços (acentos, vírgulas, hífens e números); apenas espaços nas extremidades ou repetidos são normalizados. `country_code` é ISO alpha-2, normalizado para maiúsculas e padrão `BR`; `limit` tem padrão `5` e máximo `10`.

O provider inicial é o geocoder do ecossistema openrouteservice/HeiGIT, acessado apenas no servidor pelo endpoint padrão `https://api.heigit.org/pelias/v1/search`. A chave `OPENROUTESERVICE_API_KEY` é enviada no header `Authorization`, nunca na URL ou na resposta. A busca usa `boundary.country` para restringir o país e tem timeout de 5 segundos.

O payload GeoJSON é mapeado defensivamente: `coordinates[0]` é longitude e `coordinates[1]` é latitude. A API retorna somente label, coordenadas, cidade/estado/bairro quando presentes, confiança e layer — nunca o payload, headers ou quota do provider.

O resultado é `resolved` quando a confiança do primeiro candidato alcança `LOCATION_RESOLUTION_CONFIDENCE_THRESHOLD` (padrão `0.85`) e não há segundo candidato dentro de `LOCATION_RESOLUTION_AMBIGUITY_GAP` (padrão `0.10`). É `ambiguous` quando há competidor próximo e `unresolved` quando não há resultado confiável. Ambos os parâmetros aceitam apenas números de `0` a `1`.

Erros técnicos do provider são distintos de `unresolved`:

- `503 geocoding_unavailable`: timeout, falha de rede ou configuração indisponível.
- `429 geocoding_rate_limited`: limite do upstream.
- `502 geocoding_provider_error`: resposta inesperada, 5xx ou payload inválido.

Coordenadas GPS já conhecidas futuramente poderão ir diretamente ao matching; o geocoder existe apenas para localização textual.

## Orquestração de busca

### `POST /internal/search/orchestrate`

Rota interna protegida por `X-Internal-Key` que coordena os módulos determinísticos existentes sem chamar a própria API via HTTP. Ela recebe os textos já separados; não extrai serviço ou localização de `raw_text`.

```json
{
  "raw_text": "Preciso de um eletricista em Sinop",
  "service_text": "eletricista",
  "location_text": "Sinop, MT",
  "country_code": "BR",
  "limit": 3
}
```

`raw_text` e `service_text` aceitam 1 a 2.000 caracteres. `location_text` aceita 2 a 500. `country_code` usa `BR` por padrão e `limit` usa `3`, limitado a 10 profissionais. O limite do geocoder continua interno e fixo em 5 candidatos.

O fluxo é sequencial: resolve o serviço; somente se ele estiver `resolved`, resolve a localização; somente se ambos estiverem `resolved`, chama o Matching Engine. Assim, `needs_service` retorna `reason` `unresolved` ou `ambiguous` sem geocoding ou matching, e `needs_location` retorna a mesma razão sem matching. Em ambos os casos a resposta é HTTP 200.

Quando matching encontra profissionais, o status é `matched`; quando recebe uma localização e serviço válidos, mas não encontra ninguém elegível, é `no_matches`. Ambos retornam as resoluções e a resposta original do matching, sem telefone ou e-mail.

O matching recebe o `raw_text` original, o `service_id` resolvido e latitude, longitude, cidade, estado e bairro do `location_resolution.match`. Se o serviço for removido ou inativado entre a resolução e o matching, a rota retorna `409 service_unavailable`.

Falhas técnicas do geocoder permanecem distintas de uma localização não resolvida: `503 geocoding_unavailable`, `429 geocoding_rate_limited` e `502 geocoding_provider_error`. Falhas inesperadas retornam `500 internal_error` sem detalhes internos.

## Interpretação determinística de mensagem

### `POST /internal/message-interpretation/interpret`

Rota interna protegida por `X-Internal-Key` que transforma uma única mensagem em slots básicos, apenas em memória:

```json
{ "raw_text": "Minha tomada queimou aqui em Sinop", "country_code": "BR" }
```

Quando encontra uma localização explícita, retorna `interpreted`, preserva a mensagem completa em `raw_text` e `service_text`, e preenche `location_text`. Manter o texto integral como serviço é intencional: o Service Resolution 3.2 já encontra nomes e aliases dentro de frases e continua sendo o único responsável por reconhecer o serviço.

O fast path reconhece marcadores fortes como `aqui em Sinop`, `na cidade de Cuiabá` e `no município de Sinop` sem exigir UF. O formato genérico `em X` no final da mensagem somente é interpretado quando traz uma UF explícita, como `em Sinop, MT`; sem ela, o fluxo retorna `needs_location` para evitar confundir termos de serviço com cidades. Nomes de localidades são aceitos e preservados independentemente de caixa; apenas a UF é normalizada para maiúsculas (`sinop, mt` → `sinop, MT`). Acentos são preservados, e somente espaços externos e pontuação terminal são removidos.

Quando não há uma localização textual explícita ou a expressão é genérica (`em casa`, `no trabalho`, `na empresa`, `no meu apartamento`), retorna HTTP 200 com `needs_location`, `location_text: null` e estratégia `none`. Não há confiança numérica artificial.

Este endpoint não valida se a cidade existe, não geocodifica e ainda não chama o Search Orchestrator. Também não usa banco, HTTP, HeiGIT, OpenAI ou biblioteca NLP.

## Busca a partir de uma mensagem

### `POST /internal/search/from-message`

Rota interna protegida por `X-Internal-Key` que conecta o Message Interpreter ao Search Orchestrator diretamente em memória:

```json
{
  "raw_text": "minha tomada queimou aqui em sinop",
  "country_code": "BR",
  "limit": 3
}
```

`raw_text` aceita de 1 a 2.000 caracteres. `country_code` é opcional, normalizado para ISO alpha-2 maiúsculo e usa `BR` por padrão. `limit` é opcional, usa `3` por padrão e aceita de 1 a 10.

O fluxo híbrido é `Message Interpreter (fast path) → LLM Location Fallback, quando necessário → Search Orchestrator → Service Resolution → Location Resolution → Matching`. Não há chamada HTTP entre os módulos internos; a única chamada externa opcional desta camada é ao provider do fallback.

O fallback é desligado por padrão com `MESSAGE_INTERPRETATION_FALLBACK_ENABLED=false`. Nesse estado, o comportamento da 3.5B é preservado: quando o interpreter não encontra uma localização explícita, a resposta é HTTP 200 com `status: needs_location`, `stage: interpretation`, `reason: missing_explicit_location` e `orchestration: null`. A OpenAI não é chamada.

Quando o fallback está ligado e o fast path retorna `needs_location`, a API usa o modelo configurado em `MESSAGE_INTERPRETATION_FALLBACK_MODEL` (padrão `gpt-5.6-luna`) somente para extrair uma localização textual explícita. O serviço continua sendo resolvido deterministicamente a partir da mensagem completa. O LLM não geocodifica, não escolhe profissionais e não faz ranking; a existência e as coordenadas da localidade ainda são validadas pelo Location Resolution 3.3.

Uma localização extraída pelo fallback produz uma interpretação interna com `location_strategy: llm_fallback`, preserva `raw_text`, `service_text`, `country_code` e `limit`, e então segue para o Search Orchestrator. O endpoint determinístico `/internal/message-interpretation/interpret` não muda e nunca chama OpenAI.

Se o fallback não entender a localização, o retorno usa `reason: location_not_understood`. Timeout ou rede usam `fallback_unavailable`, limite do provider usa `fallback_rate_limited`, e resposta inválida, incompleta, recusada ou erro do provider usa `fallback_provider_error`. Todos esses estados retornam HTTP 200, `stage: interpretation` e `orchestration: null`; nenhum geocoding, SQL, `search_request` ou matching é executado. Detalhes técnicos e segredos não entram no body.

A integração usa a Responses API com Structured Outputs, `store: false`, `reasoning.effort: none`, limite de 100 tokens de saída, timeout configurável (padrão 5 segundos) e zero retries automáticos. `OPENAI_API_KEY` é exclusivamente server-side. Se o fallback estiver ligado sem essa chave, a API e o `/health` continuam iniciando; somente um request que realmente precise do fallback degrada para `fallback_unavailable`.

Quando a interpretação termina, os estados do orquestrador são preservados com o estágio correspondente:

- `needs_service` usa `stage: service_resolution` e razão `unresolved` ou `ambiguous`.
- `needs_location` usa `stage: location_resolution` e razão `unresolved` ou `ambiguous`.
- `matched` e `no_matches` usam `stage: matching` e `reason: null`.

Assim, `needs_location` na etapa `interpretation` significa que a mensagem não trouxe uma localização explícita confiável; na etapa `location_resolution`, significa que um texto foi extraído, mas o geocoder não o resolveu com segurança.

A corrida de serviço indisponível continua retornando `409 service_unavailable`. Falhas técnicas do geocoder permanecem `503 geocoding_unavailable`, `429 geocoding_rate_limited` ou `502 geocoding_provider_error`; erros inesperados retornam `500 internal_error`. A resposta não adiciona telefone ou e-mail.

O endpoint continua priorizando o fast path determinístico. A OpenAI só pode ser chamada pelo pipeline quando esse fast path não extrai uma localização e o kill switch está ligado. Não há integração com WhatsApp nesta etapa.

## Conversa transitória de busca

As rotas abaixo permitem completar serviço e localização em múltiplos turnos. `search_conversations` guarda somente o estado transitório da interação; `search_requests` continua sendo a busca de negócio criada exclusivamente pelo Matching quando ambos os slots estão resolvidos.

### `POST /internal/search/conversations`

Inicia uma busca usando exatamente o Message Search híbrido 3.5C:

```json
{
  "raw_text": "preciso de eletricista perto daqui",
  "country_code": "BR",
  "limit": 3
}
```

Se o resultado for `matched` ou `no_matches`, nenhuma conversa é persistida e a resposta contém `conversation_id: null` e `conversation_status: completed`. Uma localização que já chegou ao Location Resolution sem resolver continua sem abrir conversa no start.

`needs_location` com `stage: interpretation` cria uma conversa ativa aguardando localização:

```json
{
  "conversation_id": "UUID",
  "conversation_status": "active",
  "pending_slot": "location",
  "result": {
    "status": "needs_location",
    "stage": "interpretation"
  }
}
```

`needs_service` com `stage: service_resolution` e `interpretation.location_text` utilizável cria uma conversa aguardando serviço:

```json
{
  "conversation_id": "UUID",
  "conversation_status": "active",
  "pending_slot": "service",
  "result": {
    "status": "needs_service",
    "stage": "service_resolution"
  }
}
```

A conversa preserva a mensagem original, `service_text`, `location_text` quando disponível, país e limite. Seu TTL é controlado por `SEARCH_CONVERSATION_TTL_MINUTES`, com padrão de 30 minutos. O claim de processamento possui lease recuperável configurada por `SEARCH_CONVERSATION_PROCESSING_LEASE_SECONDS`, com padrão de 60 segundos.

### `POST /internal/search/conversations/:conversationId/messages`

Continua uma conversa usando o significado semântico de `pending_slot`:

```json
{ "raw_text": "Sinop" }
```

Se `pending_slot = location`, o texto atual segue diretamente como `location_text`; se `pending_slot = service`, segue como `service_text` e reutiliza a localização armazenada. Nenhuma continuação chama Message Interpreter, Message Search ou OpenAI. A mensagem do primeiro turno permanece como `raw_text` do Search Orchestrator.

Se o orquestrador retornar `matched` ou `no_matches`, a conversa passa para `completed`, limpa `pending_slot` e salva o `search_request_id` criado pelo Matching. `needs_location` mantém ou altera o slot para `location`; `needs_service` mantém ou altera para `service`. Toda resposta que mantém a conversa ativa preserva as tentativas de serviço/localização e renova o TTL.

```text
ACTIVE/location ── reply ──┬─ matched | no_matches → COMPLETED
                            ├─ needs_location       → ACTIVE/location
                            └─ needs_service        → ACTIVE/service

ACTIVE/service  ── reply ──┬─ matched | no_matches → COMPLETED
                            ├─ needs_service        → ACTIVE/service
                            └─ needs_location       → ACTIVE/location
```

Erros de estado:

- `404 conversation_not_found`: UUID não encontrado.
- `410 conversation_expired`: TTL encerrado; a conversa não é reutilizada.
- `409 conversation_not_active`: conversa concluída, cancelada ou alterada durante o processamento.
- `409 conversation_processing`: outra mensagem já reservou a mesma conversa.

Cada continuação usa um `processing_token` obtido por atualização condicional no PostgreSQL. A chamada externa ao geocoder acontece depois dessa reserva, sem manter transação ou row lock aberto. Assim, duas mensagens simultâneas não executam o matching em paralelo. Um claim com `processing_started_at` anterior à lease pode ser reassumido com um novo token, recuperando crashes ou restarts abruptos. Claims recentes continuam retornando `conversation_processing`. Idempotency keys de webhook ainda não fazem parte desta etapa.

## Erros

## Customer Conversation Router

`POST /internal/customer-search/messages` é a entrada interna independente de canal para uma mensagem identificada por telefone. Exige `X-Internal-Key`; a futura Evolution API apenas adaptará o webhook para este contrato e não conhecerá slots, matching ou `conversation_id`.

```json
{
  "phone_e164": "+5566999999999",
  "raw_text": "preciso de eletricista perto daqui",
  "country_code": "BR",
  "limit": 3
}
```

`phone_e164` deve chegar em E.164 canônico: `+`, código de país e até 15 dígitos. Esta camada não infere DDD, país ou formatação nacional. A resposta não devolve o telefone:

```json
{
  "customer_id": "UUID",
  "route": "started",
  "conversation": { "conversation_id": "UUID", "conversation_status": "active" }
}
```

O router cria ou reutiliza o `customer` pelo telefone. Antes de consultar uma conversa, marca as conversas ativas vencidas desse cliente como `expired`. Se existir uma conversa ativa, encaminha a mensagem como continuação; caso contrário, inicia uma busca nova com o `customer_id` apenas no contexto interno. Uma conversa concluída, cancelada ou expirada nunca é reutilizada.

O banco garante no máximo uma conversa `active` por cliente por meio de índice parcial. Uma corrida rara ao criar duas conversas retorna `409 customer_conversation_conflict`; a serialização e idempotência do webhook pertencem à futura camada de canal. `409 conversation_processing` e os erros técnicos já existentes permanecem inalterados.

Quando o Matching cria um `search_request` originado por este endpoint, persiste o mesmo `customer_id`, tanto em resultados de um turno quanto em continuações. As rotas 3.x não recebem `customer_id` em seus bodies e continuam criando `search_request.customer_id = NULL`.

## Channel Inbox e idempotência

`POST /internal/channel/inbound/messages` é a entrada temporária para adapters de canal. Também exige `X-Internal-Key`; não há integração com Evolution nesta etapa.

```json
{
  "provider": "test",
  "provider_message_id": "msg-001",
  "phone_e164": "+5566999999999",
  "raw_text": "preciso de eletricista perto daqui",
  "country_code": "BR",
  "limit": 3
}
```

O par `(provider, provider_message_id)` é a chave de idempotência persistida. O provider é normalizado para minúsculas e usa identificador simples; providers distintos podem reutilizar o mesmo ID externo. A primeira entrega torna imutáveis telefone, texto, país e limite daquela chave. Uma entrega posterior com qualquer um desses valores diferente retorna `409 channel_message_payload_conflict`, sem replay, claim ou chamada ao router. Quando os valores são iguais e o registro já está `processed`, a inbox devolve o mesmo resultado validado com `duplicate: true`, sem chamar o router. Quando está em processamento dentro da lease, retorna `409 channel_message_processing`.

No mesmo commit transacional que marca a Inbox como `processed`, a API cria uma única mensagem textual em `channel_outbound_messages`, vinculada por `channel_inbound_message_id` único. A resposta de sucesso inclui `reply_text` e `outbound: { id, status }`, junto do `result` estruturado já existente. A API gera o texto deterministicamente a partir do resultado do Customer Router: pergunta pela cidade ou serviço pendente, apresenta os profissionais já retornados pelo Matching ou informa que não houve resultado. Ela nunca inclui `phone_e164`, `raw_text`, `service_text`, e-mail, IDs internos ou score. O resultado persistido é validado pelo contrato completo do Customer Router antes do replay e é projetado para uma resposta segura; o mesmo resultado gera o mesmo `reply_text` enquanto a versão do presenter for a mesma. O replay devolve o mesmo `outbound.id`, inclusive quando seu status já é `sent`. A Inbox também salva `customer_id`, `conversation_id` e, quando houver matching, `search_request_id`.

Para compatibilidade com inbounds históricos que já estavam `processed` antes da Outbox existir, um replay válido sem registro outbound faz um repair lazy: gera `reply_text` com o Message Presenter e executa `INSERT ... ON CONFLICT (channel_inbound_message_id) ... RETURNING` usando somente provider e telefone persistidos no inbound. Não altera o status inbound, não chama Customer Router, Matching, geocoder ou OpenAI. A unicidade mantém uma única intenção outbound mesmo em replays concorrentes; a migration 007 não faz backfill textual em SQL.

O n8n não interpreta linguagem nem aplica regras de negócio: ele transporta a intenção outbound persistida pela API até a futura Evolution. Nesta etapa não há chamada direta à Evolution pela API nem uso de OpenAI pelo presenter; a política de retries fica persistida na Outbox para o consumidor separado.

## Channel Outbox

Cada registro Outbox possui uma finalidade explícita: `customer_reply` para a resposta vinculada a um inbound (mantendo uma por inbound) ou `professional_contact_notification` para a notificação independente criada atomicamente com um contato bilateral autorizado. A segunda usa chave única de negócio por contato, sem inbound fictício.

Quando o cliente envia “mostrar mais” durante uma seleção, a API não inicia nova busca: consulta a mesma `search_request`, usa o limite original salvo na conversa e cria uma nova mensagem Outbox com a próxima página ordenada por `rank_position`. A numeração é absoluta e a resposta orienta a escolha por número ou nome. Matches já associados a outra apresentação não entram na página; a migration 011 garante essa reserva única por `match_id`. A reserva e a criação da Outbox são protegidas pela transação: uma colisão concorrente reverte o inbound e retorna `selection_show_more_pending`, sem criar uma Outbox sem associações. Enquanto uma página estiver pendente ou falha, novas solicitações não são tratadas como “não há mais opções”.

Depois da resposta da Inbox, o n8n deve operar somente a mensagem Outbox indicada por `outbound.id`:

```text
Inbox → outbound.id → POST /internal/channel/outbound/:id/claim
      → Evolution send text
      → POST /internal/channel/outbound/:id/sent
```

Em rejeição comprovada do transporte, o n8n chama `POST /internal/channel/outbound/:id/failed`. Resultado incerto exige `/hold`, conforme 017. Todas as rotas exigem `X-Internal-Key`.

`POST /internal/channel/outbound/:outboundId/claim` reserva uma mensagem `pending`, `failed` ou uma lease `processing` vencida. A resposta `processing` contém o `processing_token`, `recipient_phone_e164` e `text_content` que o transporte necessita; o telefone é PII e só é retornado nessa rota interna autenticada. Cada claim incrementa `attempt_count`. Se a mensagem já estiver `sent`, a rota responde apenas com seu estado e não fornece conteúdo para novo envio. Uma lease ativa retorna `409 outbound_message_processing`.

Após aceitação comprovada, `POST /internal/channel/outbound/:outboundId/sent` recebe `processing_token` e `provider_message_id`; somente o claim atual pode marcar `sent`. A repetição idêntica comprovada pelo recibo 017 também retorna 200, sem alterar timestamps. `/failed` exige token atual e erro controlado, sem retenção. Ambos retornam somente `{ id, status }`; tokens alheios/substituídos e confirmação conflitante retornam `409 outbound_message_claim_invalid`. A expiração permite nova reserva, mas não troca o token até ela ocorrer.

`CHANNEL_OUTBOUND_PROCESSING_LEASE_SECONDS` controla a lease e tem valor padrão de 60 segundos. PostgreSQL é a fonte de verdade. O endpoint interno `POST /internal/channel/outbound/next/claim` reserva atomicamente a próxima mensagem elegível; considera `pending` sem agendamento, `next_attempt_at <= NOW()` e leases `processing` vencidas. A fila vazia retorna `204 No Content`; o claim individual existente continua retornando `404` para um ID inexistente. A transação termina antes do envio externo.

### Retry da Outbox (migration 016)

Uma mensagem nova começa com `attempt_count = 0` e `next_attempt_at = NULL`. Cada claim incrementa o contador e cria uma lease. O consumidor confirma sucesso com `/sent` ou informa rejeição transitória com `/failed`; falhas 1–4 voltam a `pending` com `last_error_code` e backoff de 30, 60, 120 e 240 segundos. O array da política também contém 480s, mas a quinta falha já é terminal e não agenda sexta tentativa. Antes de `next_attempt_at` a mensagem não é elegível. `sent` nunca volta a `pending`; 017 também limita leases abandonadas.

O `markFailed` exige o `processing_token` da lease atual, é idempotente para tokens inválidos e retorna `{ id, status: "pending" }` quando uma nova tentativa foi agendada ou `{ id, status: "failed" }` ao atingir o limite. A política é centralizada em código, sem variável de ambiente nesta etapa. A migration 016 cria o índice parcial de pendências elegíveis; seu `down` bloqueia com `P0016 / OUTBOUND_RETRY_ROLLBACK_BLOCKED` se houver `next_attempt_at` preenchido, sem apagar ou transformar dados.

Há uma janela residual inevitável: a Evolution pode aceitar a mensagem e o n8n cair antes de confirmar `/sent`; após a lease expirar, um novo claim poderá reenviá-la. A arquitetura evita perda da intenção e duplicações lógicas usuais, mas não promete exactly-once matemático.

Falhas controladas do router preservam seus códigos HTTP. A lease da Inbox é controlada por `CHANNEL_INBOUND_PROCESSING_LEASE_SECONDS` (60 segundos por padrão). B2 mantém IA/geocoder fora da transação final. Desde a 019, o caminho legado engloba o router na transação da Inbox e pode manter lock durante geocoding legado, com limites de tempo; detalhes em [INBOX_RECOVERY.md](INBOX_RECOVERY.md). Falhas de transporte da Outbox seguem a política de retry acima.

A janela histórica entre o efeito do Customer Router e a conclusão da Inbox foi fechada no caminho 019 por transação compartilhada e fencing. Entradas anteriores com possíveis efeitos parciais são isoladas para reconciliação, não executadas cegamente. A entrega externa continua at-least-once, sujeita a recibo/retenção; não há promessa de exatamente uma entrega WhatsApp.

- `400`: `validation_error`, com detalhes de validação.
- `401`: `unauthorized`.
- `404`: `professional_not_found`.
- `404`: `service_not_found` ou `professional_service_not_found`.
- `404`: `service_area_not_found`.
- `409`: `professional_slug_conflict` se não for possível reservar um slug único.
- `409`: `professional_service_already_exists` ou `service_inactive`.
- `409`: `professional_not_active` ao tentar ativar disponibilidade para um profissional não ativo.
- `409`: `customer_conversation_conflict` para corrida na criação de conversa ativa do mesmo cliente.
- `409`: `channel_message_processing` quando a mesma mensagem de canal ainda possui claim ativo.
- `409`: `channel_message_payload_conflict` quando a mesma idempotency key é recebida com payload diferente.
- `500`: `internal_error`, sem expor SQL, stack trace ou segredos.
# Respostas a oportunidades pela Channel Inbox

O endpoint existente aceita decisões como `aceito CC-23456789` e
`recuso CC-23456789`, sempre vinculadas ao remetente persistido. Sem código,
somente uma oportunidade inequívoca pode ser respondida. Perguntas não são decisões.
O resultado adicional tem `route: opportunity` e `result: { kind, text, public_code? }`;
`kind` é accepted, declined, clarification, unavailable, resumed, kept ou expired.
Não inclui telefone ou identificadores internos do contato/profissional.

Após recusa, o cliente pode enviar `retomar CC-23456789`, `retomar eletricista`
ou `continuar aqui`. Outra busca ativa nunca é substituída implicitamente.
Se houver ambiguidade ou expiração, a resposta informa o próximo passo sem trocar
o contexto. Uma resposta repetida mantém a Outbox e a decisão já persistidas.
Novas finalidades Outbox: `professional_reply` e `customer_contact_update`.
O dispatcher e o fluxo de confirmação de envio permanecem os mesmos.
# B2 opcional na Inbox

Sem nova rota: a Inbox pode retornar o resultado aditivo
`{route:"contextual",customer_id,status}`. Status: needs_service, needs_location,
clarification, information, matched, no_matches ou fallback. Envelope, Outbox,
claim/sent/failed e entrega compartilhada permanecem iguais. Nenhuma memória ou
evidência da IA é incluída. Replay usa a Outbox mesmo com a B2 desligada.
Veja [B2_CONTEXTUAL_CONVERSATION.md](B2_CONTEXTUAL_CONVERSATION.md).
# Recuperação operacional da Inbox (019)

`POST /internal/channel/inbound/next/process`: autenticação `X-Internal-Key`,
um item por chamada, 204 sem item elegível ou 200 `{ id, status }`; status
`processed | retry_scheduled | quarantined | processing`. Não envia WhatsApp
nem retorna telefone/texto/token. A Outbox resultante usa a entrega compartilhada.

`GET /internal/channel/inbound/queue-status`: diagnóstico agregado sem PII.
`POST /internal/channel/inbound/:id/disposition`: corpo estrito com `request_id`,
`operator_id` (UUIDs), `action: retry | close` e razão enumerada. Idempotente e
auditado; 404 inexistente, 409 conflito/ação insegura. Não concede consentimento.
Contrato completo, backoff, quarentena e rollout: [INBOX_RECOVERY.md](INBOX_RECOVERY.md).

# Transporte durável 020

Contratos novos, todos com X-Internal-Key: POST /internal/channel/media/events,
/media/next/claim (204 vazio), /media/:id/result, /media/purge;
POST /internal/channel/outbound/:id/disposition e GET /internal/channel/transport/diagnostics.
A nova finalidade channel_notice usa o claim/sent/failed/hold existentes; nenhum
contrato da Inbox foi substituído. /hold aceita provider_message_id opcional para
preservar confirmação pendente. Disposição tem request_id, operator_id, ação/razão
e evidência; 409 no conflito e fencing do token antigo. Nenhum consentimento é inferido.
Corpos, respostas e política completa: [TRANSPORT_DURABILITY.md](TRANSPORT_DURABILITY.md).
