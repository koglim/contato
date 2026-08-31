# API interna

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

`raw_text`, `service_id`, `latitude` e `longitude` são obrigatórios. O texto aceita até 2.000 caracteres; latitude e longitude precisam estar nas faixas geográficas válidas. Os metadados de localização são opcionais e `limit` é opcional, com padrão `3` e intervalo de `1` a `10`.

Em uma única transação, a API valida que o serviço existe e está ativo, registra um `search_request` com o ponto PostGIS, identifica os profissionais elegíveis e persiste um `match` para cada resultado. Um profissional só entra se estiver ativo, oferecer o serviço de forma ativa e possuir uma área ativa cujo raio contenha o ponto consultado. Quando possui várias áreas elegíveis, somente a mais próxima é considerada.

O campo `effective_available_now` é verdadeiro apenas quando a disponibilidade está ligada e foi confirmada nos últimos 240 minutos. A disponibilidade não elimina candidatos; a ordenação é: disponibilidade efetiva, menor distância, profissional verificado e UUID do profissional. A resposta não expõe telefone ou e-mail.

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

## Erros

- `400`: `validation_error`, com detalhes de validação.
- `401`: `unauthorized`.
- `404`: `professional_not_found`.
- `404`: `service_not_found` ou `professional_service_not_found`.
- `404`: `service_area_not_found`.
- `409`: `professional_slug_conflict` se não for possível reservar um slug único.
- `409`: `professional_service_already_exists` ou `service_inactive`.
- `409`: `professional_not_active` ao tentar ativar disponibilidade para um profissional não ativo.
- `500`: `internal_error`, sem expor SQL, stack trace ou segredos.
