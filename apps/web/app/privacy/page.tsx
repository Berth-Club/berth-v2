import type { Metadata } from "next"
import { Bullets, LegalLayout, Para, type Section } from "@/components/legal-layout"

export const metadata: Metadata = {
  title: "Privacy Policy · berth.club",
  description: "How Berth collects, uses, shares, and protects information across the berth.club interface.",
}

const sections: Section[] = [
  {
    id: "pv-about",
    label: "About this policy",
    body: (
      <>
        <Para>
          This policy explains what Berth Labs, LLC (&ldquo;Berth,&rdquo; &ldquo;we&rdquo;) collects when you use
          berth.club — browsing the app, connecting a wallet, launching or trading a ship, or posting in token
          chat — and what we do with it.
        </Para>
        <Para>
          The interface is non-custodial. Berth never controls your wallet, holds your keys or assets, or submits
          transactions for you.
        </Para>
      </>
    ),
  },
  {
    id: "pv-collect",
    label: "Information we collect",
    body: (
      <Bullets
        items={[
          "Wallet and onchain information — public addresses, signatures, transaction hashes, balances, and other data already public on Arc.",
          "Content you submit — token names, tickers, artwork, descriptions, links, and wallet-signed chat messages.",
          "Communications — your email address and message when you contact us.",
          "Device and network information — IP address, browser type, requested pages, and timing.",
          "Usage analytics — aggregate, anonymous counts of how the interface is used.",
          "Local preferences — slippage, drafts, and session state stored by your own browser.",
        ]}
      />
    ),
  },
  {
    id: "pv-use",
    label: "How we use information",
    body: (
      <Bullets
        items={[
          "Run and improve discovery, launching, trading, portfolio, and chat.",
          "Verify wallet signatures and prepare the transactions you request.",
          "Moderate artwork and messages for spam, fraud, and abuse.",
          "Answer support requests and keep the interface reliable and secure.",
          "Meet legal obligations and enforce the Terms of Use.",
        ]}
      />
    ),
  },
  {
    id: "pv-chain",
    label: "Blockchain information",
    body: (
      <>
        <Para>
          Public blockchains are transparent by design: launches, trades, and claims are permanent public records
          served by nodes, explorers, and indexers we do not operate.
        </Para>
        <Para>
          Berth cannot edit, hide, reverse, or delete onchain records. Disconnecting your wallet or making a privacy
          request does not remove past activity from the chain.
        </Para>
      </>
    ),
  },
  {
    id: "pv-disclose",
    label: "How we disclose information",
    body: (
      <Para>
        Berth does not sell personal information. We share it only with the vendors that keep the service running —
        hosting, RPC, indexing, IPFS gateways, market data — plus when the law requires it, during a business
        reorganization, or at your direction.
      </Para>
    ),
  },
  {
    id: "pv-third",
    label: "Third-party services",
    body: (
      <Para>
        Wallets, block explorers, Dexscreener, GeckoTerminal, and other linked services are independent from Berth.
        Once you leave berth.club, their terms and privacy policies govern.
      </Para>
    ),
  },
  {
    id: "pv-storage",
    label: "Browser storage",
    body: (
      <Para>
        Preferences and wallet session state live in your browser&rsquo;s local storage so the interface remembers
        you between visits. Clearing browser data resets them. Berth does not use storage for targeted advertising.
      </Para>
    ),
  },
  {
    id: "pv-retention",
    label: "Retention and security",
    body: (
      <>
        <Para>
          Offchain records are kept only as long as needed to run the interface, resolve disputes, and satisfy the
          law. We use reasonable safeguards, but no internet service is perfectly secure.
        </Para>
        <Para>Berth will never ask for your private key or recovery phrase. Never share them with anyone.</Para>
      </>
    ),
  },
  {
    id: "pv-rights",
    label: "Your rights and choices",
    body: (
      <Para>
        You can browse without connecting a wallet, disconnect at any time, clear local storage, and keep personal
        details out of token metadata and chat. Depending on where you live, you may also request access to,
        correction of, or deletion of offchain records at privacy@berth.club.
      </Para>
    ),
  },
  {
    id: "pv-changes",
    label: "Changes and contact",
    body: (
      <Para>
        We may update this policy as the interface or the law changes — the effective date above always marks the
        current version. Questions and requests: privacy@berth.club.
      </Para>
    ),
  },
]

export default function PrivacyPage() {
  return (
    <LegalLayout
      kicker="BERTH.CLUB LEGAL"
      title="Privacy Policy"
      intro="How Berth collects, uses, shares, and protects information across the berth.club interface."
      effectiveDate="Effective July 28, 2026"
      maxWidth={1020}
      sections={sections}
    />
  )
}
