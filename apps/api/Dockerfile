# One image, two Railway services: `api` (default command) and `worker`
# (start command `node apps/api/src/worker.ts`). Build from the repo root:
#   docker build -f apps/api/Dockerfile .
# Node 24 runs the TypeScript sources directly (type stripping), so there is no build step.
FROM node:24-alpine AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

FROM base AS prune
COPY . .
RUN pnpm dlx turbo@2.11.5 prune @crm/api --docker

FROM base AS install
COPY --from=prune /app/out/json/ .
RUN pnpm install --frozen-lockfile --prod --ignore-scripts
COPY --from=prune /app/out/full/ .

FROM node:24-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=install --chown=app:app /app .
USER app
EXPOSE 8080
CMD ["node", "apps/api/src/server.ts"]
