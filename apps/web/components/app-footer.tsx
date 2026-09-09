import Link from "next/link"

import { Wordmark } from "@/components/wordmark"
import { HARBORMASTER_ITEM, LAUNCH_HREF, PORTFOLIO_ITEM } from "@/lib/nav"

function Col({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex-[0_1_auto]">
      <div className="text-faint mb-3.5 text-[12.5px]">{title}</div>
      <div className="grid gap-[11px]">{children}</div>
    </div>
  )
}

function FLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-mist hover:text-foam text-[14px] transition-colors">
      {children}
    </Link>
  )
}

/** v4 footer: a full-bleed band across the viewport, not a floating card. */
export function AppFooter() {
  return (
    <footer
      className="relative z-[1] mt-11"
      style={{
        background: "rgba(9,17,30,.86)",
        borderTop: "1px solid rgba(148,168,196,.16)",
        backdropFilter: "blur(8px)",
      }}
    >
      <div className="mx-auto max-w-[1180px] px-5 pb-[26px] pt-10">
        <div className="flex flex-wrap gap-12">
          <div className="min-w-[230px] flex-[1.5_1_260px]">
            <Wordmark />
            <p className="text-mist mt-3 max-w-[42ch] text-[13.5px] leading-[1.7]">
              Launch and trade fixed-supply tokens on Arc. Your wallet submits every transaction.
              berth.club never custodies assets.
            </p>
          </div>

          <Col title="Product">
            <FLink href="/">Harbor</FLink>
            <FLink href="/stats">Analytics</FLink>
            <FLink href={LAUNCH_HREF}>Launch a coin</FLink>
            <FLink href={HARBORMASTER_ITEM.href}>Harbormaster</FLink>
            <FLink href={PORTFOLIO_ITEM.href}>Portfolio</FLink>
          </Col>

          <Col title="Legal">
            <FLink href="/privacy">Privacy Policy</FLink>
            <FLink href="/terms">Terms of Use</FLink>
            <FLink href="/docs">Docs</FLink>
          </Col>

          <div className="min-w-[230px] flex-[1.4_1_260px]">
            <div className="text-faint mb-3.5 text-[12.5px]">Risk notice</div>
            <p className="text-mist text-[13.5px] leading-[1.7]">
              Transactions are submitted through your wallet and may be irreversible. Tokens can be
              volatile or lose all value. berth.club provides no custody, warranties, or financial
              advice.
            </p>
          </div>
        </div>

        <div
          className="mt-7 flex flex-wrap items-center justify-between gap-3 pt-[18px]"
          style={{ borderTop: "1px solid rgba(148,168,196,.14)" }}
        >
          <span className="text-faint text-[12.5px]">© 2026 Berth Labs, LLC.</span>
          <a
            href="https://x.com/Berth_Club"
            target="_blank"
            rel="noreferrer noopener"
            className="btn-frost text-body2 hover:text-foam inline-flex items-center gap-2 px-3.5 py-[7px] text-[12.5px] font-semibold"
          >
            @Berth_Club <span className="text-[13px]">𝕏</span>
          </a>
        </div>
      </div>
    </footer>
  )
}
