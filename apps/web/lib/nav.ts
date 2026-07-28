import { Anchor, BarChart3, Wallet, type LucideIcon } from "lucide-react"

export type NavItem = {
  href: string
  label: string
  icon: LucideIcon
}

// v3 FINAL desktop nav capsule: Harbor + Analytics ONLY. Portfolio is reached
// from the wallet dropdown (and the mobile tab bar), never the top nav.
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Harbor", icon: Anchor },
  { href: "/stats", label: "Analytics", icon: BarChart3 },
]

// Portfolio — surfaced by the wallet dropdown + mobile tab bar, not the capsule.
export const PORTFOLIO_ITEM: NavItem = { href: "/hold", label: "Portfolio", icon: Wallet }

export const LAUNCH_HREF = "/create"

/** Active when the path equals the item, or is nested under it (non-root). */
export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/"
  return pathname === href || pathname.startsWith(href + "/")
}
