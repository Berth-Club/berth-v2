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
  /** true when the ONLY thing missing is a signed-in wallet — distinct from a
   *  genuine pin outage, so the UI can say "connect" instead of "unavailable". */
  needsAuth: boolean
  error: string | null
  /** Whether uploads can be authenticated at all (false without Privy). */
  available: boolean
  /** True once a file is held (previewed) — whether or not it's pinned yet. */
  held: boolean
  /** Hold a file for preview WITHOUT pinning it. The pin is deferred to pin()
   *  so we don't upload art the user may replace or abandon, and only pin right
   *  before the CID is needed to build the coin's metadata/address. */
  hold: (file: File) => void
  /** Pin the currently-held file to IPFS. No-op if nothing is held. */
  pin: () => void
  /** Start an upload for a picked file immediately (preview + pin at once). */
  pick: (file: File) => void
  /** Clear the current image (used by "replace"). Invalidates any in-flight upload. */
  reset: () => void
  /** Re-attempt the pin for the already-held file — e.g. after the wallet connects. */
  retry: () => void
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
  const [needsAuth, setNeedsAuth] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const objectUrl = React.useRef<string | null>(null)
  const reqId = React.useRef(0)
  const lastFile = React.useRef<File | null>(null)

  const clearPreview = React.useCallback(() => {
    if (objectUrl.current) {
      URL.revokeObjectURL(objectUrl.current)
      objectUrl.current = null
    }
  }, [])

  const reset = React.useCallback(() => {
    reqId.current++ // invalidate any in-flight upload
    lastFile.current = null
    clearPreview()
    setPreviewUrl(null)
    setImageUri(null)
    setStatus("idle")
    setOutage(false)
    setNeedsAuth(false)
    setError(null)
  }, [clearPreview])

  // The actual pin, shared by pick() and retry(). `id` guards against a stale
  // in-flight response overwriting a newer pick/reset.
  const runUpload = React.useCallback(
    (file: File, id: number) => {
      setImageUri(null)
      setOutage(false)
      setNeedsAuth(false)
      setError(null)
      setStatus("uploading")

      void (async () => {
        try {
          const token = getAccessToken ? await getAccessToken() : null
          if (!token) {
            if (reqId.current === id) {
              setStatus("error")
              // Not a real outage — the pin route is fine, the user just isn't
              // signed in. Degraded launch is still allowed, but the message
              // should say "connect", not "unavailable".
              setNeedsAuth(true)
              setOutage(true)
              setError("Connect your wallet to upload art.")
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
    [getAccessToken]
  )

  // Preview a file but DON'T pin it yet — pin() does that later, right before
  // the CID is needed. Invalidates any in-flight upload from a prior file.
  const hold = React.useCallback(
    (file: File) => {
      clearPreview()
      const url = URL.createObjectURL(file)
      objectUrl.current = url
      lastFile.current = file
      reqId.current++
      setPreviewUrl(url)
      setImageUri(null)
      setStatus("idle")
      setOutage(false)
      setNeedsAuth(false)
      setError(null)
    },
    [clearPreview]
  )

  // Pin the currently-held file. Shared impl for pin() and retry().
  const pin = React.useCallback(() => {
    const file = lastFile.current
    if (!file) return
    const id = ++reqId.current
    runUpload(file, id)
  }, [runUpload])

  const pick = React.useCallback(
    (file: File) => {
      clearPreview()
      const url = URL.createObjectURL(file)
      objectUrl.current = url
      lastFile.current = file
      const id = ++reqId.current
      setPreviewUrl(url)
      runUpload(file, id)
    },
    [clearPreview, runUpload]
  )

  React.useEffect(() => () => clearPreview(), [clearPreview])

  return {
    previewUrl,
    imageUri,
    status,
    outage,
    error,
    available: !!getAccessToken,
    needsAuth,
    held: !!previewUrl,
    hold,
    pin,
    pick,
    reset,
    retry: pin,
  }
}
