"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { UserAvatar } from "@/components/user-avatar"
import { useWallet } from "@/components/wallet-provider"
import { avatarSrc } from "@/lib/chain"
import { BIO_MAX, NAME_MAX } from "@/lib/profile-input"
import { useAvatarUpload } from "@/lib/use-avatar-upload"

export type ProfileInitial = {
  name: string | null
  bio: string | null
  social: string | null
  image: string | null
}

const IMAGE_TYPES = /^image\/(png|jpeg|webp|gif)$/

/**
 * The profile editor form. Container-agnostic — used inline on /u and inside the
 * onboarding modal. Submits to /api/profile with the caller's Privy token; the
 * server writes only the token's own wallet, so `address` here is just for the
 * avatar fallback, never trusted for the write.
 */
export function ProfileForm({
  address,
  initial,
  onSaved,
  onCancel,
  submitLabel = "Save profile",
  cancelLabel = "Cancel",
}: {
  address: string
  initial: ProfileInitial | null
  onSaved?: () => void
  onCancel?: () => void
  submitLabel?: string
  cancelLabel?: string
}) {
  const { getAccessToken } = useWallet()
  const upload = useAvatarUpload(getAccessToken)
  const router = useRouter()

  const [name, setName] = React.useState(initial?.name ?? "")
  const [bio, setBio] = React.useState(initial?.bio ?? "")
  const [social, setSocial] = React.useState(initial?.social ?? "")
  const [removed, setRemoved] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string>()

  // A freshly-uploaded avatar wins; "Remove" forces null; otherwise keep what the
  // profile already had. The profile write deletes any superseded R2 object.
  const image = removed ? null : (upload.url ?? initial?.image ?? null)
  const previewSrc = removed ? null : (upload.previewUrl ?? avatarSrc(initial?.image))

  const save = React.useCallback(async () => {
    if (saving || upload.status === "uploading") return
    setSaving(true)
    setError(undefined)
    try {
      const token = getAccessToken ? await getAccessToken() : null
      if (!token) {
        setError("Sign in to save your profile.")
        return
      }
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ name, bio, social, image }),
      })
      const data = (await res.json().catch(() => ({}))) as { message?: string }
      if (res.ok) {
        onSaved?.()
        router.refresh()
      } else {
        setError(data.message ?? "Couldn't save your profile.")
      }
    } catch {
      setError("Couldn't reach the harbor.")
    } finally {
      setSaving(false)
    }
  }, [saving, upload.status, getAccessToken, name, bio, social, image, onSaved, router])

  return (
    <div className="flex flex-col gap-4">
      {/* avatar */}
      <div className="flex items-center gap-4">
        <label className="group relative cursor-pointer">
          {previewSrc ? (
            <span className="relative block size-16 overflow-hidden rounded-full" style={{ border: "1px solid rgba(148,168,196,.2)" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previewSrc} alt="" className="size-full object-cover" />
            </span>
          ) : (
            <UserAvatar address={address} size={64} />
          )}
          {upload.status === "uploading" && (
            <span className="text-foam absolute inset-0 grid place-items-center rounded-full bg-black/50 text-[10px] font-bold">
              uploading…
            </span>
          )}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f && IMAGE_TYPES.test(f.type)) {
                setRemoved(false)
                upload.pick(f)
              }
              e.target.value = ""
            }}
          />
        </label>
        <div className="text-body2 text-sm">
          <div className="font-semibold">{previewSrc ? "Change avatar" : "Add an avatar"}</div>
          <div className="text-faint text-[12.5px]">PNG, JPG, WEBP or GIF.</div>
          {previewSrc && (
            <button
              type="button"
              onClick={() => {
                upload.reset()
                setRemoved(true)
              }}
              className="text-faint hover:text-body2 mt-1 text-[12.5px] underline"
            >
              Remove avatar
            </button>
          )}
          {upload.error && <div className="mt-1 text-[12.5px]" style={{ color: "#de8092" }}>{upload.error}</div>}
        </div>
      </div>

      <Field label="Display name" hint={`${name.length}/${NAME_MAX}`}>
        <input
          value={name}
          maxLength={NAME_MAX}
          onChange={(e) => setName(e.target.value)}
          placeholder="Captain Nemo"
          className="well text-foam w-full rounded-xl px-3.5 py-2.5 text-sm outline-none"
        />
      </Field>

      <Field label="Bio" hint={`${bio.length}/${BIO_MAX}`}>
        <textarea
          value={bio}
          maxLength={BIO_MAX}
          onChange={(e) => setBio(e.target.value)}
          rows={2}
          placeholder="A line about you."
          className="well text-foam w-full resize-none rounded-xl px-3.5 py-2.5 text-sm outline-none"
        />
      </Field>

      <Field label="Link">
        <input
          value={social}
          onChange={(e) => setSocial(e.target.value)}
          placeholder="https://x.com/you"
          inputMode="url"
          className="well text-foam w-full rounded-xl px-3.5 py-2.5 text-sm outline-none"
        />
      </Field>

      {error && <p className="text-[13px]" style={{ color: "#de8092" }}>{error}</p>}

      <div className="flex items-center justify-end gap-2.5">
        {onCancel && (
          <button onClick={onCancel} className="btn-ghost px-4 py-2.5 text-[13.5px]">
            {cancelLabel}
          </button>
        )}
        <button
          onClick={save}
          disabled={saving || upload.status === "uploading"}
          className="btn-glossy px-5 py-2.5 text-[13.5px] disabled:opacity-50"
        >
          {saving ? "Saving…" : submitLabel}
        </button>
      </div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-faint mb-1.5 flex items-center justify-between text-[12.5px] font-semibold">
        <span>{label}</span>
        {hint && <span className="tabular">{hint}</span>}
      </div>
      {children}
    </label>
  )
}
