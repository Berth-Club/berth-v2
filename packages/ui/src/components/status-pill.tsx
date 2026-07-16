import { cn } from "@workspace/ui/lib/utils"

const TONES = {
  graduated: "text-gain border-gain/30 bg-gain/10",
  live: "text-launch border-launch/30 bg-launch/10",
  warning: "text-warning border-warning/30 bg-warning/10",
  muted: "text-muted-foreground border-border bg-muted/50",
} as const

/** Small lowercase badge. Tone carries market meaning (graduated/live/warning). */
export function StatusPill({
  children,
  tone = "muted",
  className,
}: {
  children: React.ReactNode
  tone?: keyof typeof TONES
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.7rem] font-medium lowercase",
        TONES[tone],
        className
      )}
    >
      {children}
    </span>
  )
}
