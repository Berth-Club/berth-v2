# syntax=docker/dockerfile:1
# Build CONTEXT is the monorepo root (launchpad-app/) — the indexer imports
# @workspace/contracts from packages/. Ponder has no separate build step; it
# bundles from source at `ponder start`.
#   docker build -f apps/indexer/Dockerfile -t berth-indexer .

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1
RUN corepack enable
WORKDIR /app

# --- deps ---
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/
COPY apps/indexer/package.json ./apps/indexer/
COPY packages/ui/package.json ./packages/ui/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/eslint-config/package.json ./packages/eslint-config/
COPY packages/typescript-config/package.json ./packages/typescript-config/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# --- runtime: source + deps, run ponder ---
FROM base AS runner
ENV NODE_ENV=production
COPY --from=deps /app ./
COPY . .
WORKDIR /app/apps/indexer
# Ponder's GraphQL + status server. DATABASE_URL, RPC_URL, DATABASE_SCHEMA come
# from the environment; addresses come from @workspace/contracts in the image.
EXPOSE 42069
CMD ["pnpm", "start"]
