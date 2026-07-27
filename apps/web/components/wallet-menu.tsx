"use client"

import * as React from "react"
import Link from "next/link"

import { useWallet } from "@/components/wallet-provider"

function short(a?: string) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : ""
}

const LINE = "rgba(148,168,196,0.2)"

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
      <button onClick={wallet.switchToArc} className="btn-deck btn-gold px-4 py-2 text-[15px]">
        Wrong network — switch
      </button>
    )
  }

  if (!wallet.connected) {
    return (
      <button
        onClick={wallet.connect}
        disabled={!wallet.ready}
        className="btn-deck btn-quiet px-4 py-2 text-[15px] disabled:opacity-50"
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
        className="btn-deck btn-quiet tabular px-4 py-2 text-[15px]"
      >
        {wallet.label}
      </button>

      {open && (
        <div
          role="menu"
          className="rounded-card bg-hull absolute right-0 z-40 mt-2 w-[264px] border p-3"
          style={{ borderColor: LINE, boxShadow: "0 12px 34px rgba(0,0,0,.45)" }}
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
          <div
            className="bg-deep rounded-btn mb-3 flex items-center justify-between px-3 py-2"
            style={{ border: `1px solid ${LINE}` }}
          >
            <span className="text-faint font-mono text-[10px] uppercase" style={{ letterSpacing: ".12em" }}>
              Balance
            </span>
            <span className="tabular text-foam text-sm">{wallet.balance ?? "0.00"} USDC</span>
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
