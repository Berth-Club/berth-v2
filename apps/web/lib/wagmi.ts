import { http } from "wagmi"
// Import createConfig from @privy-io/wagmi, not wagmi.
import { createConfig } from "@privy-io/wagmi"

import { robinhood } from "@/lib/chain"

export const wagmiConfig = createConfig({
  chains: [robinhood],
  transports: {
    [robinhood.id]: http(),
  },
})
