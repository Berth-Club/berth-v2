"use client"

import * as React from "react"

import { ProfileForm, type ProfileInitial } from "@/components/profile-form"
import { useWallet } from "@/components/wallet-provider"
import { PROFILE_EDITING_ENABLED } from "@/lib/env"

/**
 * The "Edit profile" affordance on /u. Renders nothing unless the connected
 * wallet IS this page's wallet — so only the owner can open the form. (The API
 * enforces ownership too; this is just UI gating.)
 *
 * NEXT_PUBLIC_PROFILE_EDITING gates the whole thing: with the flag off the page
 * stays read-only for everyone, owner included. /api/profile POST refuses too.
 */
export function ProfileEditor({ address, initial }: { address: string; initial: ProfileInitial | null }) {
  const { connected, address: mine } = useWallet()
  const [editing, setEditing] = React.useState(false)

  if (!PROFILE_EDITING_ENABLED) return null

  const isOwner = connected && mine?.toLowerCase() === address.toLowerCase()
  if (!isOwner) return null

  if (!editing) {
    return (
      <div className="mt-3 flex justify-end">
        <button onClick={() => setEditing(true)} className="btn-ghost px-4 py-2 text-[13px]">
          Edit profile
        </button>
      </div>
    )
  }

  return (
    <div className="glass mt-4 p-5">
      <h2 className="font-display mb-4 text-[17px]">Edit profile</h2>
      <ProfileForm
        address={address}
        initial={initial}
        onSaved={() => setEditing(false)}
        onCancel={() => setEditing(false)}
      />
    </div>
  )
}
