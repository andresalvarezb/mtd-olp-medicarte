FROM node:22-bookworm-slim AS builder
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store corepack prepare pnpm@11.24.0 --activate && pnpm config set store-dir /pnpm/store && pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @authorization/api... build

FROM node:22-bookworm-slim AS runner
ENV NODE_ENV=production
WORKDIR /workspace
COPY --from=builder /workspace /workspace
USER node
EXPOSE 3001
CMD ["node", "apps/api/dist/main.js"]
