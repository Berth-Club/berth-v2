import { LaunchWizard } from "@/components/launch-wizard"

export default function LaunchPage() {
  return (
    // v3: the launch screen is the form and its preview, nothing above them —
    // the page title lives inside the form card.
    <div className="mx-auto max-w-[1080px] px-5 pb-16 pt-6">
      <LaunchWizard />
    </div>
  )
}
