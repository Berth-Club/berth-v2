"use client"

import * as React from "react"
import Link from "next/link"

import { useWallet } from "@/components/wallet-provider"

function short(a?: string) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : ""
}

/**
 * The header wallet control. Disconnected → connect. Wrong network → switch.
 * Connected → a pill that OPENS A MENU (address+copy, balance, portfolio,
 * disconnect) instead of the old footgun where the pill disconnected on click.
 */
export function WalletMenu() {
  const wallet = useWallet()
  const [open, setOpen] = React.useState(false)
  const [copied, setCopied] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)

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
      <button onClick={wallet.switchToArc} className="btn-glossy px-4 py-2.5 text-[15px]">
        Wrong network — switch
      </button>
    )
  }

  if (!wallet.connected) {
    return (
      <button
        onClick={wallet.connect}
        disabled={!wallet.ready}
        className="btn-quiet rounded-chip px-4 py-2.5 text-[11.5px] disabled:opacity-50"
        style={{ letterSpacing: ".14em" }}
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
        className="btn-quiet rounded-chip tabular px-4 py-2.5 text-[11.5px]"
        style={{ letterSpacing: ".14em" }}
      >
        {wallet.label}
      </button>

      {open && (
        <div
          role="menu"
          className="glass absolute right-0 z-40 mt-2 w-[264px] p-4"
          style={{ animation: "popIn .2s ease" }}
        >
          {/* address + copy */}
          <div className="mb-3 flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <span
                className="size-6 shrink-0 rounded-full"
                style={{ background: "linear-gradient(135deg,#8fb0e8,#4f74a8)" }}
              />
              <span className="tabular text-body2 text-sm">{short(wallet.address)}</span>
            </span>
            <button
              onClick={copy}
              className="rounded-chip text-faint hover:text-lime px-2 py-0.5 font-mono text-[11px] uppercase transition-colors"
            >
              {copied ? "Copied ✓" : "Copy"}
            </button>
          </div>

          {/* balance */}
          <div className="well mb-3 flex items-center justify-between px-3 py-2">
            <span className="text-faint font-mono text-[10px] uppercase" style={{ letterSpacing: ".12em" }}>
              Balance
            </span>
            {/* "—" not "0.00": an unread balance and an empty wallet are
                different answers, and only one of them is a fact. */}
            <span className="tabular text-foam text-sm">
              {wallet.balance ? `${wallet.balance} USDC` : "—"}
            </span>
          </div>

          {/* actions */}
          <Link
            href="/portfolio"
            onClick={() => setOpen(false)}
            className="hover:bg-bulwark rounded-btn text-body2 hover:text-foam flex items-center justify-between px-3 py-2 text-sm transition-colors"
          >
            <span>The Hold</span>
            <span aria-hidden>→</span>
          </Link>
          <button
            onClick={() => {
              setOpen(false)
              wallet.disconnect()
            }}
            className="hover:bg-bulwark rounded-btn text-faint mt-0.5 w-full px-3 py-2 text-left text-sm transition-colors"
            style={{ color: "#de8092" }}
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  )
}
