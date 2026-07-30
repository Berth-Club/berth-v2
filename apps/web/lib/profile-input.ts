/**
 * Validation for a profile write. Pure (no DB, no server-only) so it can be unit
 * checked directly and shared by the API route. A profile write always submits
 * every field; an empty field means "cleared" and is stored as null.
 */
import { env } from "@/lib/env"

export const NAME_MAX = 32
export const BIO_MAX = 160

export type ProfileInput = {
  name: string | null
  bio: string | null
  social: string | null
  image: string | null
}

export type ParseResult =
  | { ok: true; data: ProfileInput }
  | { ok: false; code: string; message: string }

const clean = (v: unknown): string => (typeof v === "string" ? v.trim() : "")
const orNull = (s: string): string | null => (s === "" ? null : s)

/**
 * The string back iff it's an http(s) URL, else null. Used both to validate a
 * submitted social link AND to guard it at render time — a stored value must
 * never be trusted as an href (a `javascript:` scheme would be an XSS vector),
 * even though writes are validated, because a pre-validation or out-of-band row
 * could carry one.
 */
export function httpUrlOrNull(s: string | null | undefined): string | null {
  if (!s) return null
  try {
    const u = new URL(s)
    return u.protocol === "http:" || u.protocol === "https:" ? s : null
  } catch {
    return null
  }
}

function isHttpUrl(s: string): boolean {
  return httpUrlOrNull(s) !== null
}

export function parseProfileInput(raw: unknown): ParseResult {
  const o = (raw ?? {}) as Record<string, unknown>
  const name = clean(o.name)
  const bio = clean(o.bio)
  const social = clean(o.social)
  const image = clean(o.image)

  if (name.length > NAME_MAX) {
    return { ok: false, code: "name_too_long", message: `Keep your name under ${NAME_MAX} characters.` }
  }
  if (/https?:\/\//i.test(name)) {
    return { ok: false, code: "name_has_link", message: "Links aren't allowed in your name." }
  }
  if (bio.length > BIO_MAX) {
    return { ok: false, code: "bio_too_long", message: `Keep your bio under ${BIO_MAX} characters.` }
  }
  if (social && !isHttpUrl(social)) {
    return { ok: false, code: "bad_social", message: "Your link must be a valid http(s) URL." }
  }
  if (image && !isStorableImage(image, env.r2PublicBase)) {
    return { ok: false, code: "bad_image", message: "That image reference isn't valid." }
  }

  return { ok: true, data: { name: orNull(name), bio: orNull(bio), social: orNull(social), image: orNull(image) } }
}

/**
 * A profile image is only accepted as `ipfs://…` (legacy avatars + coin CIDs) or
 * an https url on OUR R2 host — never an arbitrary url. The trailing `/` guard
 * defeats the prefix trick (`https://r2host.evil.com/…`). Pure (base passed in)
 * so it's unit-checkable without env.
 */
export function isStorableImage(image: string, r2Base: string): boolean {
  if (image.startsWith("ipfs://")) return true
  return !!r2Base && image.startsWith(r2Base + "/")
}
