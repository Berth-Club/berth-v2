---
title: "feat: User profile identity (avatar, name, bio) + onboarding step"
type: feat
status: completed
date: 2026-07-29
origin: docs/brainstorms/2026-07-29-profile-identity-requirements.md
---

# User Profile Identity + Onboarding Step

## Overview
Give authenticated wallets an editable identity — avatar, display name, bio, and
one social/X link — persisted off-chain, and surface it wherever a user shows up
today (profile page, chat, "by <creator>" attribution, holders lists), replacing
the generated-avatar + `0x…` string. A one-time, skippable onboarding step
invites setup after first login without ever blocking a trade.

## Problem Frame
Every user renders as a generated avatar + truncated address; the app has no
editable identity (everything is chain/indexer-derived). This makes chat and
creator attribution feel anonymous, which hurts the social loop that drives a
memecoin launchpad. (see origin: docs/brainstorms/2026-07-29-profile-identity-requirements.md)

## Requirements Trace
- R1. Profile = avatar, display name, bio, one social link; each field optional.
- R2. Names free-form, non-unique; short address stays visible as source of truth.
- R3. Avatar upload reuses the existing image-upload → IPFS/Pinata path.
- R4. One-time skippable profile step after first login; never blocks the app.
- R5. Skipping keeps the derived identity; step does not reappear every login.
- R6–R9. Identity replaces address+generated-avatar on /u, chat, creator attribution, holders.
- R10. Batch identity resolution (many addresses per surface); clean fallback when unset.
- R11. Editable anytime from the owner's /u page.
- R12. Only the wallet owner (Privy-authenticated) can edit their own profile.
- R13. Minimum validation: name/bio length caps, no link in name, single URL field, image size/type limits.

## Scope Boundaries
- No unique handles / @mention registry (R2).
- No automated content-moderation pipeline beyond basic validation (R13).
- No on-chain/ENS identity; off-chain app data only.
- No follows, social graph, DMs, notifications.
- Wallets that never authenticated keep the derived identity (no profile row).

## Context & Research

### Relevant Code and Patterns
- **Store + access pattern:** `lib/comments.ts` — `db()` helper over Railway
  Postgres (Drizzle/postgres-js), graceful degrade when `DATABASE_URL` unset.
  Mirror this for profiles.
- **Schema:** `lib/db/schema.ts` (`coinComments`). Add a `userProfiles` table
  here. Migrations run via `pnpm --filter web db:migrate` (drizzle-kit), never
  at runtime; `drizzle.config.ts` `tablesFilter` isolates the app's tables from
  the indexer's.
- **Edit auth:** `app/api/comments/route.ts` — `Bearer` token →
  `PrivyClient.verifyAuthToken(token)` → resolve the signed-in wallet. Reuse
  verbatim for profile writes.
- **Avatar seam:** `components/coin-avatar.tsx` — `ipfs://` → `ipfsToProxy`,
  plain `<img>` (untrusted IPFS content), emoji fallback on error. User avatar
  is the same shape with a generated-avatar fallback instead of emoji.
- **Image upload:** `lib/use-image-upload.ts` + `lib/pin-image.ts` (Pinata),
  as used by `components/launch-wizard.tsx`. Reuse the hook in the profile form.
- **Test convention:** assert-based `*.check.ts` self-checks (e.g.
  `lib/comments.check.ts`), not a framework.

### Institutional Learnings
- Contract addresses/ABIs are off-limits here (this feature is off-chain only);
  no `@workspace/contracts` interaction. Nothing in `docs/solutions/` matched.

## Key Technical Decisions
- **Reuse the comments Postgres, one new `user_profiles` table** keyed by
  lowercased wallet address: the store, connection helper, and degrade behavior
  already exist. No new infra. Rationale: R10 needs a public by-address lookup;
  Privy metadata can't serve arbitrary addresses.
