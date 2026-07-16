import { cn } from "@workspace/ui/lib/utils"

/**
 * Coins carry an emoji "face" rather than an uploaded image (picked at launch).
 * Rendered on a tinted hull-green tile.
 */
export function CoinAvatar({
  emoji,
  size = 44,
  className,
}: {
  emoji: string
  size?: number
  className?: string
}) {
  return (
    <span
      className={cn(
        "bg-muted border-border/60 inline-flex shrink-0 items-center justify-center rounded-xl border",
        className
      )}
      style={{ width: size, height: size, fontSize: size * 0.5 }}
      aria-hidden
    >
      {emoji}
    </span>
  )
}
