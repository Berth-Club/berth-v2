import { cn } from "@workspace/ui/lib/utils"

/**
 * Renders a number as mono, tabular data. Prices, market caps, %s, balances.
 * Mock uses plain numbers; real values format via viem `formatUnits` upstream
 * and pass through here as strings/numbers.
 */
export function NumberDisplay({
  value,
  prefix,
  suffix,
  compact = false,
  decimals = 2,
  className,
}: {
  value: number | string
  prefix?: string
  suffix?: string
  compact?: boolean
  decimals?: number
  className?: string
}) {
  const formatted =
    typeof value === "number"
      ? new Intl.NumberFormat("en-US", {
          notation: compact ? "compact" : "standard",
          maximumFractionDigits: compact ? 2 : decimals,
        }).format(value)
      : value

  return (
    <span className={cn("tabular", className)}>
      {prefix}
      {formatted}
      {suffix}
    </span>
  )
}
