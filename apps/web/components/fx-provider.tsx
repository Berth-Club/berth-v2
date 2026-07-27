"use client"

import * as React from "react"

// Spec: ~80 pieces, these 5 colours, squares + circles 6–14px,
// fall translateY(115vh) + rotate 900deg over 2–3.6s.
const CONFETTI_COLORS = ["#8fb0e8", "#89a7db", "#7cc9a3", "#F472B6", "#22D3EE"]
const PIECES = 80

type Piece = {
  id: number
  left: number
  color: string
  size: number
  round: boolean
  delay: number
  duration: number
}

type Fx = {
  toast: (message: string) => void
  confetti: () => void
  /** Fire both — the standard celebration (buy / launch / claim / whitelist). */
  celebrate: (message: string) => void
}

const FxContext = React.createContext<Fx | null>(null)

export function useFx(): Fx {
  const ctx = React.useContext(FxContext)
  if (!ctx) throw new Error("useFx must be used inside <FxProvider>")
  return ctx
}

export function FxProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = React.useState<string | null>(null)
  const [pieces, setPieces] = React.useState<Piece[]>([])
  const seq = React.useRef(0)

  const toast = React.useCallback((m: string) => {
    setMessage(m)
    window.setTimeout(() => setMessage(null), 2800) // auto-dismiss ~2.8s
  }, [])

  const confetti = React.useCallback(() => {
    const batch = seq.current++
    const next: Piece[] = Array.from({ length: PIECES }, (_, i) => ({
      id: batch * PIECES + i,
      left: Math.random() * 100,
      color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)]!,
      size: 6 + Math.random() * 8,
      round: Math.random() > 0.5,
      delay: Math.random() * 0.3,
      duration: 2 + Math.random() * 1.6,
    }))
    setPieces((p) => [...p, ...next])
    window.setTimeout(() => {
      setPieces((p) => p.filter((x) => Math.floor(x.id / PIECES) !== batch))
    }, 4200)
  }, [])

  const celebrate = React.useCallback(
    (m: string) => {
      confetti()
      toast(m)
    },
    [confetti, toast]
  )

  const value = React.useMemo(() => ({ toast, confetti, celebrate }), [toast, confetti, celebrate])

  return (
    <FxContext.Provider value={value}>
      {children}

      {/* confetti */}
      {pieces.length > 0 && (
        <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden" aria-hidden>
          {pieces.map((p) => (
            <span
              key={p.id}
              className="absolute -top-4 block"
              style={{
                left: `${p.left}%`,
                width: p.size,
                height: p.size,
                background: p.color,
                borderRadius: p.round ? "50%" : 2,
                animation: `confettiFall ${p.duration}s linear ${p.delay}s forwards`,
              }}
            />
          ))}
        </div>
      )}

      {/* toast — bottom-center pill, lime border, slide-up */}
      {message && (
        <div
          role="status"
          className="font-display fixed bottom-6 left-1/2 z-50 -translate-x-1/2 px-5 py-3 text-[15px]"
          style={{
            background: "#1b3450",
            border: "2px solid #8fb0e8",
            borderRadius: 14,
            animation: "toastUp .25s ease-out",
          }}
        >
          {message}
        </div>
      )}
    </FxContext.Provider>
  )
}
