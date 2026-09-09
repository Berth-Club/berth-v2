"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"

import { useWallet } from "@/components/wallet-provider"
import { UserAvatar } from "@/components/user-avatar"

function short(a?: string) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : ""
}

/**
 * The connected wallet's own profile image, so the nav shows the face the user
 * picked rather than a generated disc. Everywhere else that renders a wallet
 * (token page, profile, comments) already used UserAvatar; this control was the
 * one that never read the profile at all.
 *
 * Failures stay silent: UserAvatar falls back to its per-address glyph, which
 * is what a wallet with no profile shows anyway.
 */
function useOwnAvatar(address?: string): string | null {
  const [image, setImage] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!address) {
      setImage(null)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/profile?address=${address}`, { cache: "no-store" })
        const data = (await res.json()) as { profile?: { image?: string | null } }
        if (!cancelled) setImage(data.profile?.image ?? null)
      } catch {
        if (!cancelled) setImage(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [address])

  return image
}

/**
 * v3 FINAL wallet control. Disconnected → frosted "Connect wallet". Wrong
 * network → switch. Connected → a frosted pill (identicon + address) opening an
 * opaque flat dropdown: identicon + address + "Connected · Arc" status, copy
 * button, an inset balance card, then glossy Portfolio + quiet-red Disconnect.
 * Closes on outside click, Esc, and any navigation.
 */
export function WalletMenu() {
  const wallet = useWallet()
  const avatar = useOwnAvatar(wallet.address)
  const pathname = usePathname()
  const [open, setOpen] = React.useState(false)
  const [copied, setCopied] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)

  // Close on navigation.
  React.useEffect(() => setOpen(false), [pathname])

  React.useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false)
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  const copy = async () => {
    if (!wallet.address) return
    try {
      await navigator.clipboard.writeText(wallet.address)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch {
      /* clipboard blocked — no-op */
    }
  }

  if (wallet.wrongNetwork) {
    return (
      <button
        onClick={wallet.switchToArc}
        className="btn-glossy shrink-0 whitespace-nowrap px-4 py-2.5 text-[14.5px]"
      >
        Switch network
      </button>
    )
  }

  if (!wallet.connected) {
    return (
      <button
        onClick={wallet.connect}
        disabled={!wallet.ready}
        className="btn-frost text-body2 shrink-0 whitespace-nowrap px-4 py-2.5 text-[13.5px] font-semibold disabled:opacity-50"
      >
        Connect wallet
      </button>
    )
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="btn-frost flex shrink-0 items-center gap-2 whitespace-nowrap py-2 pl-2 pr-3.5"
      >
        <UserAvatar address={wallet.address ?? ""} image={avatar} size={24} />
        <span className="tabular text-body2 text-[13px]">{short(wallet.address)}</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-2 w-[288px] p-4"
          style={{
            background: "rgba(14,26,41,.97)",
            border: "1px solid rgba(148,168,196,.16)",
            borderRadius: 20,
            boxShadow: "0 24px 48px -20px rgba(3,8,16,.8)",
            animation: "popIn .18s ease",
          }}
        >
          {/* identity + copy */}
          <div className="flex items-start justify-between gap-2">
            <span className="flex items-center gap-2.5">
              <UserAvatar address={wallet.address ?? ""} image={avatar} size={36} />
              <span className="flex flex-col">
                <span className="tabular text-foam text-[13.5px]">{short(wallet.address)}</span>
                <span className="text-faint mt-0.5 flex items-center gap-1.5 text-[11.5px]">
                  <span className="size-1.5 rounded-full" style={{ background: "#7cc9a3" }} />
                  Connected · Arc
                </span>
              </span>
            </span>
            <button
              onClick={copy}
              className="text-faint hover:text-lime px-1.5 py-0.5 font-mono text-[10.5px] uppercase transition-colors"
              style={{ letterSpacing: ".1em" }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>

          {/* balance card */}
          <div className="well mt-3.5 px-3.5 py-3">
            <span className="text-faint font-mono text-[10px] uppercase" style={{ letterSpacing: ".12em" }}>
              Balance
            </span>
            {/* "—" not "0.00": an unread balance and an empty wallet are
                different answers, and only one of them is a fact. */}
            <div className="tabular text-foam mt-1 text-[22px]">
              {wallet.balance ? `${wallet.balance}` : "—"}
              <span className="text-faint ml-1.5 text-[13px]">USDC</span>
            </div>
          </div>

          {/* actions */}
          <Link
            href={`/u/${wallet.address}`}
            onClick={() => setOpen(false)}
            className="btn-frost mt-3.5 block w-full py-2.5 text-center text-[13.5px]"
          >
            Profile
          </Link>
          <Link
            href="/hold"
            onClick={() => setOpen(false)}
            className="btn-glossy mt-3.5 block w-full py-2.5 text-center text-[14px]"
          >
            Portfolio
          </Link>
          <button
            onClick={() => {
              setOpen(false)
              wallet.disconnect()
            }}
            className="mt-2 w-full rounded-full py-2.5 text-center text-[13.5px] font-semibold transition-colors hover:bg-[rgba(222,128,146,.08)]"
            style={{ color: "#de8092" }}
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  )
}
