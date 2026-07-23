"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { cn } from "@workspace/ui/lib/utils"
import { NAV_ITEMS, LAUNCH_HREF, isActive } from "@/lib/nav"
import { Wordmark } from "@/components/wordmark"
import { ActivityTicker } from "@/components/activity-ticker"
import { useWallet } from "@/components/wallet-provider"

export function TopBar() {
  const pathname = usePathname()
  const wallet = useWallet()

  return (
    <header
      className="sticky top-0 z-30"
      style={{
        background: "rgba(12,19,14,.9)",
        backdropFilter: "blur(10px)",
        borderBottom: "1px solid #22331f",
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
                  "hover:bg-bulwark rounded-[10px] px-3.5 py-2 text-sm font-bold transition-colors",
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
            className="btn-deck btn-gold hidden px-4 py-2 text-[15px] sm:inline-block"
          >
            + Launch a coin
          </Link>
          {wallet.wrongNetwork ? (
            <button
              onClick={wallet.switchToArc}
              className="btn-deck btn-gold px-4 py-2 text-[15px]"
            >
              Wrong network — switch
            </button>
          ) : (
            <button
              onClick={() => {
                if (wallet.connected) return wallet.disconnect()
                wallet.connect()
              }}
              disabled={!wallet.ready}
              className="btn-deck btn-lime tabular px-4 py-2 text-[15px] disabled:opacity-50"
            >
              {wallet.label}
            </button>
          )}
        </div>
      </div>

      <ActivityTicker />
    </header>
  )
}
