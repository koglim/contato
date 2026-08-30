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

## Erros

- `400`: `validation_error`, com detalhes de validação.
- `401`: `unauthorized`.
- `404`: `professional_not_found`.
- `409`: `professional_slug_conflict` se não for possível reservar um slug único.
- `500`: `internal_error`, sem expor SQL, stack trace ou segredos.
