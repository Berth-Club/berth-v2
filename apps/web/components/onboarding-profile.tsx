"use client"

import * as React from "react"

import { ProfileForm } from "@/components/profile-form"
import { useWallet } from "@/components/wallet-provider"

/**
 * One-time, skippable profile prompt after a wallet's first login. Shows only
 * when: connected, no local "onboarded" flag for this wallet, and no profile
 * row yet. Skip or Save both set the flag so it never nags again (R5). Fully
 * dismissible — it never blocks the app or a trade (R4).
 */
const flagKey = (addr: string) => `berth:onboarded:${addr.toLowerCase()}`

export function OnboardingProfile() {
  const { connected, address } = useWallet()
  const [show, setShow] = React.useState(false)

  React.useEffect(() => {
    if (!connected || !address) return
    if (localStorage.getItem(flagKey(address))) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/profile?address=${address}`, { cache: "no-store" })
        const data = (await res.json().catch(() => ({}))) as { profile?: unknown }
        if (cancelled) return
        if (data.profile) {
          // Already has a profile — mark done, never prompt.
          localStorage.setItem(flagKey(address), "1")
          return
        }
        setShow(true)
      } catch {
        // A failed check should never nag — stay quiet.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [connected, address])

  const dismiss = React.useCallback(() => {
    if (address) localStorage.setItem(flagKey(address), "1")
    setShow(false)
  }, [address])

  if (!show || !address) return null

  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center p-4"
      style={{ background: "rgba(3,8,16,.72)", backdropFilter: "blur(6px)" }}
      onClick={dismiss}
      role="dialog"
      aria-modal="true"
      aria-label="Set up your profile"
    >
      <div
        className="glass w-full max-w-[440px] p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={dismiss}
          aria-label="Skip"
          className="text-faint hover:text-body2 float-right -mt-1 text-lg leading-none"
        >
          ×
        </button>
        <h2 className="font-display text-[20px]">Set up your profile</h2>
        <p className="text-faint mb-4 mt-1 text-[13px]">
          Add a name and avatar so the harbor knows you. You can skip and do this anytime.
        </p>
        <ProfileForm
          address={address}
          initial={null}
          onSaved={dismiss}
          onCancel={dismiss}
          submitLabel="Save & continue"
          cancelLabel="Skip for now"
        />
      </div>
    </div>
  )
}
