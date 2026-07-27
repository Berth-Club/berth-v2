"use client"

import { useFx } from "@/components/fx-provider"

/** The contract address as a click-to-copy well pill. */
export function CopyPill({ address }: { address: string }) {
  const { toast } = useFx()
  return (
    <button
      type="button"
      title="Copy contract"
      onClick={() => {
        void navigator.clipboard?.writeText(address)
        toast("Contract copied 📋")
      }}
      className="well text-body2 hover:border-lime hover:text-lime tabular flex items-center gap-2 rounded-full px-3.5 py-2 text-[12.5px] transition-colors"
    >
      {`${address.slice(0, 6)}…${address.slice(-4)}`} 📋
    </button>
  )
}
