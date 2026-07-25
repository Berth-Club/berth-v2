import type { Metadata } from "next"
import { Archivo_Black, Space_Grotesk, IBM_Plex_Mono } from "next/font/google"

import "@workspace/ui/globals.css"
import { cn } from "@workspace/ui/lib/utils"
import { ThemeProvider } from "@/components/theme-provider"
import { TopBar } from "@/components/top-bar"
import { AppFooter } from "@/components/app-footer"
import { MobileTabBar } from "@/components/mobile-tab-bar"
import { FxProvider } from "@/components/fx-provider"
import { Providers } from "@/components/providers"

const fontSans = Space_Grotesk({ subsets: ["latin"], variable: "--font-space-grotesk" })
const fontDisplay = Archivo_Black({ subsets: ["latin"], weight: "400", variable: "--font-archivo-black" })
const fontMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "700"], variable: "--font-ibm-plex-mono" })

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
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
      className={cn(
        "antialiased",
        fontSans.variable,
        fontDisplay.variable,
        fontMono.variable,
        "font-sans"
      )}
    >
      <body>
        {/* Atmosphere: fixed, behind all content (pointer-events:none). */}
        <div aria-hidden className="atmo">
          <div className="atmo-grid" />
          <div className="atmo-shaft atmo-shaft-1" />
          <div className="atmo-shaft atmo-shaft-2" />
          <div className="atmo-shaft atmo-shaft-3" />
          <div className="atmo-grain" />
        </div>
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
