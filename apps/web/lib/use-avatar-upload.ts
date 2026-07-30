"use client"

import * as React from "react"

/**
 * Uploads a profile avatar to /api/avatar (Cloudflare R2) and tracks its state.
 * The avatar sibling of `use-image-upload` (which targets Pinata/IPFS for coin
 * art): this one returns an https R2 `url`, not an `ipfs://` uri, and uploads on
 * pick (no deferred pin — an avatar CID never feeds a CREATE2 address). The reqId
 * guard drops a stale in-flight response if the user re-picks or resets.
 */
export type AvatarUploadStatus = "idle" | "uploading" | "done" | "error"

export function useAvatarUpload(getAccessToken?: () => Promise<string | null>) {
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null)
  const [url, setUrl] = React.useState<string | null>(null)
  const [status, setStatus] = React.useState<AvatarUploadStatus>("idle")
  const [error, setError] = React.useState<string | null>(null)
  const objectUrl = React.useRef<string | null>(null)
  const reqId = React.useRef(0)

  const clearPreview = React.useCallback(() => {
    if (objectUrl.current) {
      URL.revokeObjectURL(objectUrl.current)
      objectUrl.current = null
    }
  }, [])

  const reset = React.useCallback(() => {
    reqId.current++ // invalidate any in-flight upload
    clearPreview()
    setPreviewUrl(null)
    setUrl(null)
    setStatus("idle")
    setError(null)
  }, [clearPreview])

  const pick = React.useCallback(
    (file: File) => {
      const id = ++reqId.current
      clearPreview()
      const preview = URL.createObjectURL(file)
      objectUrl.current = preview
      setPreviewUrl(preview)
      setUrl(null)
      setError(null)
      setStatus("uploading")

      void (async () => {
        try {
          const token = getAccessToken ? await getAccessToken() : null
          if (!token) {
            if (reqId.current === id) {
              setStatus("error")
              setError("Sign in to upload an avatar.")
            }
            return
          }
          const body = new FormData()
          body.append("file", file)
          const res = await fetch("/api/avatar", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            body,
          })
          const data = (await res.json().catch(() => ({}))) as { url?: string; message?: string }
          if (reqId.current !== id) return // superseded by a newer pick/reset
          if (res.ok && data.url) {
            setUrl(data.url)
            setStatus("done")
          } else {
            setStatus("error")
            setError(data.message ?? "Upload failed.")
          }
        } catch {
          if (reqId.current === id) {
            setStatus("error")
            setError("Couldn't reach the uploader.")
          }
        }
      })()
    },
    [getAccessToken, clearPreview]
  )

  React.useEffect(() => () => clearPreview(), [clearPreview])

  return { previewUrl, url, status, error, pick, reset }
}
