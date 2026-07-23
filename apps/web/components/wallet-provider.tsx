"use client"

import { usePrivy } from "@privy-io/react-auth"
import { useAccount, useBalance, useSwitchChain } from "wagmi"
import { formatEther } from "viem"

import { PRIVY_CONFIGURED } from "@/components/providers"
import { arc } from "@/lib/chain"

export type Wallet = {
  ready: boolean
  connected: boolean
  address?: `0x${string}`
  /** Short display form, e.g. 0x7aE3…9F2d */
  short?: string
  balance?: string
  /** Button label: "Connect wallet" or "0x7aE3…9F2d · 1.24 USDC" */
  label: string
  /** true when connected but on the wrong network (must be Arc, 5042002). */
  wrongNetwork: boolean
  switchToArc: () => void
  connect: () => void
  disconnect: () => void
  /**
   * Mints a short-lived Privy access token for authenticating server calls (the
   * image-pin route verifies it). undefined when Privy isn't configured — the
   * caller treats that as "uploads unavailable" and offers the degraded path.
   */
  getAccessToken?: () => Promise<string | null>
}

function short(addr?: string): string | undefined {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : undefined
}

/**
 * Single wallet entry point for the UI. PRIVY_CONFIGURED is a build-time
 * constant (NEXT_PUBLIC_ env), so the branch is fixed for the app's lifetime
 * and hook order never changes across renders.
 */
export function useWallet(): Wallet {
  if (!PRIVY_CONFIGURED) {
    const warn = () =>
      console.warn(
        "Set NEXT_PUBLIC_PRIVY_APP_ID in apps/web/.env.local to enable wallet connect."
      )
    return {
      ready: true,
      connected: false,
      label: "Connect wallet",
      wrongNetwork: false,
      switchToArc: warn,
      connect: warn,
      disconnect: () => {},
    }
  }

  /* eslint-disable react-hooks/rules-of-hooks */
  const { ready, authenticated, login, logout, getAccessToken } = usePrivy()
  const { address, chainId } = useAccount()
  const { switchChain } = useSwitchChain()
  const { data: bal } = useBalance({ address })
  /* eslint-enable react-hooks/rules-of-hooks */

  const connected = authenticated && !!address
  const wrongNetwork = connected && chainId !== arc.id
  const eth = bal ? Number(formatEther(bal.value)).toFixed(2) : undefined

  return {
    ready,
    connected,
    address,
    short: short(address),
    balance: eth,
    label: connected ? `${short(address)}${eth ? ` · ${eth} USDC` : ""}` : "Connect wallet",
    wrongNetwork,
    switchToArc: () => switchChain({ chainId: arc.id }),
    connect: () => (authenticated ? logout() : login()),
    disconnect: logout,
    getAccessToken,
  }
}
