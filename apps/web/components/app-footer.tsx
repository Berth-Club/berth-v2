import Link from "next/link"

import { Wordmark } from "@/components/wordmark"
import { LAUNCH_HREF, PORTFOLIO_ITEM } from "@/lib/nav"

function Col({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="text-faint font-mono text-[10.5px] uppercase" style={{ letterSpacing: ".12em" }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function FLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-body2 hover:text-foam text-[13.5px] transition-colors">
      {children}
    </Link>
  )
}

/** v3 FINAL footer: one flat card. Brand + non-custody note, Product / Legal /
 *  Risk columns, and a divider row with the copyright + an 𝕏 pill. */
export function AppFooter() {
  return (
    <footer className="mx-auto w-full max-w-[1180px] px-5 pb-12 pt-8">
      <div className="glass p-7 md:p-9">
        <div className="flex flex-wrap gap-x-10 gap-y-8">
          {/* brand */}
          <div className="max-w-[300px] flex-1">
            <Wordmark />
            <p className="text-mist mt-3.5 text-[13px] leading-relaxed">
              A non-custodial launchpad on Arc. Your keys, your coins. berth.club never holds funds
              and never has admin over a launched token.
            </p>
          </div>

          <Col title="Product">
            <FLink href="/">Harbor</FLink>
            <FLink href="/stats">Analytics</FLink>
            <FLink href={LAUNCH_HREF}>Launch a coin</FLink>
            <FLink href={PORTFOLIO_ITEM.href}>Portfolio</FLink>
          </Col>

          <Col title="Legal">
            <FLink href="/privacy">Privacy Policy</FLink>
            <FLink href="/terms">Terms of Use</FLink>
            <FLink href="/docs">Docs</FLink>
          </Col>

          <Col title="Risk notice">
            <p className="text-mist max-w-[220px] text-[12.5px] leading-relaxed">
              Memecoins are volatile and can go to zero. Nothing here is financial advice. Only risk
              what you can afford to lose.
            </p>
          </Col>
        </div>

        <div
          className="mt-8 flex flex-wrap items-center justify-between gap-3 pt-5"
          style={{ borderTop: "1px solid rgba(148,168,196,.12)" }}
        >
          <span className="text-faint font-mono text-[11.5px]">© 2026 Berth Labs, LLC.</span>
          <a
            href="https://x.com/berthdotclub"
            target="_blank"
            rel="noreferrer noopener"
            className="btn-frost text-body2 hover:text-foam inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[12.5px]"
          >
            𝕏 @berthdotclub
          </a>
        </div>
      </div>
    </footer>
  )
}
