import type { Metadata } from "next"
import { Inter, IBM_Plex_Mono } from "next/font/google"

import "@workspace/ui/globals.css"
import { cn } from "@workspace/ui/lib/utils"
import { ThemeProvider } from "@/components/theme-provider"
import { TopBar } from "@/components/top-bar"
import { AppFooter } from "@/components/app-footer"
import { MobileTabBar } from "@/components/mobile-tab-bar"
import { FxProvider } from "@/components/fx-provider"
import { Providers } from "@/components/providers"
import { Sea } from "@/components/sea"

// v3: Inter everywhere (600 headings/buttons, 400/500 body), IBM Plex Mono for data.
const fontSans = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-inter" })
const fontMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-ibm-plex-mono" })

export const metadata: Metadata = {
  // `||` not `??`: an empty NEXT_PUBLIC_SITE_URL (e.g. an unset Docker build
  // arg) is a defined "", which `??` would pass straight into new URL() → throw.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  title: "berth.club — Build something that floats",
  description:
    "Launch a coin on Arc in one transaction: mint, pool, and lock the liquidity forever. Fixed 100B supply, no admin over your coin, 1% of every trade to the creator.",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("antialiased", fontSans.variable, fontMono.variable, "font-sans")}
    >
      <body>
        {/* v3 background engine: canvas night-sea + CSS glow layers + floating
            sail, all fixed behind content (pointer-events:none, z-0). */}
        <div aria-hidden className="scene">
          <Sea />
          <div className="scene-neb scene-neb-1" />
          <div className="scene-neb scene-neb-2" />
          <div className="scene-aurora" />
          <div className="scene-arc scene-arc-1" />
          <div className="scene-arc scene-arc-2" />
          <div className="scene-sphere" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/berth-sail.png" alt="" className="scene-sail" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/berth-sail.png" alt="" className="scene-sail-reflection" />
        </div>
        {/* grain sits above everything, per spec */}
        <div aria-hidden className="scene-grain" />
        <ThemeProvider forcedTheme="dark">
          <FxProvider>
          <Providers>
          <div className="relative z-10 flex min-h-svh flex-col">
            <TopBar />
            {/* pb-20 leaves room for the mobile bottom tab bar */}
            <main className="flex-1 pb-20 md:pb-0">{children}</main>
            <AppFooter />
          </div>
          <MobileTabBar />
          </Providers>
          </FxProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
