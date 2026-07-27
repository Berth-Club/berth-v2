"use client"

import * as React from "react"

/**
 * The v3 background sea. A 2D-canvas night scene ported verbatim from the
 * design prototype's initSea(): ~340 twinkling stars with slow parallax,
 * periodic shooting stars, and a perspective-projected point-mesh ocean with
 * three layered sine swells, a moonlight glitter column, and a horizon fog band.
 *
 * Engineering contract (from the handoff): DPR capped at 1.5, first frame
 * painted synchronously, the loop wrapped in try/catch, a ~1.5s watchdog that
 * restarts a stalled loop (never while the tab is hidden), prefers-reduced-motion
 * renders a single still frame, and everything is torn down on unmount.
 */
export function Sea() {
  const ref = React.useRef<HTMLCanvasElement | null>(null)

  React.useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const ctx = cv.getContext("2d")
    if (!ctx) return

    const DPR = Math.min(1.5, window.devicePixelRatio || 1)
    let W = 0
    let H = 0
    let raf: number | null = null
    let beat = performance.now()
    let warned = false

    const resize = () => {
      W = cv.clientWidth
      H = cv.clientHeight
      cv.width = Math.round(W * DPR)
      cv.height = Math.round(H * DPR)
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0)
    }
    resize()
    window.addEventListener("resize", resize)

    let px = 0
    let py = 0
    let tx = 0
    let ty = 0
    const move = (e: PointerEvent) => {
      tx = e.clientX / window.innerWidth - 0.5
      ty = e.clientY / window.innerHeight - 0.5
    }
    window.addEventListener("pointermove", move)

    const stars = Array.from({ length: 340 }, () => ({
      x: Math.random() * 2 - 1,
      y: Math.random(),
      z: 0.25 + Math.random() * 0.75,
      p: Math.random() * 6.28,
      s: 0.5 + Math.random(),
    }))
    let shoot: { x: number; y: number; a: number } | null = null
    let nextShoot = 5
    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const t0 = performance.now()

    const frame = (now: number) => {
      beat = performance.now()
      const t = (now - t0) / 1000
      px += (tx - px) * 0.03
      py += (ty - py) * 0.03
      ctx.clearRect(0, 0, W, H)
      const hy = H * 0.74
      for (const st of stars) {
        const sx = (st.x + px * 0.07 * st.z) * W * 0.5 + W * 0.5
        const sy = st.y * hy * 0.96 + py * st.z * 18
        const tw = 0.55 + 0.45 * Math.sin(t * st.s + st.p)
        const a2 = (1.1 - st.z) * 0.5 * tw + 0.08
        ctx.fillStyle = "rgba(214,228,248," + a2.toFixed(3) + ")"
        ctx.fillRect(sx, sy, st.z < 0.45 ? 1.6 : 1, st.z < 0.45 ? 1.6 : 1)
      }
      nextShoot -= 1 / 60
      if (!shoot && nextShoot <= 0)
        shoot = { x: W * (0.12 + Math.random() * 0.6), y: hy * (0.08 + Math.random() * 0.32), a: 1 }
      if (shoot) {
        shoot.x += W * 0.012
        shoot.y += H * 0.0042
        shoot.a -= 0.022
        if (shoot.a <= 0) {
          shoot = null
          nextShoot = 7 + Math.random() * 10
        } else {
          const g = ctx.createLinearGradient(shoot.x - 92, shoot.y - 30, shoot.x, shoot.y)
          g.addColorStop(0, "rgba(214,228,248,0)")
          g.addColorStop(1, "rgba(214,228,248," + (shoot.a * 0.8).toFixed(3) + ")")
          ctx.strokeStyle = g
          ctx.lineWidth = 1.2
          ctx.beginPath()
          ctx.moveTo(shoot.x - 92, shoot.y - 30)
          ctx.lineTo(shoot.x, shoot.y)
          ctx.stroke()
        }
      }
      const sea = ctx.createLinearGradient(0, hy, 0, H)
      sea.addColorStop(0, "rgba(16,44,58,.72)")
      sea.addColorStop(1, "rgba(8,16,32,.92)")
      ctx.fillStyle = sea
      ctx.fillRect(0, hy, W, H - hy)
      const hg = ctx.createLinearGradient(0, hy - 14, 0, hy + 10)
      hg.addColorStop(0, "rgba(143,176,232,0)")
      hg.addColorStop(0.5, "rgba(160,196,240,.15)")
      hg.addColorStop(1, "rgba(143,176,232,0)")
      ctx.fillStyle = hg
      ctx.fillRect(0, hy - 14, W, 24)
      const f = Math.max(H * 0.9, W * 0.5)
      const camH = 1.7
      const yaw = px * 0.35
      for (let r = 0; r < 34; r++) {
        const z = 2.2 * Math.pow(1.115, r)
        const depthA = Math.min(1, 2.6 / z)
        for (let c = 0; c <= 72; c++) {
          const x = (c / 72 - 0.5) * (z * 1.9 + 3)
          const w =
            Math.sin(x * 0.55 + z * 0.9 + t * 1.05) * 0.5 +
            Math.sin(x * 1.3 - z * 0.55 + t * 0.62) * 0.3 +
            Math.sin(x * 2.6 + z * 0.25 + t * 1.85) * 0.18
          const y = w * 0.16 * Math.min(1, z * 0.12)
          const sx = W * 0.5 + ((x - yaw * z * 0.22) / z) * f
          if (sx < -6 || sx > W + 6) continue
          const sy = hy + ((camH + y + py * 0.5) / z) * f * 0.52
          if (sy > H + 4 || sy < hy - 2) continue
          const gl = Math.max(0, 1 - Math.abs(sx - W * 0.5) / (W * 0.06 + (sy - hy) * 0.55))
          const spark = gl > 0 ? gl * (0.35 + 0.65 * Math.max(0, Math.sin(t * 2.4 + x * 7.3 + z * 3.1))) : 0
          const a3 = depthA * 0.34 + spark * 0.5
          if (a3 < 0.02) continue
          ctx.fillStyle =
            spark > 0.25 ? "rgba(214,232,255," + a3.toFixed(3) + ")" : "rgba(146,180,222," + a3.toFixed(3) + ")"
          ctx.fillRect(sx, sy, depthA > 0.55 ? 1.7 : 1, (depthA > 0.55 ? 1.7 : 1) + (spark > 0.5 ? 1 : 0))
        }
      }
      const fog = ctx.createLinearGradient(0, hy, 0, hy + H * 0.1)
      fog.addColorStop(0, "rgba(13,32,48,.5)")
      fog.addColorStop(1, "rgba(13,32,48,0)")
      ctx.fillStyle = fog
      ctx.fillRect(0, hy, W, H * 0.1)
      if (!reduced) raf = requestAnimationFrame(safeFrame)
    }

    const safeFrame = (now: number) => {
      try {
        frame(now)
      } catch (err) {
        if (!warned) {
          warned = true
          console.error("sea frame", err)
        }
        if (!reduced) raf = requestAnimationFrame(safeFrame)
      }
    }

    // First frame synchronously so there is never a blank flash.
    safeFrame(performance.now())

    // Watchdog: if the loop stalls (throttled tab, GPU hiccup) restart it —
    // but never while hidden, and never under reduced motion (one still frame).
    const watchdog = reduced
      ? null
      : window.setInterval(() => {
          if (document.hidden) return
          if (performance.now() - beat > 1500) {
            if (raf) cancelAnimationFrame(raf)
            safeFrame(performance.now())
          }
        }, 1500)

    return () => {
      if (raf) cancelAnimationFrame(raf)
      if (watchdog) window.clearInterval(watchdog)
      window.removeEventListener("resize", resize)
      window.removeEventListener("pointermove", move)
    }
  }, [])

  return <canvas ref={ref} className="absolute inset-0 h-full w-full" aria-hidden />
}
