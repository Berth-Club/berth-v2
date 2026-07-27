import { Anchor, BarChart3, Wallet, type LucideIcon } from "lucide-react"

export type NavItem = {
  href: string
  label: string
  icon: LucideIcon
}

// berth.club nav — harbor is home; "launch a coin" is a separate CTA, not a nav item.
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Harbor", icon: Anchor },
  { href: "/stats", label: "Analytics", icon: BarChart3 },
  // No Whitelist entry: the page was a design mockup with no contract behind it
  // ("Claim my berth" flipped a boolean and handed everyone berth #4,271 of an
  // invented 10,000), so it was deleted rather than just unlinked — an unlinked
  // URL still resolves. The factory does have setWhitelisted/whitelistEnabled,
  // currently off; build the page against those if it ever comes back.
  //
  // No Leaderboard either — v3 removes it by design. The captains rollup it read
  // is still indexed and now feeds Analytics and /u/[address].
  { href: "/portfolio", label: "Portfolio", icon: Wallet },
]

export const LAUNCH_HREF = "/summon"

/** Active when the path equals the item, or is nested under it (non-root). */
export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/"
  return pathname === href || pathname.startsWith(href + "/")
}
