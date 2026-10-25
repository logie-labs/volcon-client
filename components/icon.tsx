import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Window caption glyphs from the icon font installed with Windows - Segoe
 * Fluent Icons on Windows 11, Segoe MDL2 Assets on Windows 10, named as the
 * `font-icon` family in `globals.css` - the same codepoints Windows itself
 * paints for the title bar buttons, so Volcon's minimise, maximise and close
 * look exactly like every other window's. The font is the PC's own, never
 * bundled: Microsoft doesn't allow it to ship with an app.
 *
 * This font is for the window controls only. Everywhere else in the app uses
 * `@remixicon/react`.
 */
export const glyphs = {
  minimize: "", // ChromeMinimize
  maximize: "", // ChromeMaximize
  restore: "", // ChromeRestore
  close: "", // ChromeClose
} as const

export type IconName = keyof typeof glyphs

/**
 * The same stack as the `font-icon` class, set on the element as well. These
 * codepoints are blank in any text font, so if the class ever goes missing - a
 * dev server still serving an older `globals.css` - the glyphs would draw as
 * empty boxes. Named here, Windows' own installed copy (Segoe Fluent Icons on
 * Windows 11, Segoe MDL2 Assets on Windows 10, which has the same glyphs) is
 * used even then.
 */
const ICON_FONT = '"Segoe Fluent Icons", "Segoe MDL2 Assets", sans-serif'

type IconProps = Omit<React.ComponentProps<"span">, "children"> & {
  name: IconName
}

export function Icon({ name, className, style, ...props }: IconProps) {
  return (
    <span
      aria-hidden
      data-slot="icon"
      className={cn("pointer-events-none font-icon leading-none", className)}
      style={{ fontFamily: ICON_FONT, ...style }}
      {...props}
    >
      {glyphs[name]}
    </span>
  )
}
