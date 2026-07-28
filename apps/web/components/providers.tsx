"use client"

import { PrivyProvider, type PrivyClientConfig } from "@privy-io/react-auth"
import { WagmiProvider } from "@privy-io/wagmi"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { arc } from "@/lib/chain"
import { wagmiConfig } from "@/lib/wagmi"
import { env } from "@/lib/env"

const appId = env.privyAppId

// Privy hard-throws on an invalid app id, so only mount it once a real id is
// set. Until then the app still renders and the wallet button is a no-op
// (see lib/wallet.ts). Set NEXT_PUBLIC_PRIVY_APP_ID in apps/web/.env.local.
export const PRIVY_CONFIGURED = appId !== "" && appId !== "your-privy-app-id"

const queryClient = new QueryClient()

const privyConfig: PrivyClientConfig = {
  defaultChain: arc,
  supportedChains: [arc],
  embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
  // First screen: social + email (Google, X, email) — a memecoin launchpad wants
  // a wallet-less onboarding, not a wall of external-wallet connectors. External
  // wallets stay available under "More options" for people who prefer them.
  // NOTE: Google and Twitter/X must also be enabled in the Privy dashboard
  // (Login methods) for this app id, or these rows won't authenticate.
  loginMethodsAndOrder: {
    primary: ["google", "twitter", "email"],
    overflow: ["detected_ethereum_wallets", "wallet_connect", "coinbase_wallet"],
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
