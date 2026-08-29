FROM node:22-alpine AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable

WORKDIR /app

FROM base AS dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN pnpm install --frozen-lockfile

FROM dependencies AS build

COPY tsconfig.base.json ./
COPY apps/api apps/api
COPY packages/shared packages/shared

RUN pnpm --filter @contatocerto/shared build \
  && pnpm --filter @contatocerto/api build

FROM build AS production-dependencies

RUN pnpm --filter @contatocerto/api deploy --prod --legacy /deploy

FROM node:22-alpine AS runner

ENV NODE_ENV=production
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable

WORKDIR /app

COPY --from=production-dependencies /deploy ./

EXPOSE 3333

CMD ["pnpm", "start"]
