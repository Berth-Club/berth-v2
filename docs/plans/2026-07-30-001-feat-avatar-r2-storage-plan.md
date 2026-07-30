---
title: "feat: Move profile avatars to Cloudflare R2 + close profile gaps"
type: feat
status: completed
date: 2026-07-30
origin: docs/brainstorms/2026-07-30-profile-completion-r2-requirements.md
---

# Profile Avatars → Cloudflare R2 + Gap Closure

## Overview
Move profile avatar storage from Pinata/IPFS to Cloudflare R2 (cheaper, and avatars
are mutable app data with no need for content-addressing — coin images stay on Pinata),
and close two gaps in the shipped profile feature: a fresh wallet 404ing on its own `/u`,
and no way to remove an avatar. The render and validation paths currently assume `ipfs://`
only, so both must learn to handle an R2 https URL alongside `ipfs://` (coins + legacy rows).

## Problem Frame
Avatars shipped onto the coin-image pipeline (`/api/pin` → Pinata, served via `/api/img`,
rendered through `ipfsToProxy`). That's the content-addressed store meant for on-chain coin
metadata; for a mutable avatar it costs more and buys nothing. This plan gives avatars their
own cheap object store and fixes the entry-point 404 that breaks the flow for exactly the
new users onboarding targets. (see origin: docs/brainstorms/2026-07-30-profile-completion-r2-requirements.md)

## Requirements Trace
- R2. `/u` renders for a profiled-but-untraded wallet (no 404); chain stats degrade to 0/—.
- R4. Avatars stored in R2; coin images stay on Pinata.
- R5a. Render branches on scheme: `ipfs://` → `/api/img` proxy; R2 https → direct.
- R5b. Write validation accepts an https URL on the R2 host **or** `ipfs://`; rejects arbitrary URLs.
- R5c. R2 public host is a `NEXT_PUBLIC_*` env (validator is shared client-side); secrets stay server-only.
- R6. Replace and remove delete the prior R2 object (not just the DB pointer); removed → glyph.
- R7. Upload endpoint computes the object key server-side; never client-supplied.
- R8. Magic-byte type sniff, SVG rejected; R2 public host has no cookie overlap with the app origin.
- R9. Upload endpoint enforces a max byte size and its own per-wallet rate limit.
- R10. Moderation = delete the R2 object + CDN cache purge; ops-only, no admin UI.

## Scope Boundaries
- Coin images NOT migrated — Pinata only.
- No in-app moderation/admin UI, report queue, or nudges; no new profile fields.
- No forced migration of existing `ipfs://` avatar rows — they keep rendering via the `ipfs://` branch.

## Context & Research

### Relevant Code and Patterns
- **Upload auth pattern:** `app/api/pin/route.ts` + `app/api/profile/route.ts` — `Bearer` → `PrivyClient.verifyAuthToken` → resolve wallet; write only the token's wallet. The avatar route mirrors this and additionally derives the object key from that wallet.
- **Client upload state:** `lib/use-image-upload.ts` (preview/status/error, hits `/api/pin`, returns `ipfs://`). The avatar upload needs the same state shape but a different endpoint + an https-URL result — adapt or add a sibling, do not fork Pinata behavior.
- **Render seam:** `components/user-avatar.tsx` (and `coin-avatar.tsx`) both feed `src` from `ipfsToProxy(image)` (`lib/chain.ts`), which returns null for non-`ipfs://`. The scheme branch lives here; `components/profile-form.tsx` preview has the same `ipfsToProxy(initial?.image)` call.
- **Write validation:** `lib/profile-input.ts` `parseProfileInput` currently rejects any image not starting with `ipfs://`; `httpUrlOrNull` already exists for the social-link host guard and is the model for the R2-host check.
- **Fresh-user 404:** `app/u/[address]/page.tsx` does `if (!captain) notFound()`; `fetchCaptain` (fixed this session to query the wallet directly) returns null for a never-active wallet.
- **Env split:** `lib/server-env.ts` (secrets: `pinataJwt`, `databaseUrl`, `privyAppSecret`) vs `lib/env.ts` (`NEXT_PUBLIC_*`). Public R2 base goes in `env.ts`, R2 secrets in `server-env.ts`.
- **Test convention:** assert-based `*.check.ts` (`profile-input.check.ts`, `profiles.check.ts`), no framework.
- **No CSP, plain `<img>`:** confirmed by review — loading from an external R2 domain needs no `remotePatterns`/CSP change.

