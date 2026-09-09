import type { Metadata } from "next"
import Link from "next/link"
import { CHAIN, CONTRACTS, SYSTEM } from "@workspace/contracts"
import {
  AddressRows,
  Bullets,
  DefGrid,
  FAQ,
  KV,
  LegalLayout,
  Para,
  StepCells,
  type Section,
} from "@/components/legal-layout"

export const metadata: Metadata = {
  title: "Docs · berth.club",
  description: "Everything about berth.club — launches, trading, fees, network facts, and contracts.",
}

const sections: Section[] = [
  {
    id: "dx-overview",
    group: "PROTOCOL",
    label: "Overview",
    body: (
      <>
        <Para>
          berth.club is a place to launch and trade fixed-supply tokens on Arc. Browse the market, open any token for its
          chart, trades, holders, and chat, and trade straight from your wallet. Berth never holds your funds — every
          action is a transaction your wallet approves.
        </Para>
        <Bullets
          items={[
            "Names and tickers can be copied. Always check the contract address.",
            "Prices come from each token’s live USDC pool.",
            "Launches can be volatile, illiquid, or lose all value.",
          ]}
        />
      </>
    ),
  },
  {
    id: "dx-launches",
    group: "PROTOCOL",
    label: "How launches work",
    body: (
      <>
        <Para>
          Creating a token deploys it with its trading pool in one transaction: the full 100B supply is minted, a
          token/USDC pool opens, and the LP is locked forever. No team allocation; keys are burned at launch.
        </Para>
        <StepCells
          steps={[
            {
              title: "Create",
              body: "One transaction mints the fixed supply and opens the locked USDC pool. 1 USDC flat.",
            },
            {
              title: "Trade",
              body: "Buys and sells run against the pool from the first block and move the price.",
            },
            {
              title: "Graduate",
              body: "At 8,787 USDC bought through the range, the token graduates and keeps trading in the same pool.",
            },
          ]}
        />
        <Para>
          Launch protection: an optional developer buy — capped at about 100 USDC, roughly 2% of supply — executes as
          the first fill in the launch block, so creators cannot front-load more than that.
        </Para>
      </>
    ),
  },
  {
    id: "dx-trading",
    group: "PROTOCOL",
    label: "Trading and pricing",
    body: (
      <>
        <Para>
          The price you see is the live pool price; it moves with every fill. What you receive can differ slightly from
          the quote — slippage sets how much movement you accept.
        </Para>
        <DefGrid
          items={[
            { term: "Price", def: "The current pool price for one token." },
            { term: "Market cap", def: "Price multiplied by the 100B fixed supply." },
            { term: "Price impact", def: "The pool movement caused by your trade’s size." },
            { term: "Slippage", def: "The maximum execution movement your transaction accepts." },
            { term: "Liquidity", def: "Assets available in the pool around the current price." },
            { term: "Fee", def: "1% of every fill, split with the token’s creator." },
          ]}
        />
      </>
    ),
  },
  {
    id: "dx-graduation",
    group: "PROTOCOL",
    label: "Graduation",
    body: (
      <Para>
        A token graduates when 8,787 USDC has been bought through its range. The progress bar tracks how
        close it is. Graduation only confirms the threshold was reached — it is not a quality signal and guarantees
        nothing about future liquidity or price. Trading continues in the same pool; nothing migrates.
      </Para>
    ),
  },
  {
    id: "dx-fees",
    group: "PROTOCOL",
    label: "Fees and rewards",
    body: (
      <>
        <Para>Fees are snapshotted at launch and never change afterward.</Para>
        <KV
          rows={[
            ["Launch fee", "1 USDC"],
            ["Pool fee", "1% per trade"],
            ["Creator share", "split of every fee"],
            ["Claiming", "Portfolio → Creator rewards, anytime"],
          ]}
        />
      </>
    ),
  },
  {
    id: "dx-risk",
    group: "PROTOCOL",
    label: "Risk disclosures",
    body: (
      <>
        <Bullets
          items={[
            "Prices can move quickly and liquidity can be thin.",
            "Similar names and images can represent unrelated tokens.",
            "Smart contracts, wallets, RPCs, and indexers can fail.",
            "Displayed values are estimates, not execution guarantees.",
          ]}
        />
        <Para>berth.club is an interface, not investment advice or a statement of token quality.</Para>
      </>
    ),
  },
  {
    id: "dx-network",
    group: "REFERENCE",
    label: "Network",
    body: (
      <KV
        rows={[
          ["Network", CHAIN.name],
          ["Chain ID", String(CHAIN.id)],
          ["Quote asset", "USDC"],
          ["Explorer", CHAIN.explorerUrl.replace(/^https?:\/\//, "")],
          ["Pool fee", "1% base, plus any creator tax"],
          ["Launch fee", "1 USDC"],
          ["Supply", "100,000,000,000 (1e11)"],
        ]}
      />
    ),
  },
  {
    id: "dx-contracts",
    group: "REFERENCE",
    label: "Contracts",
    body: (
      <>
        <Para>Deployed addresses on Arc. Contracts are immutable — new versions ship as new addresses.</Para>
        <AddressRows
          rows={[
            { label: "Launch factory", addr: CONTRACTS.launchFactory },
            { label: "Launch locker", addr: CONTRACTS.launchLocker },
            { label: "Fee escrow", addr: CONTRACTS.feeEscrow },
            { label: "Router", addr: CONTRACTS.router },
            { label: "Holder vault", addr: CONTRACTS.holderVault },
            { label: "Burn vault", addr: CONTRACTS.burnVault },
            { label: "Uniswap V4 PoolManager", addr: SYSTEM.uniswapV4.poolManager },
          ]}
        />
      </>
    ),
  },
  {
    id: "dx-faq",
    group: "REFERENCE",
    label: "FAQ",
    body: (
      <FAQ
        items={[
          {
            q: "Does Berth take custody of my tokens?",
            a: "No. Every trade and launch is signed by your own wallet. Berth cannot move, freeze, or recover your assets.",
          },
          {
            q: "Can a creator rug the liquidity?",
            a: "No. The LP is locked at launch and the deployer keys are burned, so no one can pull the pool or mint more supply.",
          },
          {
            q: "What happens after a token graduates?",
            a: "Nothing migrates. Trading continues in the same USDC pool — graduation just records that 8,787 USDC was bought through the range.",
          },
          {
            q: "How do creator rewards work?",
            a: "The 1% pool fee is split with the creator and accrues in the fee locker. Claim it anytime from Portfolio → Creator rewards.",
          },
        ]}
      />
    ),
  },
  {
    id: "dx-support",
    group: "REFERENCE",
    label: "Support",
    body: (
      <Para>
        Hands-on help for teams indexing launches, deriving prices, or wiring trades: contact@berth.club. Onchain data
        is public and free to read — index the factory and pool events for a trust-minimized source of truth.
      </Para>
    ),
  },
  {
    // Rendered last but listed under PROTOCOL, matching the v4 mock's TOC.
    id: "dx-harbormaster",
    group: "PROTOCOL",
    label: "The Harbormaster (coming soon)",
    body: (
      <>
        <Para>
          An AI agent that turns holding into working. Every ship launched with the Harbormaster
          enabled escrows half its supply with the agent, which pays it out weekly to the people
          doing real work for the token: merged code, posts, timestamped callouts. The other half
          locks in the pool as usual. No team wallet, no admin key.
        </Para>
        <DefGrid
          items={[
            {
              term: "Work lanes",
              def: "GitHub, X, pump.fun and FOMO. Tag the agent where the work happened. The connector spec is open, any platform can plug in.",
            },
            {
              term: "Public scoring",
              def: "Every claim is scored against a published rubric and answered in public with a written reason, for every yes and every no.",
            },
            {
              term: "The Sybil court",
              def: "The full payout list posts 48 hours before it settles. Anyone can challenge a score in that window.",
            },
            {
              term: "Weekly epochs",
              def: "The vault pays a fixed slice each week, in the token and in USDC. Quiet weeks shrink the payout, they never stop it.",
            },
            {
              term: "The vault",
              def: "Capped at 1% per epoch, merkle claims with expiry, no admin key. It converges near fifty weeks of buyback depth.",
            },
            {
              term: "Open to apps",
              def: "Anything built on berth can airdrop its own token through the same agent and rubric, paying a small protocol fee.",
            },
          ]}
        />
        <Para>
          Shipping soon. Read the{" "}
          <Link href="/harbormaster" className="text-lime">
            full walkthrough
          </Link>
          , or contribute on{" "}
          <a
            href="https://github.com/Berth-Club"
            target="_blank"
            rel="noreferrer noopener"
            className="text-lime"
          >
            GitHub
          </a>{" "}
          before mainnet and the first epoch scores your work retroactively.
        </Para>
      </>
    ),
  },
]

export default function DocsPage() {
  return (
    <LegalLayout
      kicker="BERTH.CLUB DOCS"
      title="Everything about berth.club, in one place."
      maxWidth={1120}
      numberedNav={false}
      headerAside={
        <div
          className="tabular text-body2 inline-flex shrink-0 items-center gap-2 text-[12px]"
          style={{
            background: "rgba(8,15,26,.72)",
            border: "1px solid rgba(148,168,196,.14)",
            borderRadius: 999,
            padding: "7px 14px",
          }}
        >
          Arc · Chain ID {CHAIN.id}
        </div>
      }
      sections={sections}
    />
  )
}
