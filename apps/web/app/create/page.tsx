import { LaunchWizard } from "@/components/launch-wizard"

export default function LaunchPage() {
  return (
    // v4: page header, four numbered cards, and a rail that sticks alongside
    // them. Wider than v3 because the rail is a real column now, not an aside.
    <div className="mx-auto max-w-[1180px] px-5 pb-16 pt-6">
      <LaunchWizard />
    </div>
  )
}