### External References
- Cloudflare R2 is S3-compatible; use `@aws-sdk/client-s3` (PutObject/DeleteObject) against the R2 endpoint. Cache purge uses the Cloudflare API. Not researched in depth — standard S3 client usage; confirm exact client options during implementation.

## Key Technical Decisions
- **R2 via `@aws-sdk/client-s3`**: R2 is S3-compatible and the AWS SDK is the well-trodden path from a Node/Railway server. Rationale: no R2-specific SDK lock-in, standard PutObject/DeleteObject.
- **Random, non-enumerable object keys — resolves both deferred questions at once.** Key = `avatars/<opaque-id>.<ext>` (not `<wallet>.<ext>`), bucket listing disabled. This (a) prevents wallet↔avatar enumeration (security review), and (b) makes **replace produce a new URL**, so browsers/CDN never serve a stale avatar and **no cache-busting is needed on replace**. The old object is deleted by parsing its key from the previous `profile.image` URL. Only *moderation* delete (of a URL that was cached) needs a Cloudflare purge.
- **Cookie-less public host (R8)**: the R2 public base URL must be a domain with no app-session cookies (the `r2.dev` URL or a dedicated subdomain that carries no `berth.club` auth cookie), so a served image can never run as same-origin script. Paired with magic-byte sniffing + SVG rejection at upload.
- **Invert, don't replace, the `ipfs://` checks**: render and validation accept both schemes, so existing `ipfs://` avatar rows and all coin images keep working untouched.
- **Delete-old-on-replace, orphan-on-failure accepted**: if the profile write fails after an upload, the new object orphans — acceptable (ops/lifecycle cleanup), same posture as a failed-launch Pinata pin.

## Open Questions

### Resolved During Planning
- Object key scheme + cache-busting → random opaque key; replace mints a new URL (no busting needed); delete parses the key from the stored URL. (see Key Decisions)
- `/u` render condition → render when `captain` OR `profile` is non-null; the address comes from the route param when captain is absent; captain-derived stats render 0/— and rank hides.
- R2 public host env exposure → `NEXT_PUBLIC_R2_PUBLIC_BASE` in `lib/env.ts`; secrets in `lib/server-env.ts`.

### Deferred to Implementation
- Exact max byte size + accepted mime set — mirror what `/api/pin` enforces, then tighten for avatars; settle against the real pin route.
- Whether to resize/normalize server-side (e.g. cap dimensions) — decide when wiring the route; not required for correctness.
- Exact `@aws-sdk/client-s3` client options for R2 (endpoint, region `auto`, forcePathStyle) — confirm against R2 docs during implementation.
- Cloudflare cache-purge call shape (zone + URL) — confirm when the public host/domain is provisioned.

## High-Level Technical Design
> *Directional guidance for review, not implementation specification.*

Avatar image resolution after this change (the load-bearing branch):

```
profile.image value            render path                     write validation
------------------             -----------                     ----------------
"ipfs://Qm…"  (legacy/coin) →  /api/img?cid=Qm…  (proxy)   →   accept (ipfs://)
"https://<r2-host>/avatars/…"→ used directly as <img src>  →   accept iff host === R2 public host
"https://evil.com/x"        → (never stored)               →   REJECT
null                        → generated glyph              →   n/a
```

Upload / replace / remove lifecycle:

```
UPLOAD   POST /api/avatar (Privy) → sniff magic bytes, reject SVG, enforce size+rate
         → PutObject avatars/<opaque>.<ext> → return https URL → form stores it via /api/profile
REPLACE  new upload mints a NEW url; on save, DELETE the old object (key parsed from prior url)
REMOVE   DELETE /api/avatar (own object) + set profile.image = null → glyph
MODERATE (ops) delete object by key + Cloudflare cache purge of its url
```

