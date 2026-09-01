FROM node:22-bookworm-slim AS builder
RUN corepack enable
WORKDIR /workspace
COPY . .
ARG NEXT_PUBLIC_API_URL=http://localhost:3001/api/v1
ARG NEXT_PUBLIC_OIDC_ISSUER=http://localhost:8080/realms/authorization
ARG NEXT_PUBLIC_OIDC_CLIENT_ID=authorization-web
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_OIDC_ISSUER=$NEXT_PUBLIC_OIDC_ISSUER
ENV NEXT_PUBLIC_OIDC_CLIENT_ID=$NEXT_PUBLIC_OIDC_CLIENT_ID
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @authorization/web... build

FROM node:22-bookworm-slim AS runner
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
RUN corepack enable
WORKDIR /workspace
COPY --from=builder /workspace/apps/web/.next/standalone /workspace
COPY --from=builder /workspace/apps/web/.next/static /workspace/apps/web/.next/static
COPY --from=builder /workspace/apps/web/public /workspace/apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
