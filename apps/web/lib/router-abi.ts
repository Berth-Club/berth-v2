/**
 * SwapRouter02 on Arc — minimal ABI.
 *
 * Split out of `lib/trade.ts` (which is "use client" and pulls in wagmi) so the
 * selectors can be pinned by a runnable self-check. See `router-abi.selfcheck.ts`.
 *
 * ⚠️ `ExactInputSingleParams` has SEVEN fields and NO `deadline` (selector
 * 0x04e45aaf). This is a genuine SwapRouter02, not v3-periphery's SwapRouter v1
 * (0x414bf389, eight fields). Adding a deadline silently changes the selector
 * and encodes a call to a function this router does not have.
 *
 * ⚠️ There is NO wrap, unwrap or refund leg here, and there must never be. On
 * Arc, USDC is both the native currency and an ERC20 over one balance, so a swap
 * is a plain `approve` + `exactInputSingle` in both directions -- never payable.
 * The periphery's WETH9 immutable points at a stub that reverts on every call,
 * so `unwrapWETH9`/`refundETH` would revert even though the selectors exist.
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
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
  // Batch calls in one tx. Used for the 1-transaction buy: [selfPermit, swap].
  // The results array is ignored — we only care that both legs ran atomically.
  {
    type: "function",
    name: "multicall",
    stateMutability: "payable",
    inputs: [{ name: "data", type: "bytes[]" }],
    outputs: [{ name: "results", type: "bytes[]" }],
  },
  // Consumes an EIP-2612 permit the CALLER signed (owner = msg.sender, spender =
  // this router). Lets a buy approve USDC and swap it in a single transaction:
  // the router calls IERC20Permit(token).permit(...) inside the multicall.
  {
    type: "function",
    name: "selfPermit",
    stateMutability: "payable",
    inputs: [
      { name: "token", type: "address" },
      { name: "value", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [],
  },
] as const

/** Read out of the deployed router's bytecode on Arc testnet. */
export const EXPECTED_SELECTORS: Record<string, `0x${string}`> = {
  exactInputSingle: "0x04e45aaf",
  multicall: "0xac9650d8", // multicall(bytes[])
  selfPermit: "0xf3995c67",
}