- **Enrich comments at read time with author identity** rather than a separate
  client fetch: `listComments` already snapshots per-author data (`balance`), so
  add a batched profile lookup over distinct authors in the same call. Keeps chat
  identity server-resolved, one extra query per load (R7, R10).
- **Server surfaces batch-resolve via `getProfiles(addresses[])`** — the Harbor,
  token page, and holders lists already fetch their address sets server-side, so
  one `WHERE wallet IN (…)` join-free lookup avoids N+1 (R6, R8, R9, R10).
- **Single reusable `ProfileForm`** used by both the /u edit view and the
  onboarding modal, so R4/R11 share one implementation.
- **Onboarding "seen" is client-local** (localStorage flag) plus "has a profile
  row" — avoids a server round-trip to decide whether to show the step, and
  naturally never re-nags after skip or save (R5).

## Open Questions

### Resolved During Planning
- Where do profiles persist? → the comments Railway Postgres, new table (see decisions).
- How to gate edits to the owner? → the comments route's Privy `verifyAuthToken` → resolved wallet.
- How does chat get identity without N+1? → enrich `listComments` with a batched author-profile lookup.

### Deferred to Implementation
- Exact Drizzle column types/index names for `user_profiles` — settle against the real schema file.
- Whether holders list is server- or client-rendered at the injection point — confirm when wiring Unit 3; if client, add its address set to the batch endpoint.
- Minimum image size/type limits — mirror whatever `pin-image.ts`/launch already enforces rather than inventing new caps.

## Implementation Units

- [x] **Unit 1: `user_profiles` table + data access**

**Goal:** Persist and read profiles by wallet address, with batch lookup.
**Requirements:** R1, R2, R10.
**Dependencies:** None.
**Files:**
- Modify: `apps/web/lib/db/schema.ts` (add `userProfiles`)
- Create: `apps/web/lib/profiles.ts` (`getProfile`, `getProfiles`, `upsertProfile`)
- Create: `apps/web/lib/profiles.check.ts`
- Migration: generated via drizzle-kit into the existing migrations dir
**Approach:**
- Table keyed by lowercased `wallet` (PK/unique); columns for name, bio, social
  link, image (`ipfs://CID`), timestamps. All content columns nullable (R1).
- `lib/profiles.ts` mirrors `lib/comments.ts`: shared `db()` helper, lowercase
  the address on read/write, degrade to empty/no-op when `DATABASE_URL` unset.
- `getProfiles(addrs)` = one `WHERE wallet IN (…)` returning a map (R10).
**Patterns to follow:** `lib/comments.ts`, `lib/db/schema.ts` (`coinComments`).
**Test scenarios:**
- Happy path: `upsertProfile` then `getProfile` round-trips all fields; address normalized to lowercase.
- Edge case: `getProfile` for an unknown wallet → null (not an error).
- Edge case: `getProfiles([])` and mixed known/unknown addresses → map contains only known, keys lowercased.
- Edge case: `upsertProfile` twice for same wallet → updates in place, no duplicate row.
- Error path: `DATABASE_URL` unset → reads return empty/null, writes no-op, no throw.
**Verification:** self-check passes; a migration file exists that creates only the app table (indexer schema untouched).

- [x] **Unit 2: Profile API (public read, auth'd write) + validation**

**Goal:** Public GET by address(es); owner-only upsert.
**Requirements:** R11, R12, R13, R10.
**Dependencies:** Unit 1.
**Files:**
- Create: `apps/web/app/api/profile/route.ts`
- Create: `apps/web/app/api/profile/route.check.ts` (or extend `lib/profiles.check.ts` for validation)
**Approach:**
- GET `?address=` (single) or `?addresses=a,b,c` (batch) → public read via `getProfiles`.
- POST/PUT: require `Authorization: Bearer <privy token>`, `verifyAuthToken` →
  resolve signed-in wallet, and **only** upsert that wallet's row (ignore any
  address in the body). Copy the pattern from `app/api/comments/route.ts`.
