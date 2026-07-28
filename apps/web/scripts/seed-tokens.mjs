/**
 * Batch-launch a folder of tokens (a `tokens.json` + image files) — for seeding
 * the launchpad. Runs the SAME pipeline the UI does: pin image → build the exact
 * metadataURI → mine the vanity salt → deploy at the token's fee tier.
 *
 * Your PRIVATE_KEY and PINATA_JWT stay in your shell — never printed.
 *
 * Run from apps/web:
 *   cd apps/web
 *   PRIVATE_KEY=0x… PINATA_JWT=eyJ… node scripts/seed-tokens.mjs
 *
 * Env:
 *   PRIVATE_KEY   (required) launching wallet
 *   PINATA_JWT    (required) same JWT the app uses to pin
 *   TOKENS_DIR    folder holding tokens.json + images. default "~/Downloads/tokens 2"
 *   START=0       skip the first N (resume after a failure)
 *   LIMIT=50      launch at most N (e.g. LIMIT=3 for a smoke test)
 *   RPC=…         default https://rpc.testnet.arc.network
 *
 * Needs ≈ (1 USDC × count) + gas. All 50 in the sample are 1% tier, dev-buy 0.
 */
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { createPublicClient, createWalletClient, http, formatUnits, getAddress } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { keccak_256 } from "@noble/hashes/sha3"
import { PinataSDK } from "pinata"

// ---------------------------------------------------------------- config
const RPC = process.env.RPC || process.env.NEXT_PUBLIC_RPC_URL || "https://rpc.testnet.arc.network"
const CHAIN = { id: 5042002, name: "Arc Testnet", nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } }
const FACTORY = "0x82A613C19787D88d648C04F8Ad7Bd6825193e317"
const DIR = process.env.TOKENS_DIR || path.join(os.homedir(), "Downloads", "tokens 2")
const START = Number(process.env.START || 0)
const LIMIT = Number(process.env.LIMIT || Infinity)

if (!process.env.PRIVATE_KEY || !process.env.PINATA_JWT) {
  console.error("Set PRIVATE_KEY=0x… and PINATA_JWT=eyJ… (neither is printed).")
  process.exit(1)
}

