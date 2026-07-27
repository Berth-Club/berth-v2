"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { cn } from "@workspace/ui/lib/utils"
import { NAV_ITEMS, LAUNCH_HREF, isActive } from "@/lib/nav"
import { Wordmark } from "@/components/wordmark"
import { ActivityTicker } from "@/components/activity-ticker"
import { WalletMenu } from "@/components/wallet-menu"

export function TopBar() {
  const pathname = usePathname()

  return (
    <header
      className="sticky top-0 z-30"
      style={{
        background: "rgba(10,20,35,.9)",
        backdropFilter: "blur(10px)",
        borderBottom: "1px solid rgba(148,168,196,0.16)",
      }}
    >
      <div className="mx-auto flex max-w-[1180px] items-center gap-5 px-5 py-3.5">
        <Wordmark />

        <nav className="hidden items-center gap-1 md:flex">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "hover:bg-bulwark rounded-[9px] px-3.5 py-2 text-[14.5px] font-semibold transition-colors",
                  active ? "text-lime" : "text-body2 hover:text-foam"
                )}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2.5">
          <Link
            href={LAUNCH_HREF}
            className="btn-glossy hidden px-[18px] py-2.5 text-[15px] sm:inline-block"
          >
            + Launch a coin
          </Link>
          <WalletMenu />
        </div>
      </div>

      <ActivityTicker />
    </header>
  )
}
