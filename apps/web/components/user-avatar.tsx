"use client"

import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"
import { avatarSrc } from "@/lib/chain"

/**
 * A wallet's face. Renders the user's uploaded avatar (`image` = `ipfs://CID`)
 * when set, and falls back to a deterministic nautical glyph disc otherwise —
 * for wallets with no profile, and if the image fails to load. Same shape as
 * `CoinAvatar`, but the fallback is per-address, not a coin emoji.
 */

const GLYPHS = ["⚓", "🌊", "⛵", "🐚", "🦑", "🐙", "🦀", "🧭", "🪝", "🐠", "🐳", "🫧"]

/** Deterministic glyph for an address — same address always gets the same one. */
export function glyphFor(seed: string): string {
  let h = 0
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return GLYPHS[h % GLYPHS.length]!
}

/** `0x1234…abcd`, the source-of-truth identity shown next to any name. */
export function shortAddress(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a
}

export function UserAvatar({
  address,
  image,
  size = 28,
  className,
  style,
}: {
  address: string
  image?: string | null
  size?: number
  className?: string
  style?: React.CSSProperties
}) {
  const src = avatarSrc(image)
  const [failedSrc, setFailedSrc] = React.useState<string | null>(null)
  const showImage = !!src && failedSrc !== src

  return (
    <span
      className={cn("relative grid shrink-0 place-items-center overflow-hidden rounded-full", className)}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.46,
        background: "#0b1929",
        border: "1px solid rgba(148,168,196,.2)",
        ...style,
      }}
      aria-hidden={showImage ? undefined : true}
    >
      {showImage ? (
        // Plain <img>, like CoinAvatar: untrusted user upload from an IPFS
        // gateway, so it must not go through the next/image optimizer.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          className="size-full object-cover"
          onError={() => setFailedSrc(src)}
        />
      ) : (
        glyphFor(address)
      )}
    </span>
  )
}
