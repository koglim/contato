# Painel web do profissional

O painel temporário está em `/dashboard` e usa a API interna existente por meio de Route Handlers do Next.js. O navegador nunca recebe `INTERNAL_API_KEY` nem chama a API diretamente.

Status administrativo e telefone são somente leitura. O BFF rejeita alterações
nesses campos mesmo com sessão válida; perfil permite apenas nome, e-mail, bio e
foto. Métodos, UUIDs e ações são validados antes do proxy. O ID do profissional
permanece configurado no servidor: ainda é demonstração, não autenticação
individual/ownership multiusuário. Troca de telefone depende de verificação
pela equipe até existir a jornada segura de identidade.

## Configuração

Defina no ambiente do web:

- `CONTATOCERTO_API_URL`: URL interna da API, por exemplo `http://contatocerto-api:3333` no EasyPanel;
- `INTERNAL_API_KEY`: a mesma chave configurada na API;
- `DASHBOARD_PROFESSIONAL_ID`: UUID do profissional de demonstração;
- `DASHBOARD_DEMO_PASSWORD`: senha temporária de acesso ao painel.
- `DASHBOARD_SESSION_SECRET`: segredo longo e aleatório usado para assinar a sessão temporária.

Em desenvolvimento local, use `http://localhost:3333` para a URL da API. Após a senha correta, o servidor grava um cookie HttpOnly com um token HMAC SHA-256, contendo somente a expiração. A assinatura é verificada em cada acesso ao painel e BFF; tokens adulterados ou expirados não autenticam. O cookie usa `path=/` para acompanhar tanto `/dashboard` quanto `/api/dashboard`, `Secure` em produção e `SameSite=Lax`. Isso continua sendo acesso temporário, não o sistema de autenticação definitivo.

## Deploy no EasyPanel

Use o `Dockerfile.web` com a raiz do monorepo como contexto de build. Ele produz uma imagem standalone do Next.js e inicia somente o frontend.

Configure estas variáveis no serviço web, sem valores em arquivos versionados:

- `CONTATOCERTO_API_URL`;
- `INTERNAL_API_KEY`;
- `DASHBOARD_PROFESSIONAL_ID`;
- `DASHBOARD_DEMO_PASSWORD`;
- `DASHBOARD_SESSION_SECRET`.

O EasyPanel fornece `PORT` quando necessário; a imagem usa `3000` como fallback e escuta em `0.0.0.0`. A URL da API deve ser informada pela rede interna do ambiente, nunca codificada na imagem.
# Passwordless rollout

With `PROFESSIONAL_AUTH_ENABLED=false`, the existing demo login is unchanged. With the flag enabled, `/dashboard/access` requests a phone challenge and verifies the OTP through the BFF. The opaque session stays in an HttpOnly cookie; profile access is resolved from active memberships and supports zero, one or multiple profiles.

In passwordless mode the BFF calls only the authenticated self-service routes under `/internal/professional-auth/profiles/:id`. The API rechecks the exact active membership on every read and mutation. A profile-selection cookie chooses among currently authorized profiles and never grants access. Zero profiles remain authenticated and show “Nenhum perfil profissional está vinculado a esta conta.” One opens directly; many show the selector.

All passwordless state changes, including challenge/verify, logout, profile selection and dashboard mutations, require an exact same-origin `Origin` header. Logout clears both the session and profile-selection cookies even when API revocation is already idempotently complete.