## Implementation Units

- [x] **Unit 1: `/u` renders for profiled-but-untraded wallets**

**Goal:** A wallet with a profile but no chain activity sees its `/u` instead of a 404.
**Requirements:** R2.
**Dependencies:** None.
**Files:**
- Modify: `apps/web/app/u/[address]/page.tsx`
**Approach:**
- Fetch `profile` (already added) and `captain` in parallel; 404 only when **both** are null.
- When `captain` is null, drive identity from the route address + profile; render chain stats (coins/buys/sells/volume) as 0/— and hide the volume rank. Guard `since(captain.firstSeenAt)` and any `captain.*` access.
**Patterns to follow:** existing null-guards + `short()`/fallback in the same file; `getProfile` already wired in the header.
**Test scenarios:**
- Happy path: address with a profile, no captain row → page renders name/avatar/bio, stats show 0/—, no rank.
- Edge case: address with captain but no profile → unchanged from today (regression guard).
- Edge case: address with neither → still 404.
**Verification:** the wallet-menu "Profile" link resolves for a freshly-onboarded, never-traded wallet.

- [x] **Unit 2: R2 config + client**

**Goal:** A server-side R2 client and the env plumbing, with no behavior change yet.
**Requirements:** R4, R5c, R8 (host).
**Dependencies:** None.
**Files:**
- Create: `apps/web/lib/r2.ts` (put/delete/publicUrl helpers over `@aws-sdk/client-s3`)
- Modify: `apps/web/lib/server-env.ts` (R2 endpoint, access key, secret, bucket)
- Modify: `apps/web/lib/env.ts` (`NEXT_PUBLIC_R2_PUBLIC_BASE`)
- Modify: `apps/web/package.json` (`@aws-sdk/client-s3`)
**Approach:**
- `lib/r2.ts`: lazily construct the S3 client (mirroring `lib/comments.ts`/`pin-image.ts` lazy-singleton + graceful "not configured" when env absent); expose `putAvatar(bytes, contentType) → { url, key }`, `deleteAvatarByUrl(url)`, and a `publicUrlFor(key)`. Keys are `avatars/<opaque-id>.<ext>`.
- Env: public base in `env.ts`; secrets in `server-env.ts`; degrade to "avatars unavailable" when unset (do not crash).
**Patterns to follow:** `lib/pin-image.ts` (lazy client, throws/degrades on missing config), env split in `lib/server-env.ts` vs `lib/env.ts`.
**Test scenarios:**
- Test expectation: none — thin config/client wiring with no branching logic; exercised via Unit 3's route + validation checks.
**Verification:** `pnpm --filter web typecheck` clean; helpers importable; missing env degrades rather than throws at import.

- [x] **Unit 3: Avatar upload + delete route (auth, validation, key, purge)**

