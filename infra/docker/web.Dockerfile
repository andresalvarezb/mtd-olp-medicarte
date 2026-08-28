FROM node:22-bookworm-slim AS builder
RUN corepack enable
WORKDIR /workspace
COPY . .
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ARG NEXT_PUBLIC_OIDC_URL=http://localhost:8080
ARG NEXT_PUBLIC_OIDC_REALM=authorization
ARG NEXT_PUBLIC_OIDC_CLIENT_ID=authorization-web
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_OIDC_URL=$NEXT_PUBLIC_OIDC_URL
ENV NEXT_PUBLIC_OIDC_REALM=$NEXT_PUBLIC_OIDC_REALM
ENV NEXT_PUBLIC_OIDC_CLIENT_ID=$NEXT_PUBLIC_OIDC_CLIENT_ID
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @authorization/web... build

FROM node:22-bookworm-slim AS runner
ENV NODE_ENV=production
RUN corepack enable
WORKDIR /workspace
COPY --from=builder /workspace /workspace
USER node
EXPOSE 3000
CMD ["pnpm", "--filter", "@authorization/web", "start"]
