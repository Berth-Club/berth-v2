import { http } from "wagmi"
// Import createConfig from @privy-io/wagmi, not wagmi.
import { createConfig } from "@privy-io/wagmi"

import { arc } from "@/lib/chain"

export const wagmiConfig = createConfig({
  chains: [arc],
  transports: {
    [arc.id]: http(),
  },
})
