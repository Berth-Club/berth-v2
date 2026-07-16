import { PortfolioTabs } from "@/components/portfolio-tabs"

export default function PortfolioPage() {
  return (
    <div className="mx-auto max-w-[900px] px-5 pb-20 pt-8">
      <h1 className="font-display text-[34px]">Your hold</h1>
      <p className="text-mist mb-6 mt-1 text-sm">
        What you&apos;re carrying, and what the harbor owes you.
      </p>
      <PortfolioTabs />
    </div>
  )
}
