---
date: 2026-07-30
topic: profile-completion-r2
---

# Profile Feature — Gap Closure + R2 Avatar Storage

Follow-up to [2026-07-29-profile-identity-requirements.md](./2026-07-29-profile-identity-requirements.md).
The core feature shipped on `feat/profile-image-fixes`. This closes two review gaps and
moves avatar storage to Cloudflare R2.

## Problem Frame
Avatars are an **app** feature — mutable user data — but they shipped onto the coin-image
pipeline (Pinata/IPFS), which is the **content-addressed** store meant for on-chain coin
metadata (a coin's image CID feeds its CREATE2 metadataURI). That's the wrong tool for an
avatar: IPFS pinning costs more than plain object storage, and content-addressing /
immutability buy an avatar nothing — only coin images need it. Move avatars to Cloudflare
R2 (cheap, S3-compatible, zero egress); coins stay on Pinata. Separately, two shipped gaps:
a freshly-onboarded wallet with no trades 404s on its own `/u`, and avatars can't be removed.

## Requirements

**Profile entry & fresh-user access**
- R1. *(Shipped)* A "Profile" link in the wallet menu opens `/u/<connected wallet>`.
- R2. `/u` renders when the wallet has a profile **or** chain activity; a profiled-but-untraded wallet shows its profile with chain stats reading 0/—, never a 404.

**Onboarding recovery**
- R3. Onboarding stays once-only and skippable; recovery is the wallet-menu Profile link → `/u` → Edit. No nudge/badge/re-prompt.

**Avatar storage on R2**
- R4. Profile avatars are stored in Cloudflare R2; coin images stay on Pinata (they need content-addressing; avatars don't).
- R5. `profile.image` holds an https URL on the app's R2 public host.
  - R5a. **Render branches on scheme** — `ipfs://` goes through the existing `/api/img` proxy (coins + any legacy avatar rows); an R2 https URL renders directly. *(Today `ipfsToProxy` returns null for non-`ipfs://`, so an R2 URL would silently render as the glyph — this branch is mandatory, in the shared `UserAvatar` and the edit preview.)*
  - R5b. **Write validation accepts** an https URL on the R2 host **or** `ipfs://` (legacy/coins), rejecting arbitrary URLs. *(Today the validator hard-rejects any non-`ipfs://` image, so R2 writes would 422 — it must be inverted, not replaced.)*
  - R5c. The R2 public host is a `NEXT_PUBLIC_*` env (the validator is shared client-side); bucket/key/secret stay server-only.

**Avatar actions**
- R6. A user can replace and remove their own avatar. Remove/replace **deletes the prior R2 object** (not just the DB pointer) so the public URL stops serving; removed → glyph.

**Security (new upload surface)**
- R7. The upload endpoint resolves the owner via Privy and **computes the object key server-side from that wallet** — never client-supplied — so no one can write another wallet's key.
- R8. Uploads are validated by **magic-byte sniffing (not extension/Content-Type)** and **SVG is rejected**; the R2 public host has **no cookie/session overlap** with the app origin (separate domain, or forced safe Content-Type + attachment) to prevent stored XSS from an image.
- R9. The upload endpoint enforces a hard **max byte size** (reject without buffering the whole body) and its **own per-wallet rate limit**, separate from the profile-write limit.

**Moderation**
- R10. Abusive avatars are removed by ops deleting the R2 object **plus a CDN cache purge** (R2 public buckets are edge-cached; avatars use short/versioned cache-control, not `immutable`, so takedown actually takes effect). No in-app admin UI this pass. Note: a per-wallet `hidden`/null lever already exists (nulling `image` → glyph) as an instant secondary kill-switch.

## Success Criteria
- A wallet that onboards and never trades can click "Profile" and see + edit its own page (no 404).
- Setting, replacing, and removing an avatar all work; a removed avatar reverts to the glyph everywhere, and its R2 URL 404s.
- Avatars serve from R2 at lower cost than the Pinata path; coin-launch behavior is unchanged.
- An R2 avatar renders as the image (not the glyph) and an R2 write succeeds (not 422) — i.e. the render/validate branches are in.

## Scope Boundaries
- Coin images are NOT migrated — Pinata only.
- No in-app moderation dashboard, report queue, or admin UI.
- No onboarding nudges; no new profile fields.
- No forced migration of existing `ipfs://` avatar rows — they keep working via the `ipfs://` render/validate branch until re-uploaded.

## Key Decisions
- **R2 for avatars, Pinata for coins — right tool per data type.** Avatars are mutable app data: cheaper on R2 (no egress), and content-addressing is pointless for them. Coin images need content-addressing for CREATE2 metadata, so they stay on IPFS.
- **R2 over S3**: S3-compatible, zero egress, cheap, works from Railway.
- **Deletability is a bonus, not the driver.** Cost + correct separation drive this; that R2 objects are deletable (unlike re-pinnable IPFS) is a secondary win, and it only matters paired with a cache purge (R10).
- **Invert, don't replace, the ipfs checks.** Render and validation must accept both `ipfs://` (legacy/coins) and R2 https, so nothing already stored breaks.

## Dependencies / Assumptions
- Requires a provisioned R2 bucket + credentials: endpoint/account, access key, secret, bucket name, and a **public base URL** (as `NEXT_PUBLIC_*`). Supplied as env vars before the upload path works. Ops task.
- Base branch: `feat/profile-image-fixes`.

## Outstanding Questions

### Deferred to Planning
- [Affects R5/R6][Technical] Object key scheme — **non-enumerable** (wallet + opaque suffix stored in DB, bucket listing disabled) yet **deterministically deletable** on replace/remove; and the cache-busting mechanism (versioned key vs `?v=`).
- [Affects R2][Technical] Exact `/u` render condition and how the header/stats degrade when only a profile (no captain row) exists.
- [Affects R8/R9][Needs research] Concrete size/type limits and where magic-byte sniffing runs (route vs. a lib); whether to resize/normalize server-side.
- [Affects R8][Technical] Whether the R2 public host is a separate domain or the same with forced Content-Type — decides the XSS posture.

## Next Steps
→ `/ce:plan` — extend `feat/profile-image-fixes`.
