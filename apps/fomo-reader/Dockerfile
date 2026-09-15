# The FOMO reader, with a browser of its own.
#
# Playwright's own image rather than a plain node base, because it already
# carries the system libraries headless Chromium needs. Installing those by hand
# on top of node:slim is a list that changes with every Chromium release, and
# the failure is a browser that launches locally and not in the container.
FROM mcr.microsoft.com/playwright:v1.63.0-noble

WORKDIR /app
ENV NODE_ENV=production
# There is no browser to attach to on a server, so it brings its own.
ENV FOMO_DRIVER=playwright

RUN corepack enable

# Manifests first, so a code change does not reinstall the world.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/fomo-reader/package.json          apps/fomo-reader/
COPY packages/db/package.json               packages/db/
COPY packages/typescript-config/package.json packages/typescript-config/

RUN pnpm install --frozen-lockfile --filter fomo-reader...

COPY packages/db      packages/db
COPY apps/fomo-reader apps/fomo-reader

# The profile holds the session and MUST outlive a deploy, or every release
# signs out and the feed silently returns nothing.
ENV FOMO_PROFILE_DIR=/data/fomo-profile

CMD ["pnpm", "--filter", "fomo-reader", "start"]
