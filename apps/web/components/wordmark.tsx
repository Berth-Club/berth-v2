import Link from "next/link"

import { cn } from "@workspace/ui/lib/utils"

/**
 * ⚓ in a circular badge (#365B2B, lime ring) + "berth" + lime ".club".
 * Matches the berth.club design spec.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={cn("flex items-center gap-2.5 transition-opacity hover:opacity-80", className)}
    >
      <span
        aria-hidden
        className="border-primary grid size-9 shrink-0 place-items-center rounded-full border-2 text-[19px]"
        style={{ background: "#365B2B" }}
      >
        ⚓
      </span>
      <span className="font-display text-[22px] leading-none">
        berth<span className="text-primary">.club</span>
      </span>
    </Link>
  )
}
