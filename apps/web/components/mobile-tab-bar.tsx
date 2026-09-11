"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Plus } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"
import { NAV_ITEMS, LAUNCH_HREF, isActive } from "@/lib/nav"

/** Bottom tab bar for mobile. Launch is the emphasized center action. */
export function MobileTabBar() {
  const pathname = usePathname()
  // The column count follows the tabs, rather than the tabs being trimmed to
  // fit a hard-coded four. This used to drop any item marked `soon`, which is
  // how the Harbormaster page ended up unreachable on a phone once it had
  // something real to show.
  const items = NAV_ITEMS
  const half = Math.ceil(items.length / 2)
  const columns = items.length + 1

  return (
    <nav
      className="border-border/60 bg-background/90 fixed inset-x-0 bottom-0 z-40 grid border-t backdrop-blur-xl md:hidden"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {items.slice(0, half).map((item) => (
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

      {items.slice(half).map((item) => (
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
        "flex min-w-0 flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors",
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
      <span className="max-w-full truncate px-0.5">{label}</span>
    </Link>
  )
}
