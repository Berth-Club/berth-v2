/**
 * UnitFlow's SwapRouter (v1) on Arc — minimal ABI.
 *
 * Split out of `lib/trade.ts` (which is "use client" and pulls in wagmi) so the
 * selectors can be pinned by a runnable self-check. See `router-abi.selfcheck.ts`.
 *
 * ⚠️ TRAP, and it is the INVERSE of the one we had on Robinhood. Arc's router is
 * v3-periphery's SwapRouter v1, whose `ExactInputSingleParams` has EIGHT fields
 * INCLUDING `deadline` (selector 0x414bf389). The SwapRouter02 seven-field
 * variant (0x04e45aaf) does NOT exist here — verified absent by bytecode scan.
 * Removing the deadline field silently changes the selector and encodes a call
 * to a function the router doesn't have.
 *
 * ⚠️ SECOND TRAP: UnitFlow renamed the native-token helpers, because on Arc the
 * native token is USDC, not ETH. Verified present/absent by bytecode scan
 * against the deployed router:
 *   unwrapWETH9 (0x49404b7c)  ABSENT  ->  unwrapWUSDC (0xb4c352a4)  present
 *   refundETH   (0x12210e8a)  ABSENT  ->  refundUSDC  (0x146591c4)  present
 * `multicall` and `sweepToken` kept their names. These renames fail at runtime
 * with an opaque revert rather than at compile time, which is why they are
 * pinned by selector in the self-check.
 */
export const swapRouterAbi = [
  {
    type: "function",
    name: "exactInputSingle",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "recipient", type: "address" },
          { name: "deadline", type: "uint256" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
  {
    type: "function",
    name: "multicall",
    stateMutability: "payable",
    inputs: [{ name: "data", type: "bytes[]" }],
    outputs: [{ name: "results", type: "bytes[]" }],
  },
  { type: "function", name: "refundUSDC", stateMutability: "payable", inputs: [], outputs: [] },
  {
    type: "function",
    name: "unwrapWUSDC",
    stateMutability: "payable",
    inputs: [
      { name: "amountMinimum", type: "uint256" },
      { name: "recipient", type: "address" },
    ],
    outputs: [],
  },
] as const

/**
 * Every selector above, as read out of the router's deployed bytecode on Arc
 * Testnet. The self-check derives the selectors from the ABI and compares.
 */
export const EXPECTED_SELECTORS: Record<string, `0x${string}`> = {
  exactInputSingle: "0x414bf389",
  multicall: "0xac9650d8",
  refundUSDC: "0x146591c4",
  unwrapWUSDC: "0xb4c352a4",
}
