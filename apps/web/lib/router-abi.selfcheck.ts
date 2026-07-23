/**
 * Pins the router ABI to the selectors that exist in the deployed bytecode at
 * UNISWAP.swapRouter on Arc testnet.
 *
 *   node --experimental-strip-types lib/router-abi.selfcheck.ts
 *
 * Worth a check because the failure is silent: add a `deadline` field and
 * `exactInputSingle` becomes 0x414bf389, a function this router does not have.
 * It compiles, type-checks, and reverts with no useful message the first time a
 * real user trades.
 */
import assert from "node:assert/strict"
import { toFunctionSelector } from "viem"

import { swapRouterAbi, EXPECTED_SELECTORS } from "./router-abi.ts"

for (const fn of swapRouterAbi) {
  const expected = EXPECTED_SELECTORS[fn.name]
  assert.ok(expected, `${fn.name} has no expected selector`)
  assert.equal(toFunctionSelector(fn), expected, `${fn.name} encodes to the wrong selector`)
}

const declared = new Set<string>(swapRouterAbi.map((f) => f.name))
for (const name of Object.keys(EXPECTED_SELECTORS)) {
  assert.ok(declared.has(name), `EXPECTED_SELECTORS pins ${name}, but the ABI no longer declares it`)
}

// Selectors that must NOT appear. The v1 shape is the wrong router; the wrap
// helpers would revert on Arc, where the periphery's WETH9 is an inert stub.
const forbidden = {
  "exactInputSingle (SwapRouter v1, with deadline)": "0x414bf389",
  unwrapWETH9: "0x49404b7c",
  refundETH: "0x12210e8a",
}
const ours = new Set(swapRouterAbi.map((f) => toFunctionSelector(f)))
for (const [label, sel] of Object.entries(forbidden)) {
  assert.ok(!ours.has(sel as `0x${string}`), `ABI encodes ${label} (${sel}) — wrong for this deployment`)
}

console.log("router-abi.ts: all checks passed")
