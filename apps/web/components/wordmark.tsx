import Image from "next/image"
import Link from "next/link"

import { cn } from "@workspace/ui/lib/utils"

/**
 * The berth.club sailboat logo + "berth" + lime ".club".
 * The logo carries its own navy background, so it just gets rounded corners.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={cn("flex items-center gap-2.5 transition-opacity hover:opacity-80", className)}
    >
      <Image
        src="/berth-logo.png"
        alt="berth.club"
        width={36}
        height={36}
        priority
        className="size-9 shrink-0 rounded-[10px]"
      />
      <span className="font-display text-[22px] leading-none">
        berth<span className="text-primary">.club</span>
      </span>
    </Link>
  )
}
