import { WhitelistClaim } from "@/components/whitelist-claim"

export default function WhitelistPage() {
  return (
    <div className="mx-auto max-w-[620px] px-5 pb-20 pt-12 text-center">
      <div className="animate-bob text-6xl" aria-hidden>
        ⚓
      </div>
      <h1 className="font-display mt-4 text-[42px] leading-tight">Earn your berth.</h1>
      <p className="text-mist mx-auto mt-3 max-w-md text-[15px]">
        Deep water outside. Still water in here. Early captains sail with zero fees for season one, a
        founder pennant, and first look at every flagship launch.
      </p>
      <WhitelistClaim />
    </div>
  )
}
