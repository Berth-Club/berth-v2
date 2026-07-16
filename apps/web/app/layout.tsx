import type { Metadata } from "next"
import { Lilita_One, Space_Grotesk, Geist_Mono } from "next/font/google"

import "@workspace/ui/globals.css"
import { cn } from "@workspace/ui/lib/utils"
import { ThemeProvider } from "@/components/theme-provider"
import { TopBar } from "@/components/top-bar"
import { AppFooter } from "@/components/app-footer"
import { MobileTabBar } from "@/components/mobile-tab-bar"
import { FxProvider } from "@/components/fx-provider"
import { Providers } from "@/components/providers"

const fontSans = Space_Grotesk({ subsets: ["latin"], variable: "--font-space-grotesk" })
const fontDisplay = Lilita_One({ subsets: ["latin"], weight: "400", variable: "--font-lilita-one" })
const fontMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" })

export const metadata: Metadata = {
  title: "berth.club — Build something that floats",
  description:
    "Launch a coin on Robinhood Chain in one transaction: mint, pool, and lock the liquidity forever. Fixed 100B supply, no admin over your coin, 1% of every trade to the creator.",
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
        <ThemeProvider forcedTheme="dark">
          <FxProvider>
          <Providers>
          <div className="flex min-h-svh flex-col">
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
