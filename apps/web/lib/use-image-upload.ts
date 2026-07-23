"use client"

import * as React from "react"

export type UploadStatus = "idle" | "uploading" | "done" | "error"

export type ImageUpload = {
  /** Local object URL for the in-wizard preview — NOT the gateway (a just-pinned
   *  CID can briefly 404). */
  previewUrl: string | null
  /** The pinned `ipfs://CID`, once uploaded. This is what goes into metadataURI. */
  imageUri: string | null
  status: UploadStatus
  /** true when the last failure was a pin OUTAGE (or uploads are unavailable) —
   *  the wizard offers a degraded emoji-only launch. false = a bad file to fix. */
  outage: boolean
  error: string | null
  /** Whether uploads can be authenticated at all (false without Privy). */
  available: boolean
  /** Start an upload for a picked file (shows the preview immediately). */
  pick: (file: File) => void
  /** Clear the current image (used by "replace"). Invalidates any in-flight upload. */
  reset: () => void
}

/**
 * Uploads a coin image to /api/pin and tracks its state. Takes the wallet's
 * getAccessToken so it stays free of any Privy coupling (and testable in
 * isolation). The reqId guard is load-bearing: replacing the image must not let
 * a stale in-flight response resurrect an old CID — that CID feeds the predicted
 * CREATE2 address, so a late write would make the previewed address a lie.
 */
export function useImageUpload(getAccessToken?: () => Promise<string | null>): ImageUpload {
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null)
  const [imageUri, setImageUri] = React.useState<string | null>(null)
  const [status, setStatus] = React.useState<UploadStatus>("idle")
  const [outage, setOutage] = React.useState(false)
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
    setImageUri(null)
    setStatus("idle")
    setOutage(false)
    setError(null)
  }, [clearPreview])

  const pick = React.useCallback(
    (file: File) => {
      clearPreview()
      const url = URL.createObjectURL(file)
      objectUrl.current = url
      const id = ++reqId.current
      setPreviewUrl(url)
      setImageUri(null)
      setOutage(false)
      setError(null)
      setStatus("uploading")

      void (async () => {
        try {
          const token = getAccessToken ? await getAccessToken() : null
          if (!token) {
            if (reqId.current === id) {
              setStatus("error")
              setOutage(true) // can't auth -> treat as unavailable -> degraded allowed
              setError("Sign in to upload art.")
            }
            return
          }
          const body = new FormData()
          body.append("file", file)
          const res = await fetch("/api/pin", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            body,
          })
          const data = (await res.json().catch(() => ({}))) as {
            uri?: string
            code?: string
            message?: string
          }
          if (reqId.current !== id) return // superseded by a newer pick/reset
          if (res.ok && data.uri) {
            setImageUri(data.uri)
            setStatus("done")
          } else {
            setStatus("error")
            // A pinning outage (or unconfigured server) is not the creator's
            // fault -> degraded launch. A rejected file IS -> they must fix it.
            setOutage(data.code === "pin_unavailable" || data.code === "not_configured")
            setError(data.message ?? "Upload failed.")
          }
        } catch {
          if (reqId.current === id) {
            setStatus("error")
            setOutage(true) // couldn't reach the uploader -> degraded allowed
            setError("Couldn't reach the uploader.")
          }
        }
      })()
    },
    [getAccessToken, clearPreview]
  )

  React.useEffect(() => () => clearPreview(), [clearPreview])

  return {
    previewUrl,
    imageUri,
    status,
    outage,
    error,
    available: !!getAccessToken,
    pick,
    reset,
  }
}
