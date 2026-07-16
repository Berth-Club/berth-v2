import { LaunchWizard } from "@/components/launch-wizard"

export default function LaunchPage() {
  return (
    <div className="mx-auto max-w-[660px] px-5 pb-20 pt-7">
      <h1 className="font-display text-center text-[36px]">Launch a coin</h1>
      <p className="text-muted-foreground mx-auto mb-6 mt-2 max-w-lg text-center text-sm">
        One transaction: mint + pool + lock. You bring the papers and the flag — the chain fixes
        everything else.
      </p>
      <LaunchWizard />
    </div>
  )
}
