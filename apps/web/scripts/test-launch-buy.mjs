/**
 * End-to-end contract test for the fee-tier launch + 1-tx permit buy.
 *
 * Runs the EXACT calls the frontend makes, so a pass here validates the
 * contract-critical wiring (curve preset / fee tier, salt mining, permit domain,
 * router multicall). Your key stays in your shell — it is never printed.
 *
 * Run from apps/web (so it resolves viem + @noble/hashes):
 *
 *   cd apps/web
 *   PRIVATE_KEY=0x… node scripts/test-launch-buy.mjs
 *
 * Env knobs (all optional except PRIVATE_KEY):
 *   TIER=0|1|2      curve preset / fee tier to launch (0=1%, 1=0.3%, 2=0.05%). default 0
 *   NAME="…"        token name.   default "Test Reef"
 *   SYMBOL="…"      ticker.        default TREEF<random>
 *   DEV_BUY=0.0     dev buy in USDC (funds your atomic first buy). default 0
 *   BUY=0.5         after launch, buy this many USDC via permit+multicall (1 tx). default: skip
 *   RPC=…           override RPC. default https://rpc.testnet.arc.network
 *
 * Needs ≥ (1 + DEV_BUY + BUY) USDC + gas in the wallet.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  parseSignature,
  parseUnits,
  formatUnits,
  decodeEventLog,
} from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { keccak_256 } from "@noble/hashes/sha3"

// ---------------------------------------------------------------- config
const RPC = process.env.RPC || "https://rpc.testnet.arc.network"
const CHAIN = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
}
const FACTORY = "0x82A613C19787D88d648C04F8Ad7Bd6825193e317"
const ROUTER = "0xB5D2f3Aae27dd5F4682B059A20c47f0a5B831c7f"
const QUOTER = "0xb1A5136826aDE2C39aBA4800442dCc223A2A7604"
const USDC = "0x3600000000000000000000000000000000000000"

const TIER = BigInt(process.env.TIER ?? "0")
const NAME = process.env.NAME || "Test Reef"
const SYMBOL = process.env.SYMBOL || "TREEF" + Math.floor(Math.random() * 100000)
const DEV_BUY_WEI = process.env.DEV_BUY ? parseUnits(process.env.DEV_BUY, 18) : 0n
const BUY_USDC = process.env.BUY ? parseUnits(process.env.BUY, 6) : 0n

if (!process.env.PRIVATE_KEY) {
  console.error("Set PRIVATE_KEY=0x… (it is never printed).")
  process.exit(1)
}

// ---------------------------------------------------------------- ABIs (minimal)
const factoryAbi = [
  { type: "function", name: "launchFee", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "tokenInitCodeHash",
    stateMutability: "view",
    inputs: [{ name: "config", type: "tuple", components: [
      { name: "name", type: "string" }, { name: "symbol", type: "string" },
      { name: "metadataURI", type: "string" }, { name: "devBuyMinOut", type: "uint256" }] }],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "predictTokenAddress",
    stateMutability: "view",
    inputs: [
      { name: "deployer", type: "address" },
      { name: "config", type: "tuple", components: [
        { name: "name", type: "string" }, { name: "symbol", type: "string" },
        { name: "metadataURI", type: "string" }, { name: "devBuyMinOut", type: "uint256" }] },
      { name: "salt", type: "bytes32" },
      { name: "curveConfigId", type: "uint256" },
    ],
    outputs: [{ type: "address" }, { type: "bool" }, { type: "bool" }],
  },
  {
    type: "function",
    name: "deploy",
    stateMutability: "payable",
    inputs: [
      { name: "config", type: "tuple", components: [
        { name: "name", type: "string" }, { name: "symbol", type: "string" },
        { name: "metadataURI", type: "string" }, { name: "devBuyMinOut", type: "uint256" }] },
      { name: "curveConfigId", type: "uint256" },
      { name: "salts", type: "bytes32[]" },
    ],
    outputs: [{ type: "address" }, { type: "uint256" }],
  },
  { type: "function", name: "feeTierOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint24" }] },
  {
    type: "event",
    name: "TokenLaunched",
    inputs: [
      { name: "token", type: "address", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "pool", type: "address", indexed: false },
      { name: "tokenId", type: "uint256", indexed: false },
      { name: "curveConfigId", type: "uint256", indexed: false },
      { name: "fee", type: "uint24", indexed: false },
    ],
    anonymous: false,
  },
]
const erc20 = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "nonces", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "version", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
]
const routerAbi = [
  { type: "function", name: "multicall", stateMutability: "payable", inputs: [{ name: "data", type: "bytes[]" }], outputs: [{ type: "bytes[]" }] },
  { type: "function", name: "selfPermit", stateMutability: "payable", inputs: [
    { name: "token", type: "address" }, { name: "value", type: "uint256" }, { name: "deadline", type: "uint256" },
    { name: "v", type: "uint8" }, { name: "r", type: "bytes32" }, { name: "s", type: "bytes32" }], outputs: [] },
  { type: "function", name: "exactInputSingle", stateMutability: "payable", inputs: [{ name: "params", type: "tuple", components: [
    { name: "tokenIn", type: "address" }, { name: "tokenOut", type: "address" }, { name: "fee", type: "uint24" },
    { name: "recipient", type: "address" }, { name: "amountIn", type: "uint256" }, { name: "amountOutMinimum", type: "uint256" },
    { name: "sqrtPriceLimitX96", type: "uint160" }] }], outputs: [{ type: "uint256" }] },
]
const quoterAbi = [{ type: "function", name: "quoteExactInputSingle", stateMutability: "nonpayable",
  inputs: [{ name: "params", type: "tuple", components: [
    { name: "tokenIn", type: "address" }, { name: "tokenOut", type: "address" }, { name: "amountIn", type: "uint256" },
    { name: "fee", type: "uint24" }, { name: "sqrtPriceLimitX96", type: "uint160" }] }],
  outputs: [{ name: "amountOut", type: "uint256" }, { type: "uint160" }, { type: "uint32" }, { type: "uint256" }] }]

// ---------------------------------------------------------------- salt miner (ported from lib/mine-salt.ts)
const SUFFIX = [0x87, 0x87]
function hexToBytes(hex, n) { const c = hex.slice(2); const o = new Uint8Array(n); for (let i = 0; i < n; i++) o[i] = parseInt(c.slice(i * 2, i * 2 + 2), 16); return o }
function bytesToHex(b) { let s = "0x"; for (const v of b) s += v.toString(16).padStart(2, "0"); return s }
function mineSalts(factory, deployer, initCodeHash, count = 12) {
  const f = hexToBytes(factory, 20), d = hexToBytes(deployer, 20), ich = hexToBytes(initCodeHash, 32)
  const saltInput = new Uint8Array(64); saltInput.set(d, 12)
  const salt = saltInput.subarray(32)
  const addrInput = new Uint8Array(85); addrInput[0] = 0xff; addrInput.set(f, 1); addrInput.set(ich, 53)
  const found = []
  while (found.length < count) {
    const prefix = new Uint8Array(28); for (let i = 0; i < 28; i++) prefix[i] = (Math.random() * 256) | 0
    salt.set(prefix, 0)
    let hit = false
    for (let i = 0; i < 2_000_000; i++) {
      salt[28] = (i >>> 24) & 0xff; salt[29] = (i >>> 16) & 0xff; salt[30] = (i >>> 8) & 0xff; salt[31] = i & 0xff
      addrInput.set(keccak_256(saltInput), 21)
      const h = keccak_256(addrInput)
      if (h[30] === SUFFIX[0] && h[31] === SUFFIX[1]) { found.push(bytesToHex(salt)); hit = true; break }
    }
    if (!hit) throw new Error("mining exhausted — initCodeHash/factory/deployer mismatch")
  }
  return found
}

// ---------------------------------------------------------------- run
const account = privateKeyToAccount(process.env.PRIVATE_KEY)
const pub = createPublicClient({ chain: CHAIN, transport: http(RPC) })
const wallet = createWalletClient({ account, chain: CHAIN, transport: http(RPC) })
const config = { name: NAME, symbol: SYMBOL, metadataURI: `ipfs://test-${SYMBOL}`, devBuyMinOut: 0n }

console.log(`account ${account.address}`)
console.log(`launching "${NAME}" ($${SYMBOL}) at TIER ${TIER} (0=1%,1=0.3%,2=0.05%)`)

const [initCodeHash, launchFee] = await Promise.all([
  pub.readContract({ address: FACTORY, abi: factoryAbi, functionName: "tokenInitCodeHash", args: [config] }),
  pub.readContract({ address: FACTORY, abi: factoryAbi, functionName: "launchFee" }),
])
console.log(`launchFee ${formatUnits(launchFee, 18)} USDC · mining salts…`)
const salts = mineSalts(FACTORY, account.address, initCodeHash, 12)
const [predicted, , poolFree] = await pub.readContract({
  address: FACTORY, abi: factoryAbi, functionName: "predictTokenAddress", args: [account.address, config, salts[0], TIER],
})
console.log(`predicted ${predicted}  (ends 8787: ${predicted.toLowerCase().endsWith("8787")}, poolFree: ${poolFree})`)

const value = launchFee + DEV_BUY_WEI
console.log(`deploy… value ${formatUnits(value, 18)} USDC`)
const dhash = await wallet.writeContract({ address: FACTORY, abi: factoryAbi, functionName: "deploy", args: [config, TIER, salts], value })
const drcpt = await pub.waitForTransactionReceipt({ hash: dhash })
console.log(`deploy tx ${dhash} — ${drcpt.status}`)
if (drcpt.status !== "success") process.exit(1)

let token
for (const log of drcpt.logs) {
  if (log.address.toLowerCase() !== FACTORY.toLowerCase()) continue
  try { const ev = decodeEventLog({ abi: factoryAbi, ...log }); if (ev.eventName === "TokenLaunched") { token = ev.args.token; console.log(`TokenLaunched: token=${ev.args.token} fee=${ev.args.fee} (${Number(ev.args.fee) / 10000}%) curveConfigId=${ev.args.curveConfigId}`) } } catch {}
}
const feeOnChain = await pub.readContract({ address: FACTORY, abi: factoryAbi, functionName: "feeTierOf", args: [token] })
const expectFee = TIER === 0n ? 10000 : TIER === 1n ? 3000 : 500
console.log(`feeTierOf(token) = ${feeOnChain} ${Number(feeOnChain) === expectFee ? "✓ matches expected tier" : "✗ MISMATCH expected " + expectFee}`)
console.log(`→ https://testnet.arcscan.app/tx/${dhash}`)

// ---------------------------------------------------------------- optional 1-tx permit buy
if (BUY_USDC > 0n) {
  console.log(`\npermit-buy ${formatUnits(BUY_USDC, 6)} USDC of $${SYMBOL} (permit + swap in ONE tx)…`)
  const [name, ver, nonce, before] = await Promise.all([
    pub.readContract({ address: USDC, abi: erc20, functionName: "name" }),
    pub.readContract({ address: USDC, abi: erc20, functionName: "version" }),
    pub.readContract({ address: USDC, abi: erc20, functionName: "nonces", args: [account.address] }),
    pub.readContract({ address: token, abi: erc20, functionName: "balanceOf", args: [account.address] }),
  ])
  const quote = await pub.simulateContract({ address: QUOTER, abi: quoterAbi, functionName: "quoteExactInputSingle",
    args: [{ tokenIn: USDC, tokenOut: token, amountIn: BUY_USDC, fee: Number(feeOnChain), sqrtPriceLimitX96: 0n }] })
  const minOut = (quote.result[0] * 9500n) / 10000n // 5% slippage, like the UI
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800)
  const signature = await wallet.signTypedData({
    domain: { name, version: ver, chainId: CHAIN.id, verifyingContract: USDC },
    types: { Permit: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] },
    primaryType: "Permit",
    message: { owner: account.address, spender: ROUTER, value: BUY_USDC, nonce, deadline },
  })
  const { r, s, v } = parseSignature(signature)
  const permitCall = encodeFunctionData({ abi: routerAbi, functionName: "selfPermit", args: [USDC, BUY_USDC, deadline, Number(v ?? 27n), r, s] })
  const swapCall = encodeFunctionData({ abi: routerAbi, functionName: "exactInputSingle", args: [{ tokenIn: USDC, tokenOut: token, fee: Number(feeOnChain), recipient: account.address, amountIn: BUY_USDC, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n }] })
  const bhash = await wallet.writeContract({ address: ROUTER, abi: routerAbi, functionName: "multicall", args: [[permitCall, swapCall]] })
  const brcpt = await pub.waitForTransactionReceipt({ hash: bhash })
  const after = await pub.readContract({ address: token, abi: erc20, functionName: "balanceOf", args: [account.address] })
  console.log(`buy tx ${bhash} — ${brcpt.status} (single tx, no approve)`)
  console.log(`$${SYMBOL} balance ${formatUnits(before, 18)} → ${formatUnits(after, 18)}  (+${formatUnits(after - before, 18)})`)
  console.log(`→ https://testnet.arcscan.app/tx/${bhash}`)
}
console.log("\ndone.")
