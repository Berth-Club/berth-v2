"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { cn } from "@workspace/ui/lib/utils"
import { NAV_ITEMS, LAUNCH_HREF, isActive } from "@/lib/nav"
import { Wordmark } from "@/components/wordmark"
import { WalletMenu } from "@/components/wallet-menu"

/**
 * v4 header: three equal-flex zones so the nav capsule is truly centered no
 * matter how wide the brand or the wallet button gets. Left: sail + wordmark.
 * Center: frosted capsule (Harbor / Analytics / Portfolio / Harbormaster·SOON).
 * Right: glossy "+ Launch a coin" + wallet.
 */
export function TopBar() {
  const pathname = usePathname()

  return (
    <header
      className="sticky top-0 z-30"
      style={{
        background:
          "linear-gradient(180deg, rgba(8,16,32,.88), rgba(8,16,32,.55) 70%, transparent)",
        backdropFilter: "blur(10px)",
      }}
    >
      <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-3.5 px-5 py-3.5">
        <div className="flex min-w-[180px] flex-1 justify-start">
          <Wordmark />
        </div>

        <nav className="btn-frost hidden items-center gap-0.5 p-1 md:flex" aria-label="Primary">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-[7px] rounded-full px-[18px] py-[9px] text-[14px] font-semibold transition-colors",
                  active ? "text-[#0d2340]" : "text-body2 hover:text-foam"
                )}
                style={active ? { background: "rgba(234,241,250,.94)" } : undefined}
              >
                {item.label}
                {item.soon && (
                  <span
                    className="rounded-full px-[7px] py-[2px] text-[9.5px] font-bold"
                    style={{
                      color: active ? "#0d2340" : "#89a7db",
                      border: `1px solid ${active ? "rgba(13,35,64,.4)" : "rgba(137,167,219,.45)"}`,
                      letterSpacing: ".08em",
                    }}
                  >
                    SOON
                  </span>
                )}
              </Link>
            )
          })}
        </nav>

        <div className="flex min-w-[180px] flex-1 items-center justify-end gap-2.5">
          <Link
            href={LAUNCH_HREF}
            className="btn-glossy hidden shrink-0 whitespace-nowrap px-[18px] py-2.5 text-[14.5px] sm:inline-block"
          >
            + Launch a coin
          </Link>
          <WalletMenu />
        </div>
      </div>
    </header>
  )
}
