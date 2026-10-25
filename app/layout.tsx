import { Geist, Geist_Mono, Instrument_Sans, Manrope } from "next/font/google"

import "./globals.css"
import { ThemeProvider } from "next-themes"
import { cn } from "../lib/utils"
import { ActiveSectionProvider } from "@/components/sections/active-section-context"
import { ToolbarIndicatorProvider } from "@/components/window-toolbar-context"
import { CommandPaletteProvider } from "@/components/command-palette/command-palette-context"
import { VolconProvider } from "@/context/volcon-context"
import { WINDOW_TOOLBAR_HEIGHT } from "@/lib/window-chrome"

const manropeHeading = Manrope({ subsets: ["latin"], variable: "--font-heading" })

const instrumentSans = Instrument_Sans({ subsets: ["latin"], variable: "--font-sans" })

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

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
        fontMono.variable,
        "font-sans",
        instrumentSans.variable,
        manropeHeading.variable,
      )}
    >
      <body
        className="h-full overflow-hidden bg-transparent text-foreground"
        // The title bar's height, for everything laid out around it. Set on the
        // body so portalled dialogs and drawers inherit it too, and from the
        // same constant the menus' collision padding uses, so the two agree.
        style={{ ["--window-toolbar-height" as string]: `${WINDOW_TOOLBAR_HEIGHT}px` }}
      >
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <VolconProvider>
            <ActiveSectionProvider>
              <ToolbarIndicatorProvider>
                <CommandPaletteProvider>
                  <main className="h-full overflow-hidden">{children}</main>
                </CommandPaletteProvider>
              </ToolbarIndicatorProvider>
            </ActiveSectionProvider>
          </VolconProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
