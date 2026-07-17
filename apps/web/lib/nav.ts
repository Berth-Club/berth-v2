import { Anchor, Trophy, Ticket, Wallet, type LucideIcon } from "lucide-react"

export type NavItem = {
  href: string
  label: string
  icon: LucideIcon
}

// berth.club nav — harbor is home; "launch a coin" is a separate CTA, not a nav item.
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Harbor", icon: Anchor },
  { href: "/leaderboard", label: "Leaderboard", icon: Trophy },
  // Whitelist is hidden, not deleted. The page is a mockup from the design
  // handoff: no contract, no store, no persistence. "Claim my berth" flips a
  // boolean and hands everyone the same hardcoded #4,271 of 10,000. Harmless on
  // localhost, but on a public URL it tells strangers they've secured something
  // that does not exist. Restore this line only once it's backed by something
  // real (the factory does have setWhitelisted/whitelistEnabled, currently off).
  // { href: "/whitelist", label: "Whitelist", icon: Ticket },
  { href: "/portfolio", label: "Portfolio", icon: Wallet },
]

export const LAUNCH_HREF = "/summon"

/** Active when the path equals the item, or is nested under it (non-root). */
export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/"
  return pathname === href || pathname.startsWith(href + "/")
}
