FROM node:22-bookworm-slim

RUN corepack enable

RUN mkdir -p \
    /workspace/node_modules \
    /workspace/apps/web/.next \
    /pnpm/store \
    && chown -R node:node /workspace /pnpm

WORKDIR /workspace

USER node
