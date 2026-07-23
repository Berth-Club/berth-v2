/// <reference lib="webworker" />
import { mineSalts, type Hex, type MinedSalt } from "./mine-salt"

/**
 * Web Worker wrapper around the salt miner.
 *
 * Mining is a synchronous, CPU-bound grind — several seconds of a pegged core.
 * On the main thread that is a frozen tab on exactly the low-end phones this
 * audience arrives on, so it lives here instead.
 *
 * Abort is cooperative rather than `worker.terminate()`: the loop checks a flag
 * every `progressEvery` attempts and returns what it has. Terminating mid-hash
 * would discard salts already found, and the common abort reason (the creator
 * edited a field) wants a clean restart, not a half-killed worker.
 */

export type MineRequest = {
  type: "mine"
  factory: Hex
  deployer: Hex
  initCodeHash: Hex
  count?: number
}

export type MineResponse =
  | { type: "progress"; attempts: number; found: number }
  | { type: "done"; salts: MinedSalt[] }
  | { type: "error"; message: string }

let aborted = false

self.onmessage = (e: MessageEvent<MineRequest | { type: "abort" }>) => {
  if (e.data.type === "abort") {
    aborted = true
    return
  }
  if (e.data.type !== "mine") return

  aborted = false
  const { factory, deployer, initCodeHash, count } = e.data

  try {
    const salts = mineSalts({
      factory,
      deployer,
      initCodeHash,
      count,
      onProgress: (attempts, found) => {
        ;(self as unknown as Worker).postMessage({ type: "progress", attempts, found } satisfies MineResponse)
      },
      shouldAbort: () => aborted,
    })
    if (!aborted) {
      ;(self as unknown as Worker).postMessage({ type: "done", salts } satisfies MineResponse)
    }
  } catch (err) {
    ;(self as unknown as Worker).postMessage({
      type: "error",
      message: err instanceof Error ? err.message : "mining failed",
    } satisfies MineResponse)
  }
}
