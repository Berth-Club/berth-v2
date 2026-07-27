"use client"

import { PrivyProvider, type PrivyClientConfig } from "@privy-io/react-auth"
import { WagmiProvider } from "@privy-io/wagmi"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { arc } from "@/lib/chain"
import { wagmiConfig } from "@/lib/wagmi"

const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? ""

// Privy hard-throws on an invalid app id, so only mount it once a real id is
// set. Until then the app still renders and the wallet button is a no-op
// (see lib/wallet.ts). Set NEXT_PUBLIC_PRIVY_APP_ID in apps/web/.env.local.
export const PRIVY_CONFIGURED = appId !== "" && appId !== "your-privy-app-id"

const queryClient = new QueryClient()

const privyConfig: PrivyClientConfig = {
  defaultChain: arc,
  supportedChains: [arc],
  embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
  // Put detected extensions on the FIRST screen. With only `loginMethods`, Privy
  // collapses every wallet behind a generic "Continue with a wallet" row, so an
  // installed Rabby or MetaMask is two clicks deep and invisible until then.
  // `primary` takes up to four entries and renders them in this order.
  loginMethodsAndOrder: {
    primary: ["detected_ethereum_wallets", "wallet_connect", "email"],
  },
  appearance: {
    // Detection is the only supported way to surface browser extensions now:
    // in @privy-io/react-auth 3.35 both `rabby_wallet` ("no longer supported")
    // and the older `detected_wallets` catch-all are @deprecated, in favour of
    // `detected_ethereum_wallets`. Rabby, MetaMask and the rest appear here by
    // name when installed.
    //
    // Nothing injected is listed explicitly alongside it: doing so double-lists
    // whatever the visitor has installed, which is what produced React's
    // "unique key prop" warning from inside Privy's own list renderer.
    walletList: ["detected_ethereum_wallets", "wallet_connect", "coinbase_wallet"],
    // berth.club: abyss ground, lime signal
    theme: "#0d1a2b",
    accentColor: "#8fb0e8",
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
