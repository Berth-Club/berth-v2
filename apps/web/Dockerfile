# syntax=docker/dockerfile:1
# Build CONTEXT is the monorepo root (launchpad-app/), not apps/web — the app
# imports workspace packages (@workspace/ui, @workspace/contracts) that live in
# packages/. Build locally with:
#   docker build -f apps/web/Dockerfile -t berth-web .
# or via the root docker-compose.yml.

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1
RUN corepack enable
WORKDIR /app

# --- deps: install the whole workspace from the lockfile. Cached on the
#     manifests alone, so source edits don't re-run install. ---
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/
COPY apps/indexer/package.json ./apps/indexer/
COPY packages/ui/package.json ./packages/ui/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/eslint-config/package.json ./packages/eslint-config/
COPY packages/typescript-config/package.json ./packages/typescript-config/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# --- build: produces apps/web/.next/standalone (self-contained server) ---
FROM base AS build
# Turns on Next.js `output: standalone` (see next.config.ts) — Docker only.
ENV NEXT_TELEMETRY_DISABLED=1
# NEXT_PUBLIC_* are inlined into the client bundle at BUILD time, so they must
# be build args (contract addresses are NOT here — they come from the code in
# @workspace/contracts).
ARG NEXT_PUBLIC_PRIVY_APP_ID=""
ARG NEXT_PUBLIC_INDEXER_URL="http://localhost:42069"
ARG NEXT_PUBLIC_RPC_URL="https://rpc.testnet.arc.network"
ARG NEXT_PUBLIC_IPFS_GATEWAY=""
ARG NEXT_PUBLIC_R2_PUBLIC_BASE=""
ARG NEXT_PUBLIC_PROFILE_EDITING=""
ENV NEXT_PUBLIC_PRIVY_APP_ID=$NEXT_PUBLIC_PRIVY_APP_ID \
    NEXT_PUBLIC_INDEXER_URL=$NEXT_PUBLIC_INDEXER_URL \
    NEXT_PUBLIC_RPC_URL=$NEXT_PUBLIC_RPC_URL \
    NEXT_PUBLIC_IPFS_GATEWAY=$NEXT_PUBLIC_IPFS_GATEWAY \
    NEXT_PUBLIC_R2_PUBLIC_BASE=$NEXT_PUBLIC_R2_PUBLIC_BASE \
    NEXT_PUBLIC_PROFILE_EDITING=$NEXT_PUBLIC_PROFILE_EDITING
COPY --from=deps /app ./
COPY . .
RUN pnpm --filter web build

# --- runtime: full build + `next start` (same as Railway). Reliable in a pnpm
#     monorepo — no standalone tracing, which drops symlinked @workspace/* deps. ---
FROM base AS runner
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app ./
WORKDIR /app/apps/web
EXPOSE 3000
CMD ["pnpm", "start"]