- Validation (R13): trim; name ≤ cap and contains no URL; bio ≤ cap; social is a
  single valid http(s) URL or empty; image must be `ipfs://…` or empty. Reject
  with 422 + message on violation (mirror comments' error shape).
**Patterns to follow:** `app/api/comments/route.ts` (auth, error JSON shape, degrade).
**Test scenarios:**
- Happy path: valid token + valid body → row upserted for the resolved wallet; response echoes stored profile.
- Error path: missing/invalid token → 401.
- Error path (security): body names a different wallet than the token → still writes only the token's wallet, never the body's.
- Error path: name over cap / name containing a URL / bio over cap / non-URL social / non-`ipfs://` image → 422 each with a clear message.
- Happy path: GET batch returns a map for known addresses and omits unknown ones.
**Verification:** unauthorized writes rejected; a signed-in user can only mutate their own row; malformed input 422s.

- [x] **Unit 3: `UserAvatar` / `UserIdentity` + wire into all surfaces**

**Goal:** Render profile avatar+name (fallback to generated avatar + short address) everywhere a user appears.
**Requirements:** R6, R7, R8, R9, R10, R2.
**Dependencies:** Unit 1 (server surfaces), Unit 2 (chat enrichment).
**Files:**
- Create: `apps/web/components/user-avatar.tsx` (and a small `UserIdentity` for avatar+name+short-addr)
- Modify: `apps/web/lib/comments.ts` (`listComments` attaches distinct-author profile via `getProfiles`)
- Modify: `apps/web/components/coin-comments.tsx` (render `UserIdentity` from enriched comment)
- Modify: `apps/web/components/harbor-grid.tsx` / coin card + `app/token/[address]/page.tsx` (creator attribution) + holders list component
- Modify: `apps/web/app/u/[address]/page.tsx` (show own profile header)
**Approach:**
- `UserAvatar` mirrors `CoinAvatar`: `ipfsToProxy(image)` → plain `<img>`, fallback
  to the existing generated avatar on null/error. `UserIdentity` = avatar + name
  (or short address) with the short `0x…` always shown (R2).
- Server surfaces: the page already loads its address set → call
  `getProfiles(distinctAddrs)` once, pass the map down (R10). Fallback per-address
  when absent.
- Chat: consume the profile fields now included on each comment from Unit 2's
  enrichment; no extra client call.
**Patterns to follow:** `components/coin-avatar.tsx` (image/fallback), the coins→cards prop-drilling already used in `harbor-grid.tsx`.
**Test scenarios:**
- Happy path: address with a profile → avatar image + name render; short address still present.
- Edge case: address without a profile → generated avatar + short address, no layout shift.
- Edge case: profile image fails to load → falls back to generated avatar (mirror CoinAvatar's failed-src logic).
- Integration: `listComments` returns author name/image for authors who have profiles and nulls for those who don't, in one batched lookup (assert in `lib/comments.check.ts`).
**Verification:** on a surface with mixed users, profiled users show identity and unprofiled users show the old identity; no N+1 (single profile query per surface load).

- [x] **Unit 4: `ProfileForm` + edit from /u**

**Goal:** Owner can create/edit their profile from their /u page.
**Requirements:** R1, R3, R11, R12.
**Dependencies:** Units 2, 3.
**Files:**
- Create: `apps/web/components/profile-form.tsx`
- Modify: `apps/web/app/u/[address]/page.tsx` (show Edit affordance when viewer == owner)
**Approach:**
- `ProfileForm`: avatar upload via `use-image-upload` (same UX as launch-wizard),
  name/bio/social fields with the Unit 2 caps enforced client-side too; submits to
  `/api/profile` with the Privy bearer token.
- On /u, show Edit only when the connected wallet matches the page address; open
  the form (inline or modal) prefilled from the current profile.
**Patterns to follow:** `components/launch-wizard.tsx` image-upload usage; the comments client's token-attach for authorized POSTs.
**Test scenarios:**
- Happy path: owner edits name + uploads avatar → save → /u reflects it after refetch.
- Edge case: viewer != owner → no Edit affordance shown.
- Error path: oversize/invalid image or over-cap name → inline error, no submit (server still enforces).
**Verification:** owner can round-trip an edit; non-owners see read-only.

- [x] **Unit 5: One-time skippable onboarding step**

**Goal:** After first login, invite profile setup once, skippable, never blocking.
**Requirements:** R4, R5.
**Dependencies:** Unit 4 (reuses `ProfileForm`).
**Files:**
- Create: `apps/web/components/onboarding-profile.tsx` (modal wrapping `ProfileForm` + Skip)
- Modify: a top-level client mount point (e.g. `components/providers.tsx` child or the app shell) to trigger it on `authenticated`
**Approach:**
- Trigger when Privy reports `authenticated`, there's no local "onboarded" flag,
  and the user has no profile row yet. Show the modal; Skip or Save both set the
  local flag so it never reappears (R5). Modal is dismissible and blocks nothing.
**Patterns to follow:** existing Privy `usePrivy`/`authenticated` usage in the app shell.
**Test scenarios:**
- Happy path: fresh login with no profile → modal appears once; Save persists and closes; reload does not re-show.
- Edge case: Skip → closes, flag set, does not reappear next login.
- Edge case: user who already has a profile → modal never shows.
- Integration: modal open/closed never gates navigation or trading (assert it's non-blocking UI).
**Verification:** appears exactly once for new users; skipping or saving suppresses it; trading is reachable with the modal dismissed.

## System-Wide Impact
- **Interaction graph:** new `/api/profile` route; `listComments` gains a profile
  lookup; several render surfaces gain a `getProfiles` call. No change to
  chain/indexer reads.
- **Error propagation:** profile store degrades like comments (missing DB →
  empty/no-op), so every surface must fall back to the derived identity, never error.
- **State lifecycle risks:** avatar images are pinned to IPFS on upload; an
  orphaned pin on a failed save is acceptable (same as launches). Onboarding flag
  is client-local, so clearing storage re-nags once — acceptable.
- **API surface parity:** write auth must match comments exactly (token → resolved
  wallet), or profiles become a spoofing surface.
- **Unchanged invariants:** indexer tables and `@workspace/contracts` untouched;
  existing coin avatars (`CoinAvatar`) unaffected — this adds a parallel
  `UserAvatar`, it does not modify coin rendering.

## Risks & Dependencies
| Risk | Mitigation |
|------|------------|
| Write endpoint spoofing (set someone else's profile) | Only ever upsert the token-resolved wallet; ignore body address (Unit 2). |
| N+1 profile lookups on card/holder grids | Batch `getProfiles(addresses[])` once per surface (Unit 3). |
| Public user images/names as an abuse surface | Basic validation now (R13); same IPFS-consent posture as launches; heavier moderation explicitly out of scope. |
| Migration touching indexer tables | Use existing drizzle-kit flow + `tablesFilter` rail; app tables only. |
| Onboarding friction hurting activation | Step is skippable and non-blocking by construction (Unit 5). |

## Documentation / Operational Notes
- Run `pnpm --filter web db:migrate` on deploy for the new table (same as comments).
- No new env vars — reuses `DATABASE_URL` and the existing Privy app id/secret.

## Sources & References
- **Origin document:** [docs/brainstorms/2026-07-29-profile-identity-requirements.md](../brainstorms/2026-07-29-profile-identity-requirements.md)
- Related code: `lib/comments.ts`, `lib/db/schema.ts`, `app/api/comments/route.ts`, `components/coin-avatar.tsx`, `lib/use-image-upload.ts`, `components/launch-wizard.tsx`
