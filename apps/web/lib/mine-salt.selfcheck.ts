/**
 * Pins the miner against a vector the DEPLOYED FACTORY confirmed.
 *
 *   node --experimental-strip-types lib/mine-salt.selfcheck.ts
 *
 * The vector below was produced by mining locally and then asking
 * `predictTokenAddress(deployer, config, salt)` on the live factory at
 * 0xb7738F…768B, which returned the same address with suffixOk and poolFree
 * both true. So this is not a self-consistent fixture — it is the contract's
 * own answer, frozen.
 *
 * Worth pinning because every failure here is silent. Get the abi.encode
 * padding wrong, the byte offsets wrong, or the counter endianness wrong, and
 * the miner still finds addresses ending in 8787 — they are simply not the
 * addresses the factory will compute, so every launch reverts BadVanitySuffix
 * with no clue why.
 */
import assert from "node:assert/strict"

import { mineSalts, VANITY_SUFFIX, DEFAULT_CANDIDATES, MAX_SALT_CANDIDATES } from "./mine-salt.ts"

// --- Ground truth, confirmed by the factory on Arc testnet.
const FACTORY = "0xb7738F4e07845fAa09b7694E5E882e00e0eE768B" as const
const DEPLOYER = "0xB45CffBD45585d10A69890bBE370033745Cd462E" as const
// tokenInitCodeHash({name:"Salt Demo", symbol:"SALT", metadataURI:"ipfs://demo", devBuyMinOut:0})
const INIT_CODE_HASH = "0x5b9f9a892edf6d55b682e1ce441a7a66bf671db59d532ea83fea159baf4f604a" as const
const KNOWN_SALT = "0x0000000000000000000000000000000000000000000000000000000000008ce3" as const
const KNOWN_ADDRESS = "0x25fe048c6acc9cc2e66bbba0e2a0170e49308787" as const

// Reproduce that exact salt: 28 zero bytes of prefix, counter ground to 0x8ce3.
const zeroPrefix = new Uint8Array(28)
const [reproduced] = mineSalts({
  factory: FACTORY,
  deployer: DEPLOYER,
  initCodeHash: INIT_CODE_HASH,
  count: 1,
  prefix: zeroPrefix,
})

assert.equal(reproduced!.salt, KNOWN_SALT, "counter/endianness or byte layout drifted")
assert.equal(
  reproduced!.address.toLowerCase(),
  KNOWN_ADDRESS,
  "derived address does not match what the deployed factory returned"
)

// --- Every mined address must actually carry the suffix. The factory reverts
//     BadVanitySuffix on ANY malformed candidate rather than skipping it, so one
//     bad salt in the array fails the whole launch.
const suffix = `${VANITY_SUFFIX[0].toString(16)}${VANITY_SUFFIX[1].toString(16)}`
assert.equal(suffix, "8787")

const batch = mineSalts({ factory: FACTORY, deployer: DEPLOYER, initCodeHash: INIT_CODE_HASH, count: 4 })
assert.equal(batch.length, 4)
for (const { salt, address } of batch) {
  assert.ok(address.endsWith(suffix), `mined ${address} without the suffix`)
  assert.equal(salt.length, 66, "salt must be 32 bytes")
  assert.equal(address.length, 42, "address must be 20 bytes")
}

// Candidates must be distinct — a repeated address means the per-salt prefix
// refresh broke, and duplicates give a squatter fewer targets to occupy.
assert.equal(new Set(batch.map((b) => b.address)).size, 4, "candidates are not distinct")

// --- A different deployer must produce different addresses from the same salt.
//     This is the whole front-running defence: copying someone's salt lands you
//     somewhere without the suffix, so your transaction reverts.
const [other] = mineSalts({
  factory: FACTORY,
  deployer: "0x000000000000000000000000000000000000dEaD",
  initCodeHash: INIT_CODE_HASH,
  count: 1,
  prefix: zeroPrefix,
})
assert.notEqual(other!.address, KNOWN_ADDRESS, "deployer is not bound into the address")
assert.notEqual(other!.salt, KNOWN_SALT, "a different deployer should need a different counter")

// --- Config binding: a different initCodeHash must not reuse the same salt.
const [otherConfig] = mineSalts({
  factory: FACTORY,
  deployer: DEPLOYER,
  initCodeHash: `0x${"11".repeat(32)}`,
  count: 1,
  prefix: zeroPrefix,
})
assert.notEqual(otherConfig!.address, KNOWN_ADDRESS, "initCodeHash is not bound into the address")

// --- Bounds. The factory reverts above MAX_SALT_CANDIDATES.
assert.throws(() => mineSalts({ factory: FACTORY, deployer: DEPLOYER, initCodeHash: INIT_CODE_HASH, count: 0 }))
assert.throws(() =>
  mineSalts({ factory: FACTORY, deployer: DEPLOYER, initCodeHash: INIT_CODE_HASH, count: MAX_SALT_CANDIDATES + 1 })
)
assert.ok(DEFAULT_CANDIDATES > 6, "default must exceed the 6-per-block squat ceiling")
assert.ok(DEFAULT_CANDIDATES <= MAX_SALT_CANDIDATES)

// --- Abort must actually stop, and return what it had.
let ticks = 0
const partial = mineSalts({
  factory: FACTORY,
  deployer: DEPLOYER,
  initCodeHash: INIT_CODE_HASH,
  count: MAX_SALT_CANDIDATES,
  progressEvery: 1_000,
  onProgress: () => { ticks++ },
  shouldAbort: () => ticks >= 3,
})
assert.ok(partial.length < MAX_SALT_CANDIDATES, "shouldAbort did not stop the run")

console.log("mine-salt.ts: all checks passed")
