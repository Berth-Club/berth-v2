import { keccak_256 } from "@noble/hashes/sha3"

/**
 * Vanity salt miner for BerthClubLaunchFactory.
 *
 * The factory refuses any salt whose CREATE2 address does not end in 0x8787
 * (`VANITY_SUFFIX`, a Solidity constant with no admin toggle), so mining is the
 * caller's job. Ported from arc-launchpad/script/vanity/mineSalt.ts.
 *
 * The derivation, mirroring the factory's `_selectSalt`:
 *
 *   effectiveSalt = keccak256(abi.encode(deployer, salt))
 *   token         = last20(keccak256(0xff ++ factory ++ effectiveSalt ++ initCodeHash))
 *
 * Four things to understand before changing anything here:
 *
 *  - `initCodeHash` depends on the launch config. name, symbol and metadataURI
 *    are constructor arguments, so they are part of the token's init code. A
 *    mined salt is valid ONLY for the exact config it was mined against. Always
 *    read it live via `factory.tokenInitCodeHash(config)` — it also moves with
 *    the token bytecode and compiler settings, so a pinned value mines salts
 *    that every launch rejects.
 *
 *  - `deployer` is mixed in, which is what makes a mined salt worthless to
 *    anyone else: a mempool watcher who copies it lands on a different address
 *    that does not carry the suffix, so their front-run reverts. It also means
 *    `deployer` must be the account that actually SENDS the transaction — with
 *    a smart account or a relayer that is the contract, not the human.
 *
 *  - The salt is a random 28-byte session prefix plus a 4-byte counter, and only
 *    the counter is ground. The prefix is load-bearing: without it, two launches
 *    of the same config by the same wallet re-derive the same addresses and the
 *    second collides with the first's pool.
 *
 *  - The hot loop works on pre-allocated Uint8Arrays and never builds a hex
 *    string. Measured here: 4µs/hash on raw bytes vs ~8.8µs through viem's hex
 *    path. That is the difference between a progress bar and a frozen tab. Do
 *    not "simplify" this to keccak256(encodeAbiParameters(...)).
 */

/** The factory's VANITY_SUFFIX: the low two bytes every token address must carry. */
export const VANITY_SUFFIX = [0x87, 0x87] as const

/** The factory's MAX_SALT_CANDIDATES. Passing more than this reverts. */
export const MAX_SALT_CANDIDATES = 32

/**
 * How many candidates to mine by default.
 *
 * This is NOT a UX knob — it has a hard floor set by chain economics. Squatting
 * a candidate means creating its Uniswap pool first, measured at 4,694,087 gas
 * against Arc's 30,000,000 block gas limit: an attacker can burn at most 6
 * candidates in the single block your transaction is visible. Anything above 6
 * cannot be fully squatted; 12 is double the floor at ~6s of mining.
 */
export const DEFAULT_CANDIDATES = 12

/**
 * Give up on a single salt after this many counters.
 *
 * At 1-in-65,536 odds, 2M attempts is ~30 standard deviations out — reaching it
 * does not mean bad luck, it means the initCodeHash, factory or deployer does
 * not match the chain. Surface that as a configuration error, not a retry.
 */
export const MAX_ITERATIONS_PER_SALT = 2_000_000

export type Hex = `0x${string}`

export type MineParams = {
  factory: Hex
  deployer: Hex
  initCodeHash: Hex
  count?: number
  /** Deterministic prefix. Pass one ONLY to reproduce a run; production wants randomness. */
  prefix?: Uint8Array
  /** Called every `progressEvery` attempts so a worker can post progress. */
  onProgress?: (attempts: number, found: number) => void
  progressEvery?: number
  /** Return true to abort mid-run (user navigated away, config changed). */
  shouldAbort?: () => boolean
}

export type MinedSalt = { salt: Hex; address: Hex }

const HEX = "0123456789abcdef"

function hexToBytes(hex: string, expected: number): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex
  if (clean.length !== expected * 2) {
    throw new Error(`expected ${expected} bytes, got ${clean.length / 2}`)
  }
  const out = new Uint8Array(expected)
  for (let i = 0; i < expected; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return out
}

function bytesToHex(b: Uint8Array): Hex {
  let s = "0x"
  for (let i = 0; i < b.length; i++) {
    const v = b[i] as number
    s += (HEX[v >> 4] as string) + (HEX[v & 15] as string)
  }
  return s as Hex
}

function randomPrefix(): Uint8Array {
  const p = new Uint8Array(28)
  globalThis.crypto.getRandomValues(p)
  return p
}

/**
 * Mines `count` salts whose CREATE2 addresses carry the vanity suffix.
 *
 * Synchronous and CPU-bound by design — call it inside a Web Worker, never on
 * the main thread. `onProgress` and `shouldAbort` are the only way out mid-run.
 */
export function mineSalts(params: MineParams): MinedSalt[] {
  const count = params.count ?? DEFAULT_CANDIDATES
  if (count < 1 || count > MAX_SALT_CANDIDATES) {
    throw new Error(`count must be 1..${MAX_SALT_CANDIDATES}, got ${count}`)
  }

  const factory = hexToBytes(params.factory, 20)
  const deployer = hexToBytes(params.deployer, 20)
  const initCodeHash = hexToBytes(params.initCodeHash, 32)
  const prefix = params.prefix ?? randomPrefix()
  if (prefix.length !== 28) throw new Error("prefix must be 28 bytes")

  // abi.encode(address,bytes32) — the address is LEFT-padded into 32 bytes.
  const saltInput = new Uint8Array(64)
  saltInput.set(deployer, 12)
  const salt = saltInput.subarray(32) // the 32-byte salt, written in place
  salt.set(prefix, 0)

  // 0xff ++ factory(20) ++ effectiveSalt(32) ++ initCodeHash(32)
  const addrInput = new Uint8Array(85)
  addrInput[0] = 0xff
  addrInput.set(factory, 1)
  addrInput.set(initCodeHash, 53)

  const progressEvery = params.progressEvery ?? 20_000
  const found: MinedSalt[] = []
  let attempts = 0

  while (found.length < count) {
    let i = 0
    for (; i < MAX_ITERATIONS_PER_SALT; i++) {
      // Counter into the last 4 bytes, big-endian.
      salt[28] = (i >>> 24) & 0xff
      salt[29] = (i >>> 16) & 0xff
      salt[30] = (i >>> 8) & 0xff
      salt[31] = i & 0xff

      addrInput.set(keccak_256(saltInput), 21)
      const hash = keccak_256(addrInput)

      attempts++
      // The address is the last 20 bytes, so its last 2 bytes are the hash's.
      if (hash[30] === VANITY_SUFFIX[0] && hash[31] === VANITY_SUFFIX[1]) {
        found.push({ salt: bytesToHex(salt), address: bytesToHex(hash.subarray(12)) })
        break
      }

      if (attempts % progressEvery === 0) {
        params.onProgress?.(attempts, found.length)
        if (params.shouldAbort?.()) return found
      }
    }

    if (i >= MAX_ITERATIONS_PER_SALT) {
      throw new Error(
        "salt mining exhausted its iteration budget. This is not bad luck — " +
          "the initCodeHash, factory or deployer almost certainly does not match the chain."
      )
    }

    // Fresh prefix per salt, so the candidates are independent rather than
    // consecutive counters off one prefix.
    salt.set(randomPrefix(), 0)
  }

  params.onProgress?.(attempts, found.length)
  return found
}
