"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Plus } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { NAV_ITEMS, LAUNCH_HREF, isActive } from "@/lib/nav"

/** Bottom tab bar for mobile. Launch is the emphasized center action. */
export function MobileTabBar() {
  const pathname = usePathname()
  // Harbormaster is desktop-only while it carries a SOON badge, which keeps
  // this at exactly 3 tabs + the center launch action = grid-cols-4.
  const items = NAV_ITEMS.filter((item) => !item.soon)

  return (
    <nav className="border-border/60 bg-background/90 fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t backdrop-blur-xl md:hidden">
      {items.slice(0, 2).map((item) => (
        <Tab key={item.href} href={item.href} label={item.label} pathname={pathname} icon={item.icon} />
      ))}

      {/* launch CTA */}
      <Link
        href={LAUNCH_HREF}
        className="text-lime flex flex-col items-center gap-1 py-2.5 text-xs font-medium"
      >
        <span className="btn-glossy flex size-9 items-center justify-center rounded-xl">
          <Plus className="size-5" />
        </span>
        Launch
      </Link>

      {items.slice(2).map((item) => (
        <Tab key={item.href} href={item.href} label={item.label} pathname={pathname} icon={item.icon} />
      ))}
    </nav>
  )
}

function Tab({
  href,
  label,
  pathname,
  icon: Icon,
}: {
  href: string
  label: string
  pathname: string
  icon: React.ComponentType<{ className?: string }>
}) {
  const active = isActive(pathname, href)
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex flex-col items-center gap-1 py-2.5 text-xs font-medium transition-colors",
        active ? "text-foreground" : "text-muted-foreground"
      )}
    >
      <span
        className={cn(
          "flex size-9 items-center justify-center rounded-xl transition-colors",
          active && "bg-accent"
        )}
      >
        <Icon className="size-5" />
      </span>
      {label}
    </Link>
  )
}
