"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { cn } from "@workspace/ui/lib/utils"
import { NAV_ITEMS, LAUNCH_HREF, isActive } from "@/lib/nav"
import { Wordmark } from "@/components/wordmark"
import { WalletMenu } from "@/components/wallet-menu"

/**
 * v3 FINAL header: a FLOATING pill row — transparent gradient + blur, no bottom
 * border, no ticker marquee. Left: sail + wordmark. Center: a frosted nav
 * capsule (Harbor / Analytics only — Portfolio lives in the wallet dropdown).
 * Right: glossy "+ Launch a coin" + a frosted "Connect wallet".
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
      <div className="mx-auto flex max-w-[1180px] items-center gap-5 px-5 py-3.5">
        <Wordmark />

        {/* frosted nav capsule, centered */}
        <nav
          className="btn-frost absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 p-1 md:flex"
          aria-label="Primary"
        >
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-full px-4 py-1.5 text-[14px] font-semibold transition-colors",
                  active
                    ? "text-[#0d2340]"
                    : "text-body2 hover:text-foam"
                )}
                style={active ? { background: "rgba(234,241,250,.94)" } : undefined}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2.5">
          <Link
            href={LAUNCH_HREF}
            className="btn-glossy hidden px-[18px] py-2.5 text-[14.5px] sm:inline-block"
          >
            + Launch a coin
          </Link>
          <WalletMenu />
        </div>
      </div>
    </header>
  )
}
