"use client"

import * as React from "react"

import type { Hex, MinedSalt } from "@/lib/mine-salt"
import { DEFAULT_CANDIDATES } from "@/lib/mine-salt"
import type { MineRequest, MineResponse } from "@/lib/mine-salt.worker"

/**
 * Mines vanity salts across a pool of Web Workers.
 *
 * A pool rather than one worker, because one is not fast enough. Measured on a
 * desktop core: 830ms per candidate, so the 12-candidate default is ~10s
 * single-threaded — and a mid-range phone is roughly 4x slower again, which is
 * ~40s of a dead-looking launch button. Split across cores that lands near 2s
 * on a laptop and under 10s on a phone.
 *
 * Why 12 candidates: squatting one means creating its Uniswap pool first, at
 * 4,694,087 gas against Arc's 30,000,000 block limit — so an attacker can burn
 * at most 6 in the single block your transaction is visible. 12 is double that
 * ceiling. Below 7 the whole set can be squatted and the launch fails.
 */

export type MinerStatus = "idle" | "mining" | "done" | "error"

export type SaltMiner = {
  status: MinerStatus
  /** Mined candidates, in the order the factory will try them. */
  salts: MinedSalt[]
  /** The address the coin will land on — the first candidate. undefined until done. */
  predicted?: Hex
  /** Hashes attempted so far, for an indeterminate progress readout. */
  attempts: number
  /** 0-1, by candidates found. Completion time is probabilistic, so this is a
   *  count of real results, never an extrapolated percentage. */
  progress: number
  error?: string
  /** Begin (or restart) mining. Safe to call repeatedly; supersedes any run. */
  mine: (factory: Hex, deployer: Hex, initCodeHash: Hex) => void
  /** Discard everything and stop. Call when the config or wallet changes. */
  reset: () => void
}

/** Leave a core for the UI thread; cap so we do not spawn 16 workers on a big machine. */
function poolSize(): number {
  const cores = typeof navigator !== "undefined" ? (navigator.hardwareConcurrency ?? 4) : 4
  return Math.max(1, Math.min(8, cores - 1))
}

export function useSaltMiner(count: number = DEFAULT_CANDIDATES): SaltMiner {
  const [status, setStatus] = React.useState<MinerStatus>("idle")
  const [salts, setSalts] = React.useState<MinedSalt[]>([])
  const [attempts, setAttempts] = React.useState(0)
  const [error, setError] = React.useState<string>()

  const workers = React.useRef<Worker[]>([])
  // Bumped on every mine()/reset(). A worker message carrying a stale id is
  // dropped — otherwise a slow worker from an abandoned config could deliver
  // salts for a name the creator has already edited, and those salts feed the
  // predicted address. Showing an address the coin will not land on is the one
  // failure this hook exists to prevent.
  const runId = React.useRef(0)

  const teardown = React.useCallback(() => {
    for (const w of workers.current) {
      w.postMessage({ type: "abort" })
      w.terminate()
    }
    workers.current = []
  }, [])

  const reset = React.useCallback(() => {
    runId.current++
    teardown()
    setStatus("idle")
    setSalts([])
    setAttempts(0)
    setError(undefined)
  }, [teardown])

  const mine = React.useCallback(
    (factory: Hex, deployer: Hex, initCodeHash: Hex) => {
      runId.current++
      const id = runId.current
      teardown()
      setStatus("mining")
      setSalts([])
      setAttempts(0)
      setError(undefined)

      const n = poolSize()
      // Spread the target across workers; the remainder goes to the first few.
      const shares = Array.from({ length: n }, (_, i) => Math.floor(count / n) + (i < count % n ? 1 : 0)).filter(
        (s) => s > 0
      )

      const collected: MinedSalt[] = []
      let finished = 0
      const perWorkerAttempts = new Array(shares.length).fill(0)

      workers.current = shares.map((share, i) => {
        const w = new Worker(new URL("./mine-salt.worker.ts", import.meta.url), { type: "module" })

        w.onmessage = (e: MessageEvent<MineResponse>) => {
          if (runId.current !== id) return // superseded
          const msg = e.data
          if (msg.type === "progress") {
            perWorkerAttempts[i] = msg.attempts
            setAttempts(perWorkerAttempts.reduce((a, b) => a + b, 0))
          } else if (msg.type === "done") {
            collected.push(...msg.salts)
            if (++finished === shares.length) {
              setSalts(collected)
              setStatus(collected.length > 0 ? "done" : "error")
              if (collected.length === 0) setError("Mining produced no candidates.")
              teardown()
            }
          } else {
            setStatus("error")
            setError(msg.message)
            teardown()
          }
        }

        w.onerror = () => {
          if (runId.current !== id) return
          setStatus("error")
          setError("The miner failed to start in this browser.")
          teardown()
        }

        w.postMessage({ type: "mine", factory, deployer, initCodeHash, count: share } satisfies MineRequest)
        return w
      })
    },
    [count, teardown]
  )

  React.useEffect(() => () => teardown(), [teardown])

  return {
    status,
    salts,
    predicted: salts[0]?.address,
    attempts,
    progress: count > 0 ? Math.min(1, salts.length / count) : 0,
    error,
    mine,
    reset,
  }
}
