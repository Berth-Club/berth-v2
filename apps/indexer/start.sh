#!/bin/sh
# Ponder bakes the build (schema + indexing code + config) into an app-id and
# REFUSES to reuse a database schema created by a different build — so every
# indexer code change would otherwise crash-loop on "schema previously used by a
# different Ponder app" until someone manually bumps DATABASE_SCHEMA.
#
# Fix: give each DEPLOY its own schema, derived from the commit it was built
# from (Railway sets RAILWAY_GIT_COMMIT_SHA; RAILWAY_DEPLOYMENT_ID is the
# fallback). Consequences:
#   - a NEW deploy gets a fresh schema  -> clean start, ~1 min resync, no bump
#   - a crash/restart of the SAME deploy reuses the SAME schema -> Ponder
#     resumes instead of resyncing
# Old per-deploy schemas are tiny (~2 MB) and can be pruned occasionally.
#
# Locally (no Railway vars) DATABASE_SCHEMA is left as-is, so restarts resume.
set -e

ID="${RAILWAY_GIT_COMMIT_SHA:-$RAILWAY_DEPLOYMENT_ID}"
if [ -n "$ID" ]; then
  SAFE=$(printf '%s' "$ID" | tr -cd 'a-zA-Z0-9' | tr 'A-Z' 'a-z' | cut -c1-12)
  export DATABASE_SCHEMA="arc_${SAFE}"
fi

echo "indexer: DATABASE_SCHEMA=${DATABASE_SCHEMA:-<ponder default>}"
exec ponder start