const SPRITE_EMOJI = { cat: "🐱", dog: "🐶", frog: "🐸", alien: "👽", bag: "💰", chart: "📈", dollar: "💵", floppy: "💾", heart: "❤️", planet: "🪐", rocket: "🚀", smiley: "🙂" }
const feeToId = (t) => (t === "0.3%" ? 1n : t === "0.05%" ? 2n : 0n)
const asUrl = (s) => (s ? (/^https?:\/\//.test(s) ? s : "https://" + s.replace(/^\/+/, "")) : undefined)

// normalizeTicker + buildMetadataURI — byte-identical to apps/web/lib/metadata.ts
function normalizeTicker(raw) { return raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) }
function buildMetadataURI(name, ticker, lore, emoji, imageUri, links) {
  const symbol = normalizeTicker(ticker)
  const meta = { name: name.trim(), symbol, description: lore.trim(), emoji, image: imageUri }
  if (links?.twitter?.trim()) meta.twitter = links.twitter.trim()
  if (links?.telegram?.trim()) meta.telegram = links.telegram.trim()
  if (links?.website?.trim()) meta.website = links.website.trim()
  return `data:application/json,${encodeURIComponent(JSON.stringify(meta))}`
}

// ---------------------------------------------------------------- ABIs
const cfgTuple = { name: "config", type: "tuple", components: [
  { name: "name", type: "string" }, { name: "symbol", type: "string" },
  { name: "metadataURI", type: "string" }, { name: "devBuyMinOut", type: "uint256" }] }
const factoryAbi = [
  { type: "function", name: "launchFee", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "tokenInitCodeHash", stateMutability: "view", inputs: [cfgTuple], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "deploy", stateMutability: "payable", inputs: [cfgTuple, { name: "curveConfigId", type: "uint256" }, { name: "salts", type: "bytes32[]" }], outputs: [{ type: "address" }, { type: "uint256" }] },
  { type: "event", name: "TokenLaunched", inputs: [
    { name: "token", type: "address", indexed: true }, { name: "creator", type: "address", indexed: true },
    { name: "pool", type: "address", indexed: false }, { name: "tokenId", type: "uint256", indexed: false },
    { name: "curveConfigId", type: "uint256", indexed: false }, { name: "fee", type: "uint24", indexed: false }], anonymous: false },
]

// ---------------------------------------------------------------- salt miner (ported from lib/mine-salt.ts)
const SUFFIX = [0x87, 0x87]
const hexToBytes = (h, n) => { const c = h.slice(2), o = new Uint8Array(n); for (let i = 0; i < n; i++) o[i] = parseInt(c.slice(i * 2, i * 2 + 2), 16); return o }
const bytesToHex = (b) => "0x" + [...b].map((v) => v.toString(16).padStart(2, "0")).join("")
function mineSalts(factory, deployer, initCodeHash, count = 12) {
  const f = hexToBytes(factory, 20), d = hexToBytes(deployer, 20), ich = hexToBytes(initCodeHash, 32)
  const saltInput = new Uint8Array(64); saltInput.set(d, 12); const salt = saltInput.subarray(32)
  const addrInput = new Uint8Array(85); addrInput[0] = 0xff; addrInput.set(f, 1); addrInput.set(ich, 53)
  const found = []
  while (found.length < count) {
    const p = new Uint8Array(28); for (let i = 0; i < 28; i++) p[i] = (Math.random() * 256) | 0
    salt.set(p, 0); let hit = false
    for (let i = 0; i < 2_000_000; i++) {
      salt[28] = (i >>> 24) & 0xff; salt[29] = (i >>> 16) & 0xff; salt[30] = (i >>> 8) & 0xff; salt[31] = i & 0xff
      addrInput.set(keccak_256(saltInput), 21)
      const h = keccak_256(addrInput)
      if (h[30] === SUFFIX[0] && h[31] === SUFFIX[1]) { found.push(bytesToHex(salt)); hit = true; break }
    }
    if (!hit) throw new Error("mining exhausted")
  }
  return found
}

// ---------------------------------------------------------------- run
// Single-instance lock: two concurrent runs share a nonce and re-launch the same
// tokens as duplicates. Refuse if another run is active (stale after 20 min).
const LOCK = path.join(os.tmpdir(), "berth-seed.lock")
try {
  const st = fs.existsSync(LOCK) ? fs.statSync(LOCK) : null
  if (st && Date.now() - st.mtimeMs < 20 * 60 * 1000) {
    console.error(`Another seed run looks active (${LOCK}). Wait for it, or delete that file if it crashed.`)
    process.exit(1)
  }
  fs.writeFileSync(LOCK, String(process.pid))
} catch {}
const unlock = () => { try { fs.unlinkSync(LOCK) } catch {} }
process.on("exit", unlock)
process.on("SIGINT", () => { unlock(); process.exit(1) })

const tokens = JSON.parse(fs.readFileSync(path.join(DIR, "tokens.json"), "utf8"))
const account = privateKeyToAccount(process.env.PRIVATE_KEY)
const pub = createPublicClient({ chain: CHAIN, transport: http(RPC) })
const wallet = createWalletClient({ account, chain: CHAIN, transport: http(RPC) })
const pinata = new PinataSDK({ pinataJwt: process.env.PINATA_JWT })
const launchFee = await pub.readContract({ address: FACTORY, abi: factoryAbi, functionName: "launchFee" })

console.log(`account ${account.address}`)
console.log(`${tokens.length} tokens in ${DIR} · launchFee ${formatUnits(launchFee, 18)} USDC each`)

// Pre-flight: refuse to pin 50 images then fail every deploy on an empty wallet.
// The launch fee is msg.value in NATIVE USDC (18-dec) — check the native balance
// (getBalance), NOT the 6-dec ERC20 balanceOf at 0x3600… (Arc's dual-decimal USDC).
const bal = await pub.getBalance({ address: account.address })
const need = Math.min(Math.max(0, tokens.length - START), LIMIT) // launches this run intends
console.log(`balance ${formatUnits(bal, 18)} USDC · covers ~${Number(bal / launchFee)} launch(es), need ~${need}`)
if (bal < launchFee) {
  console.error(`\nNot enough USDC to launch anything. Fund ${account.address} with ~${need} USDC + gas and re-run.`)
  process.exit(1)
}
const results = []
const slice = tokens.slice(START, START + LIMIT)

for (let i = 0; i < slice.length; i++) {
  const t = slice[i]
  const n = START + i + 1
  const symbol = normalizeTicker(t.ticker)
  process.stdout.write(`[${n}/${tokens.length}] $${symbol} ${t.name} … `)
  try {
    // 1. pin the image
    const imgPath = path.join(DIR, path.basename(t.image))
    const buf = fs.readFileSync(imgPath)
    const type = imgPath.endsWith(".png") ? "image/png" : imgPath.match(/jpe?g$/) ? "image/jpeg" : imgPath.endsWith(".webp") ? "image/webp" : "image/png"
    const up = await pinata.upload.public.file(new File([new Uint8Array(buf)], path.basename(imgPath), { type }))
    if (!up?.cid) throw new Error("pin returned no cid")
    const imageUri = `ipfs://${up.cid}`

    // 2. metadata + config
    const emoji = SPRITE_EMOJI[t.sprite] || "🚢"
    const metadataURI = buildMetadataURI(t.name, t.ticker, t.description || "", emoji, imageUri, {
      twitter: asUrl(t.x_profile), telegram: asUrl(t.telegram),
    })
    const config = { name: t.name.trim(), symbol, metadataURI, devBuyMinOut: 0n }

    // 3. mine + deploy at the token's fee tier
    const ich = await pub.readContract({ address: FACTORY, abi: factoryAbi, functionName: "tokenInitCodeHash", args: [config] })
    const salts = mineSalts(FACTORY, account.address, ich, 12)
    const curveId = feeToId(t.fee_tier)
    const value = launchFee + (t.dev_buy_usdc ? BigInt(Math.round(t.dev_buy_usdc)) * 10n ** 18n : 0n)
    const hash = await wallet.writeContract({ address: FACTORY, abi: factoryAbi, functionName: "deploy", args: [config, curveId, salts], value })
    const rcpt = await pub.waitForTransactionReceipt({ hash })
    if (rcpt.status !== "success") throw new Error(`tx reverted ${hash}`)
    // TokenLaunched's first indexed arg is `token` → topics[1]. Every launched
    // token address ends in the 8787 vanity suffix, which uniquely identifies it
    // among the factory's logs — no full event ABI needed.
    let token
    for (const log of rcpt.logs) {
      if (log.address.toLowerCase() !== FACTORY.toLowerCase() || !log.topics[1]) continue
      const cand = getAddress("0x" + log.topics[1].slice(26))
      if (cand.toLowerCase().endsWith("8787")) { token = cand; break }
    }
    console.log(`✓ ${token}`)
    results.push({ symbol, token, ok: true })
  } catch (e) {
    console.log(`✗ ${(e.shortMessage || e.message || String(e)).slice(0, 100)}`)
    results.push({ symbol, ok: false, err: e.shortMessage || e.message })
  }
}

const ok = results.filter((r) => r.ok).length
console.log(`\ndone — ${ok}/${results.length} launched.`)
const failed = results.filter((r) => !r.ok)
if (failed.length) console.log("failed:", failed.map((f) => f.symbol).join(", "), "· re-run with START=<index> to resume")
