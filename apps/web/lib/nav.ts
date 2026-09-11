import { Anchor, BarChart3, Compass, Wallet, type LucideIcon } from "lucide-react"

export type NavItem = {
  href: string
  label: string
  icon: LucideIcon
  /** Renders a SOON badge in the desktop capsule; hidden from the mobile bar. */
  soon?: boolean
}

// Portfolio — also reachable from the wallet dropdown.
export const PORTFOLIO_ITEM: NavItem = { href: "/hold", label: "Portfolio", icon: Wallet }

export const HARBORMASTER_ITEM: NavItem = {
  href: "/harbormaster",
  label: "Harbormaster",
  icon: Compass,
}

// v4 desktop capsule: Harbor / Analytics / Portfolio / Harbormaster, centered
// between the brand and the wallet. Nothing carries a SOON badge now; the
// Harbormaster page states its own status from the record it is showing.
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Harbor", icon: Anchor },
  { href: "/stats", label: "Analytics", icon: BarChart3 },
  PORTFOLIO_ITEM,
  HARBORMASTER_ITEM,
]

export const LAUNCH_HREF = "/create"

/** Active when the path equals the item, or is nested under it (non-root). */
export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/"
  return pathname === href || pathname.startsWith(href + "/")
}
