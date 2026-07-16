"use client"

import { PrivyProvider, type PrivyClientConfig } from "@privy-io/react-auth"
import { WagmiProvider } from "@privy-io/wagmi"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { robinhood } from "@/lib/chain"
import { wagmiConfig } from "@/lib/wagmi"

const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? ""

// Privy hard-throws on an invalid app id, so only mount it once a real id is
// set. Until then the app still renders and the wallet button is a no-op
// (see lib/wallet.ts). Set NEXT_PUBLIC_PRIVY_APP_ID in apps/web/.env.local.
export const PRIVY_CONFIGURED = appId !== "" && appId !== "your-privy-app-id"

const queryClient = new QueryClient()

const privyConfig: PrivyClientConfig = {
  defaultChain: robinhood,
  supportedChains: [robinhood],
  embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
  loginMethods: ["wallet", "email"],
  appearance: {
    walletList: [
      "rainbow",
      "rabby_wallet",
      "metamask",
      "wallet_connect",
      "coinbase_wallet",
      "detected_wallets",
    ],
    // berth.club: abyss ground, lime signal
    theme: "#0C130E",
    accentColor: "#A3E635",
    logo: undefined,
  },
}

export function Providers({ children }: { children: React.ReactNode }) {
  if (!PRIVY_CONFIGURED) return <>{children}</>
  return (
    <PrivyProvider appId={appId} config={privyConfig}>
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig}>{children}</WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  )
}
