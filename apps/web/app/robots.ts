import type { MetadataRoute } from "next"
import { headers } from "next/headers"

import { isOffCanonicalHost } from "@/lib/canonical-host"

/**
 * Allow-all on berth.club, disallow-all on every other hostname the app answers
 * on (notably the public Railway domain, which serves byte-identical content).
 * See `lib/canonical-host.ts` for the host rule and its fail-open guarantee.
 *
 * Reading a header makes this a dynamic route instead of a cached one, which is
 * what lets the answer depend on the host at all.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const offCanonical = isOffCanonicalHost((await headers()).get("host"))

  return {
    rules: offCanonical ? { userAgent: "*", disallow: "/" } : { userAgent: "*", allow: "/" },
  }
}
