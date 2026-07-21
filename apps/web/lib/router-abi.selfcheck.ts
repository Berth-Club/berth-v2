/**
 * Pins the router ABI to the selectors that actually exist in UnitFlow's
 * deployed bytecode on Arc Testnet.
 *
 * This is worth a check because both failure modes are silent. Drop the
 * `deadline` field and `exactInputSingle` becomes 0x04e45aaf — a function this
 * router does not have. Rename `unwrapWUSDC` back to the Uniswap-standard
 * `unwrapWETH9` and it becomes 0x49404b7c — also absent. Either one compiles
 * fine, type-checks fine, and reverts with no useful message the first time a
 * real user sells.
 *
 *   node --experimental-strip-types lib/router-abi.selfcheck.ts
 *
 * The expected values were read out of the chain, not out of a doc:
 *   cast code 0x509cF58CdA08C7aee83a2BdBb4A1Eac907343D01 | grep <selector>
 */
import assert from "node:assert/strict"
import { toFunctionSelector } from "viem"

import { swapRouterAbi, EXPECTED_SELECTORS } from "./router-abi.ts"

for (const fn of swapRouterAbi) {
  const expected = EXPECTED_SELECTORS[fn.name]
  assert.ok(expected, `${fn.name} has no expected selector — add one or drop the function`)
  assert.equal(
    toFunctionSelector(fn),
    expected,
    `${fn.name} encodes to ${toFunctionSelector(fn)}, but Arc's router only answers ${expected}`
  )
}

// Every pinned selector must correspond to a function we actually declare, or
// the map rots into a list of claims nothing enforces.
const declared = new Set<string>(swapRouterAbi.map((f) => f.name))
for (const name of Object.keys(EXPECTED_SELECTORS)) {
  assert.ok(declared.has(name), `EXPECTED_SELECTORS pins ${name}, but the ABI no longer declares it`)
}

// The selectors that must NOT appear: the Robinhood-era shapes. If either
// of these ever equals one of ours, the retarget has been silently reverted.
const forbidden = {
  "exactInputSingle (SwapRouter02, no deadline)": "0x04e45aaf",
  "unwrapWETH9 (Uniswap-standard name)": "0x49404b7c",
  "refundETH (Uniswap-standard name)": "0x12210e8a",
}
const ours = new Set(swapRouterAbi.map((f) => toFunctionSelector(f)))
for (const [label, sel] of Object.entries(forbidden)) {
  assert.ok(!ours.has(sel as `0x${string}`), `ABI encodes ${label} (${sel}) — that function does not exist on Arc`)
}

console.log("router-abi.ts: all checks passed")
