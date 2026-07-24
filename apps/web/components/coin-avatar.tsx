"use client"

import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"
import { ipfsToGateway } from "@/lib/chain"

/**
 * A coin's face. Renders the creator's uploaded art (`image` = `ipfs://CID`)
 * when present, and falls back to the emoji tile otherwise — for coins with no
 * upload, and if the image fails to load.
 *
 * `image` is passed raw (the `ipfs://` value off the coin); non-`ipfs://` values
 * resolve to null and render the emoji, so existing coins are unaffected.
 * `size` (px) owns the box + emoji sizing; `className`/`style` carry each call
 * site's tile look (background, rounding, border).
 */
export function CoinAvatar({
  image,
  emoji,
  name,
  ticker,
  size = 44,
  className,
  style,
}: {
  image?: string | null
  emoji: string
  name?: string
  ticker?: string
  size?: number
  className?: string
  style?: React.CSSProperties
}) {
  const src = ipfsToGateway(image)
  // Track WHICH src failed (not a bare boolean) so a new/changed image gets a
  // fresh attempt without an effect to reset it. A slow gateway shows the tile
  // background until the img paints; a real load failure flips to the emoji.
  const [failedSrc, setFailedSrc] = React.useState<string | null>(null)
  const showImage = !!src && failedSrc !== src

  return (
    <span
      className={cn(
        "relative grid shrink-0 place-items-center overflow-hidden",
        className
      )}
      style={{ width: size, height: size, fontSize: size * 0.5, ...style }}
      // Decorative when it's just an emoji; the <img> carries its own alt.
      aria-hidden={showImage ? undefined : true}
    >
      {showImage ? (
        // Deliberate plain <img>, not next/image: this is untrusted user-uploaded
        // content served from an IPFS gateway — routing it through the optimizer
        // means an allowlist + the SVG optimizer trap. Fixed box, so no CLS.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={name ? `${name}${ticker ? ` ($${ticker})` : ""} logo` : "coin logo"}
          width={size}
          height={size}
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setFailedSrc(src)}
        />
      ) : (
        emoji
      )}
    </span>
  )
}
