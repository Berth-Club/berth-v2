import type { Metadata } from "next"
import { Bullets, LegalLayout, Para, type Section } from "@/components/legal-layout"

export const metadata: Metadata = {
  title: "Terms of Use · berth.club",
  description: "The conditions, responsibilities, and risks that apply when you access or use the berth.club interface.",
}

const sections: Section[] = [
  {
    id: "tm-agreement",
    label: "Agreement",
    body: (
      <Para>
        These Terms are an agreement between you and Berth Labs, LLC (&ldquo;Berth&rdquo;). By using berth.club,
        connecting a wallet, or submitting a transaction through the interface, you accept these Terms and the Privacy
        Policy. If you do not agree, do not use the interface.
      </Para>
    ),
  },
  {
    id: "tm-about",
    label: "About berth.club",
    body: (
      <Para>
        Berth operates a software interface for discovering tokens and interacting with public smart contracts,
        wallets, and liquidity pools on Arc (chain 5042002). Questions: legal@berth.club.
      </Para>
    ),
  },
  {
    id: "tm-eligibility",
    label: "Eligibility",
    body: (
      <Para>
        You must be of legal age, have the capacity to enter this agreement, and be located where using the protocol
        is lawful. You are responsible for complying with the laws that apply to you, including sanctions rules. Berth
        may restrict access where legal, security, or operational risk requires it.
      </Para>
    ),
  },
  {
    id: "tm-noncustodial",
    label: "Non-custodial interface",
    body: (
      <Para>
        Berth never holds your assets or keys, cannot execute or reverse transactions, and is not a bank, broker,
        exchange, custodian, or adviser. Every transaction is initiated and signed by your own wallet; the smart
        contracts — not Berth — determine whether and how it executes.
      </Para>
    ),
  },
  {
    id: "tm-wallets",
    label: "Wallets and security",
    body: (
      <Para>
        Berth will never ask for your private key or recovery phrase, and cannot recover a compromised wallet. You are
        responsible for everything signed by your wallet — review addresses, amounts, slippage, and fees before you
        sign.
      </Para>
    ),
  },
  {
    id: "tm-transactions",
    label: "Transactions",
    body: (
      <Para>
        Quotes, prices, market caps, and receive estimates are informational and may differ from final execution.
        Blockchain transactions can fail, execute at unexpected prices, or be irreversible once confirmed. Inclusion in
        a block is never guaranteed.
      </Para>
    ),
  },
  {
    id: "tm-launches",
    label: "Launches and content",
    body: (
      <>
        <Para>
          You are solely responsible for the tokens you launch and the names, tickers, artwork, links, and messages you
          submit — and you must hold the rights to them. Artwork is moderated before it reaches public IPFS. Berth may
          hide offchain content that creates legal or security risk, but cannot remove anything recorded onchain.
        </Para>
        <Para>
          Ranking and surfacing — Trending, Newest, Market cap — use neutral, activity-based criteria and are never an
          endorsement of a token or its creator.
        </Para>
      </>
    ),
  },
  {
    id: "tm-trading",
    label: "Trading and liquidity",
    body: (
      <Para>
        Tokens launched here can be volatile, illiquid, or worthless, and anyone can copy a name or image — always
        verify the contract address. Graduation only records that 8,787 USDC was bought through the range; it says
        nothing about quality, safety, or future liquidity.
      </Para>
    ),
  },
  {
    id: "tm-fees",
    label: "Fees and taxes",
    body: (
      <Para>
        Launching costs 1 USDC. Every trade pays a 1% pool fee, split with the token&rsquo;s creator. Network gas is set
        by Arc, not Berth. All taxes arising from your activity are your responsibility.
      </Para>
    ),
  },
  {
    id: "tm-acceptable",
    label: "Acceptable use",
    body: (
      <Bullets
        items={[
          "No violating laws, sanctions, or the rights of others.",
          "No fraudulent, deceptive, or malicious tokens, artwork, links, or messages.",
          "No market manipulation, wash trading, or coordinated deception.",
          "No interfering with the interface, bypassing controls, or overloading infrastructure.",
          "No exploiting bugs — report them to security@berth.club instead.",
          "No using the platform to launder funds or finance unlawful activity.",
        ]}
      />
    ),
  },
  {
    id: "tm-liability",
    label: "Warranties and liability",
    body: (
      <Para>
        The interface is provided as-is, without warranties of any kind — including accuracy, availability, or fitness
        for a purpose. To the fullest extent the law allows, Berth&rsquo;s total liability for claims relating to the
        interface is capped at the greater of the fees you paid Berth in the twelve months before the claim or one
        hundred US dollars.
      </Para>
    ),
  },
  {
    id: "tm-disputes",
    label: "Disputes, changes, contact",
    body: (
      <Para>
        Contact legal@berth.club before starting a formal claim — most issues resolve informally. These Terms are
        governed by Delaware law. We may update them as the interface or the law changes; the effective date marks the
        current version, and continued use is acceptance.
      </Para>
    ),
  },
]

export default function TermsPage() {
  return (
    <LegalLayout
      kicker="BERTH.CLUB LEGAL"
      title="Terms of Use"
      intro="The conditions, responsibilities, and risks that apply when you access or use the berth.club interface."
      effectiveDate="Effective July 28, 2026"
      maxWidth={1020}
      sections={sections}
    />
  )
}
