FROM node:22-bookworm-slim AS builder
RUN corepack enable
WORKDIR /workspace
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @authorization/api... build

FROM node:22-bookworm-slim AS runner
ENV NODE_ENV=production
WORKDIR /workspace
COPY --from=builder /workspace /workspace
USER node
EXPOSE 3001
CMD ["node", "apps/api/dist/main.js"]