**Goal:** An owner-authenticated endpoint to upload and delete an avatar, safely.
**Requirements:** R6 (delete), R7, R8, R9, R10 (purge).
**Dependencies:** Unit 2.
**Files:**
- Create: `apps/web/app/api/avatar/route.ts` (POST upload, DELETE remove)
- Create: `apps/web/lib/avatar-input.ts` (pure: magic-byte sniff → mime/ext, SVG reject, size check)
- Create: `apps/web/lib/avatar-input.check.ts`
**Approach:**
- POST: Privy `Bearer` → `verifyAuthToken` → resolve wallet (copy `/api/profile`); read the file; **sniff magic bytes** via `avatar-input` (PNG/JPEG/WEBP/GIF only, **reject SVG and anything whose bytes don't match**, ignore client Content-Type); enforce max byte size and reject over-limit; compute key server-side (`avatars/<opaque>.<ext>` — client never supplies it); `putAvatar`; return the public https URL.
- DELETE: auth → delete the object whose URL the caller passes **only if it is on the R2 host** (and, for self-delete, belongs to the wallet — but keys are opaque, so gate on "caller owns the profile whose image == this url"); this is the owner remove path (R6). Moderation delete is ops-side (out of app) + a Cloudflare purge helper the route also calls on delete.
- Rate-limit uploads per wallet, separate from the profile-write limiter (reuse the counter pattern from `lib/comments.ts` `recentCommentCount`, or a small in-memory/DB counter — decide in impl).
**Execution note:** Start with a failing check for `avatar-input` (magic-byte accept/reject incl. SVG) before wiring the route.
**Patterns to follow:** `app/api/pin/route.ts` (multipart + auth), `app/api/profile/route.ts` (token→wallet), `lib/profile-input.ts`/`.check.ts` (pure validator + assert check), `lib/comments.ts` rate-limit counter.
**Test scenarios (avatar-input):**
- Happy path: valid PNG/JPEG/WEBP/GIF magic bytes → accepted with correct ext.
- Error path: SVG (`<svg`/`<?xml`) bytes → rejected even if Content-Type says image/png.
- Error path: bytes over the size cap → rejected.
- Edge case: empty/truncated/non-image bytes → rejected, no throw.
**Test scenarios (route — where feasible without live Privy):**
- Error path: POST without token → 401; DELETE without token → 401.
- Integration (manual/with token): upload returns an R2-host https URL; DELETE removes the object and the URL 404s.
- Security (by construction, assert in review): the stored key is derived server-side, not from the request body.
**Verification:** uploading a real PNG returns a working R2 URL; an SVG is rejected; an oversize file is rejected; delete makes the URL 404.

- [x] **Unit 4: Render + write-validate branching (ipfs vs R2 https)**

**Goal:** R2 https avatars render as images and pass write validation; `ipfs://` (coins/legacy) still work.
**Requirements:** R5a, R5b.
**Dependencies:** Unit 2 (needs the R2 public host env).
**Files:**
- Modify: `apps/web/components/user-avatar.tsx` (scheme branch for `src`)
- Modify: `apps/web/components/profile-form.tsx` (preview `src` same branch)
- Modify: `apps/web/lib/profile-input.ts` (`image` valid if `ipfs://` OR https on R2 host)
- Modify: `apps/web/lib/profile-input.check.ts`
- Consider: a shared `avatarSrc(image)` helper in `lib/chain.ts` next to `ipfsToProxy`, used by user-avatar + profile-form (and coin-avatar unaffected since coins stay ipfs).
**Approach:**
- Render: `image` starting `ipfs://` → `ipfsToProxy(image)`; an https URL on the R2 host → used directly; anything else → null → glyph.
- Validate: extend `parseProfileInput` image rule — accept `ipfs://…` (legacy/coins) or an https URL whose host === `NEXT_PUBLIC_R2_PUBLIC_BASE` host (reuse the `httpUrlOrNull` model); reject everything else with `bad_image`.
**Patterns to follow:** existing `ipfsToProxy` + `httpUrlOrNull`; the current `profile-input.check.ts` structure.
**Test scenarios (profile-input):**
- Happy path: `image` = an https URL on the R2 host → accepted.
- Happy path: `image` = `ipfs://Qm…` → still accepted (legacy/coin).
- Error path: `image` = https on a non-R2 host → `bad_image`.
- Error path: `image` = `javascript:`/arbitrary string → `bad_image` (regression on the existing guard).
**Test scenarios (render helper, if extracted):**
- `avatarSrc("ipfs://x")` → `/api/img?cid=x`; `avatarSrc("https://<r2>/a.png")` → same string; `avatarSrc("https://evil/a")` → null; `avatarSrc(null)` → null.
**Verification:** an R2-host avatar renders as the image on `/u`, chat, token, holders; an `ipfs://` avatar and all coin images are unchanged.

- [x] **Unit 5: ProfileForm uploads to R2 + remove control**

**Goal:** The edit/onboarding form uploads to R2 and can remove the avatar.
**Requirements:** R5, R6.
**Dependencies:** Units 3, 4.
**Files:**
- Modify: `apps/web/components/profile-form.tsx`
- Possibly: `apps/web/lib/use-avatar-upload.ts` (a sibling of `use-image-upload` that targets `/api/avatar` and yields an https URL) — only if adapting `use-image-upload` cleanly proves awkward.
**Approach:**
- Swap the avatar upload from `/api/pin` (Pinata → `ipfs://`) to `/api/avatar` (R2 → https URL), reusing the preview/status/error UX.
- Add a **Remove avatar** control (shown when an image exists): clears the field and calls `DELETE /api/avatar`, so save persists `image = null` → glyph.
- On replace/save, delete the previously-stored object (the form knows `initial.image`); the new upload already minted a fresh URL, so no cache concern.
**Patterns to follow:** current `profile-form.tsx` upload usage; `use-image-upload.ts` state shape.
**Test scenarios:**
- Happy path: pick a PNG → preview → save → `/u` shows the R2 avatar.
- Happy path: Remove → save → reverts to glyph; the old R2 URL 404s.
- Edge case: SVG/oversize pick → inline error, no submit (server also rejects).
- Edge case: viewer ≠ owner → no form (unchanged from shipped gating).
**Verification:** set, replace, and remove all work end-to-end with a connected wallet; old objects are deleted on replace/remove.

## System-Wide Impact
- **Interaction graph:** new `/api/avatar` route; `UserAvatar`/`profile-form` render branch; `profile-input` validation branch; `/u` render condition. Coin rendering (`coin-avatar.tsx` → still `ipfs://`) and `/api/pin` (coins) untouched.
- **Error propagation:** R2 unconfigured → uploads degrade to "unavailable" (like the Pinata/DB degrade), never a crash; render falls back to glyph on any non-resolvable `image`.
- **State lifecycle risks:** orphaned R2 object if the profile write fails after upload (accepted); moderation delete must pair object-delete with CDN purge or the cached URL keeps serving (R10).
- **API surface parity:** avatar write auth must match `/api/profile` exactly (token→wallet, key server-derived) or it becomes an overwrite/spoof surface.
- **Unchanged invariants:** coin images stay on Pinata/IPFS and render through `/api/img`; existing `ipfs://` profile rows keep working via the render/validate branch; `@workspace/contracts` and the indexer are untouched.

## Risks & Dependencies
| Risk | Mitigation |
|------|------------|
| SVG-as-image stored XSS on the app origin | Magic-byte sniff + reject SVG (U3); serve R2 from a cookie-less host (U2 config). |
| Auth without authz — overwrite another wallet's avatar | Key derived server-side from the token wallet; client never supplies it (U3, R7). |
| "Remove"/moderation leaves the object live at its URL | Delete the R2 object (not just the DB pointer); moderation delete + Cloudflare purge (U3, R10). |
| R2 avatars silently render as glyph / writes 422 | The render + validate branches (U4) are the load-bearing fix; covered by checks. |
| Upload cost/DoS abuse | Hard size cap + per-wallet upload rate limit, separate from profile-write limit (U3, R9). |
| Existing `ipfs://` rows break on migration | Accept both schemes on read + write; no forced migration (U4, scope). |
| Missing R2 credentials in an env | Degrade to "avatars unavailable"; feature-flag by env presence (U2). |

## Documentation / Operational Notes
- New env vars (R2 endpoint/account, access key, secret, bucket, `NEXT_PUBLIC_R2_PUBLIC_BASE`) must be set on Railway before the upload path works; the public host must be a **cookie-less** domain.
- Add a one-line **moderation runbook**: to take down an avatar, delete the object by the key parsed from `profile.image`, then Cloudflare-purge that URL (and/or null the profile row for an instant glyph fallback).
- Bucket: disable public listing; set avatar cache-control (long is fine given random keys; purge on moderation delete).

## Sources & References
- **Origin document:** [docs/brainstorms/2026-07-30-profile-completion-r2-requirements.md](../brainstorms/2026-07-30-profile-completion-r2-requirements.md)
- Related code: `app/api/pin/route.ts`, `app/api/profile/route.ts`, `lib/use-image-upload.ts`, `lib/profile-input.ts`, `components/user-avatar.tsx`, `lib/chain.ts` (`ipfsToProxy`), `app/u/[address]/page.tsx`
- Base branch: `feat/profile-image-fixes`
