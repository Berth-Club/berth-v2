import { cn } from "@workspace/ui/lib/utils"

/**
 * Signature component. Track = deep well; fill = a seamless 4-colour gradient
 * flowing left→right; a ⛵ rides the head of the fill.
 * `progress` is 0–1. Spec: 8px track on cards, 12px on the token page.
 */
export function GraduationMeter({
  progress,
  graduated = false,
  size = "card",
  className,
}: {
  progress: number
  graduated?: boolean
  size?: "card" | "page"
  className?: string
}) {
  const pct = Math.round(Math.min(1, Math.max(0, graduated ? 1 : progress)) * 100)
  const page = size === "page"

  return (
    <div className={cn("relative", page ? "pt-3.5" : "pt-2.5", className)}>
      <div
        className={cn(
          "bg-deep w-full overflow-hidden rounded-lg",
          page ? "h-3" : "h-2"
        )}
      >
        <div
          className={cn("animate-flow h-full rounded-lg", page && "shadow-meter-glow")}
          style={{
            width: `${pct}%`,
            backgroundImage:
              "linear-gradient(90deg,#A3E635,#FBBF24,#4ADE80,#A3E635)",
            backgroundSize: "200% 100%",
          }}
        />
      </div>

      {/* ⛵ rides the head of the fill — static, no bobbing */}
      <span
        aria-hidden
        className={cn("absolute", page ? "-top-3.5 text-[28px]" : "-top-2.5 text-[22px]")}
        style={{ left: `${pct}%`, transform: "translateX(-60%)" }}
      >
        ⛵
      </span>
    </div>
  )
}
