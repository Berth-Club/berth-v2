"use client"

/**
 * Shared editorial layout for the three static pages: Privacy, Terms, Docs
 * (v3 screens 6-8). One wide flat-glass card with a sticky "ON THIS PAGE"
 * sidebar and number-gutter content rows. Pages supply a `sections` array;
 * this renders both the sidebar TOC and the numbered rows from it so the two
 * can never drift.
 */

import Link from "next/link"
import type { ReactNode } from "react"

export type Section = {
  id: string
  label: string
  /** Sidebar group heading (Docs: PROTOCOL / REFERENCE). Omit for a flat TOC. */
  group?: string
  body: ReactNode
}

const HAIRLINE = "1px solid rgba(148,168,196,.12)"

/** Smooth-scroll to a section, clearing the floating header (−84px). */
function scrollToSection(id: string) {
  const el = document.getElementById(id)
  if (!el) return
  const y = el.getBoundingClientRect().top + window.scrollY - 84
  window.scrollTo({ top: y, behavior: "smooth" })
}

const pad = (i: number) => String(i + 1).padStart(2, "0")

export function LegalLayout({
  kicker,
  title,
  intro,
  effectiveDate,
  maxWidth,
  headerAside,
  numberedNav = true,
  sections,
}: {
  kicker: string
  title: string
  intro?: string
  effectiveDate?: string
  maxWidth: number
  headerAside?: ReactNode
  numberedNav?: boolean
  sections: Section[]
}) {
  // Group order preserved as first-seen. Flat TOC when nothing is grouped.
  const groups: string[] = []
  for (const s of sections) {
    const g = s.group ?? "ON THIS PAGE"
    if (!groups.includes(g)) groups.push(g)
  }

  return (
    <div className="mx-auto px-5 pb-16 pt-6" style={{ maxWidth }}>
      <Link
        href="/"
        className="btn-frost mb-4 inline-flex items-center gap-2 px-4 py-2.5 text-[13.5px] font-semibold"
      >
        ‹ Back
      </Link>

      <div className="glass px-[38px] py-9">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-faint text-[11px] font-semibold uppercase" style={{ letterSpacing: ".16em" }}>
              {kicker}
            </div>
            <h1 className="font-display mt-2.5 text-[30px]" style={{ letterSpacing: "-.02em" }}>
              {title}
            </h1>
            {intro && (
              <p className="text-mist mt-2 max-w-[60ch] text-[14px] leading-[1.6] text-pretty">{intro}</p>
            )}
            {effectiveDate && <div className="text-faint mt-2 text-[12.5px]">{effectiveDate}</div>}
          </div>
          {headerAside}
        </div>

        {/* Two columns */}
        <div className="mt-[30px] flex flex-wrap items-start gap-[44px]">
          {/* Sticky sidebar in its own inner card */}
          <nav
            className="sticky top-24"
            style={{
              flex: "1 0 215px",
              maxWidth: 255,
              background: "rgba(8,15,26,.72)",
              border: "1px solid rgba(148,168,196,.12)",
              borderRadius: 18,
              padding: "20px 22px",
            }}
          >
            {groups.map((g, gi) => (
              <div key={g} className={gi > 0 ? "mt-6" : ""}>
                <div
                  className="text-faint text-[11px] font-semibold uppercase"
                  style={{ letterSpacing: ".14em" }}
                >
                  {g}
                </div>
                <div className="mt-2.5 grid gap-0.5">
                  {sections.map((s, i) =>
                    (s.group ?? "ON THIS PAGE") === g ? (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => scrollToSection(s.id)}
                        className="text-mist flex items-baseline gap-2.5 py-1.5 text-left text-[13.5px] transition-colors hover:text-foam"
                      >
                        {numberedNav && (
                          <span className="tabular text-lime text-[10.5px]">{pad(i)}</span>
                        )}
                        <span>{s.label}</span>
                      </button>
                    ) : null,
                  )}
                </div>
              </div>
            ))}
          </nav>

          {/* Number-gutter content rows */}
          <div className="min-w-0" style={{ flex: "999 1 400px" }}>
            {sections.map((s, i) => (
              <section
                key={s.id}
                id={s.id}
                className="relative pb-[34px] pt-8 pl-[62px]"
                style={{ borderTop: HAIRLINE }}
              >
                <div
                  className="tabular text-faint absolute left-0 top-[34px] text-[12px]"
                  style={{ width: 34 }}
                >
                  {pad(i)}
                </div>
                <h2 className="font-display text-[21px]" style={{ letterSpacing: "-.015em" }}>
                  {s.label}
                </h2>
                {s.body}
              </section>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div
          className="mt-[38px] flex flex-wrap items-center justify-between gap-3 pt-5"
          style={{ borderTop: "1px solid rgba(148,168,196,.14)" }}
        >
          <div className="text-mist text-[13px]">
            Questions about this document? <span className="text-lime">legal@berth.club</span>
          </div>
          <Link href="/" className="btn-glossy px-4 py-2 text-[13px]">
            Return to Harbor
          </Link>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Small presentational helpers reused across the three pages.        */
/* ------------------------------------------------------------------ */

export function Para({ children }: { children: ReactNode }) {
  return <p className="text-mist mt-[9px] text-[13.5px] leading-[1.75] text-pretty">{children}</p>
}

export function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <div className="mt-[11px] grid gap-2">
      {items.map((it, i) => (
        <div key={i} className="text-mist flex gap-2.5 text-[13.5px] leading-[1.6]">
          <span className="text-lime shrink-0">—</span>
          <span>{it}</span>
        </div>
      ))}
    </div>
  )
}

/** Key-value table (Network facts, Fees & rewards). */
export function KV({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <div className="mt-1.5">
      {rows.map(([k, v], i) => (
        <div
          key={i}
          className="flex justify-between gap-3.5 py-[11px] text-[13.5px]"
          style={{ borderBottom: HAIRLINE }}
        >
          <span className="text-mist">{k}</span>
          <span className="tabular text-foam text-right">{v}</span>
        </div>
      ))}
    </div>
  )
}

/** Full-width address rows (Contracts). */
export function AddressRows({ rows }: { rows: { label: string; addr: string }[] }) {
  return (
    <div className="mt-1.5">
      {rows.map((r) => (
        <div key={r.addr + r.label} className="py-[11px]" style={{ borderBottom: HAIRLINE }}>
          <div className="text-mist text-[13px]">{r.label}</div>
          <div className="tabular text-foam mt-1 text-[12px]" style={{ wordBreak: "break-all" }}>
            {r.addr}
          </div>
        </div>
      ))}
    </div>
  )
}

/** 01-02-03 step cells (Docs: how launches work). */
export function StepCells({ steps }: { steps: { title: string; body: string }[] }) {
  return (
    <div
      className="mt-3.5 grid gap-3"
      style={{ gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}
    >
      {steps.map((s, i) => (
        <div
          key={s.title}
          style={{
            background: "rgba(8,15,26,.72)",
            border: "1px solid rgba(148,168,196,.12)",
            borderRadius: 16,
            padding: 18,
          }}
        >
          <div className="tabular text-lime text-[12px]">{pad(i)}</div>
          <div className="mt-2 text-[15px] font-semibold">{s.title}</div>
          <div className="text-mist mt-1.5 text-[13px] leading-[1.65]">{s.body}</div>
        </div>
      ))}
    </div>
  )
}

/** Definition-card grid (Price / Market cap / …). */
export function DefGrid({ items }: { items: { term: string; def: string }[] }) {
  return (
    <div
      className="mt-3.5 grid gap-2.5"
      style={{ gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}
    >
      {items.map((it) => (
        <div
          key={it.term}
          style={{
            background: "rgba(8,15,26,.72)",
            border: "1px solid rgba(148,168,196,.12)",
            borderRadius: 14,
            padding: "14px 16px",
          }}
        >
          <div className="text-[14px] font-semibold">{it.term}</div>
          <div className="text-mist mt-1 text-[12.5px] leading-[1.6]">{it.def}</div>
        </div>
      ))}
    </div>
  )
}

/** Short FAQ. */
export function FAQ({ items }: { items: { q: string; a: ReactNode }[] }) {
  return (
    <div className="mt-[11px] grid gap-4">
      {items.map((it) => (
        <div key={it.q}>
          <div className="text-foam text-[14px] font-semibold">{it.q}</div>
          <div className="text-mist mt-1 text-[13.5px] leading-[1.7] text-pretty">{it.a}</div>
        </div>
      ))}
    </div>
  )
}
