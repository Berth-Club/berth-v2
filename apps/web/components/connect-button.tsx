"use client"

import { Wallet } from "lucide-react"

import { Button } from "@workspace/ui/components/button"

/**
 * Placeholder Connect button. Reserves the header slot and defines the visual
 * treatment; real wallet connection (wagmi/Privy on Arc, chain 5042002) lands in
 * plan Unit 3, which will swap this for the live connect flow + address menu.
 */
export function ConnectButton() {
  return (
    <Button
      size="lg"
      className="bg-primary text-primary-foreground hover:bg-primary/85 rounded-xl font-semibold"
    >
      <Wallet className="size-4" />
      Connect
    </Button>
  )
}
