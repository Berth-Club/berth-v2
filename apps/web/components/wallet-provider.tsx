"use client"

import { usePrivy } from "@privy-io/react-auth"
import { useAccount, useBalance, useSwitchChain } from "wagmi"
import { formatEther } from "viem"

import { PRIVY_CONFIGURED } from "@/components/providers"
import { robinhood } from "@/lib/chain"

export type Wallet = {
  ready: boolean
  connected: boolean
  address?: `0x${string}`
  /** Short display form, e.g. 0x7aE3…9F2d */
  short?: string
  balance?: string
  /** Button label: "Connect wallet" or "0x7aE3…9F2d · 1.24 Ξ" */
  label: string
  /** true when connected but on the wrong network (must be 4663). */
  wrongNetwork: boolean
  switchToRobinhood: () => void
  connect: () => void
  disconnect: () => void
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
      switchToRobinhood: warn,
      connect: warn,
      disconnect: () => {},
    }
  }

  /* eslint-disable react-hooks/rules-of-hooks */
  const { ready, authenticated, login, logout } = usePrivy()
  const { address, chainId } = useAccount()
  const { switchChain } = useSwitchChain()
  const { data: bal } = useBalance({ address })
  /* eslint-enable react-hooks/rules-of-hooks */

  const connected = authenticated && !!address
  const wrongNetwork = connected && chainId !== robinhood.id
  const eth = bal ? Number(formatEther(bal.value)).toFixed(2) : undefined

  return {
    ready,
    connected,
    address,
    short: short(address),
    balance: eth,
    label: connected ? `${short(address)}${eth ? ` · ${eth} Ξ` : ""}` : "Connect wallet",
    wrongNetwork,
    switchToRobinhood: () => switchChain({ chainId: robinhood.id }),
    connect: () => (authenticated ? logout() : login()),
    disconnect: logout,
  }
}
