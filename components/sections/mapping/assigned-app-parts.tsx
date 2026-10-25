"use client"

import { RiComputerLine } from "@remixicon/react"

import { TextMorph } from "@/components/ui/text-morph"
import { useHdIcon } from "@/lib/hd-icons"
import { cn } from "@/lib/utils"

import type { ControlledApp } from "./preset-config"

/** Pieces an assigned app shows the same way in its row and in its own window. */

/**
 * The app's icon, or the monitor glyph for an app without one. Uses a sharp
 * copy drawn from the executable once it has arrived, so the icon holds up at
 * any size; the ordinary one shows until then.
 */
export function AppIconContent({
  app,
  iconClassName,
}: {
  app: ControlledApp
  iconClassName?: string
}) {
  const hdIcon = useHdIcon(app.iconPath)
  const src = hdIcon ?? app.iconSrc

  return src ? (
    <img
      src={src}
      alt={app.iconAlt}
      className={cn(
        "size-full object-contain p-1",
        !app.running && "grayscale"
      )}
    />
  ) : (
    <RiComputerLine
      className={cn("size-5 text-muted-foreground", iconClassName)}
    />
  )
}

/**
 * Green: playing, so the control is moving something you can hear. Amber: open,
 * but with no audio session for the control to move. Grey: not running at all.
 */
export function appStatus(app: ControlledApp) {
  const color = app.available
    ? "bg-primary"
    : app.running
      ? "bg-amber-500"
      : "bg-muted-foreground/50"
  const label = app.available
    ? `${app.processCount} process${app.processCount === 1 ? "" : "es"}`
    : app.running
      ? "no audio session"
      : "not running"

  return { color, label }
}

/** The status light and what it means. Animated like the controller status, except that an off light stays still. */
export function AppStatusLine({
  app,
  suffix,
  className,
}: {
  app: ControlledApp
  /** Anything to say after the status, such as which control drives the app. */
  suffix?: string
  className?: string
}) {
  const { color, label } = appStatus(app)

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground",
        className
      )}
    >
      <span
        aria-hidden
        className={`size-1.5 shrink-0 transition-colors duration-200 ${color}`}
      >
        {app.running ? (
          <span
            className={`block size-1.5 animate-ping transition-colors duration-200 ${color}`}
          />
        ) : null}
      </span>
      <TextMorph as="span">{label}</TextMorph>
      {suffix ? <span className="truncate">· {suffix}</span> : null}
    </div>
  )
}

/**
 * The two figures drawn as one bar: faint to the level, solid to what the mixer
 * is set to, so the gap the curve opens up is visible at a glance. A muted app
 * shows a red line instead.
 */
export function LevelBars({
  levelPercent,
  mixerPercent,
  muted,
  className,
}: {
  levelPercent: number
  mixerPercent: number
  muted: boolean
  className?: string
}) {
  if (muted) {
    return (
      <div
        aria-hidden
        className={cn("h-0.5 w-full bg-destructive/60", className)}
      />
    )
  }

  return (
    <div aria-hidden className={cn("relative h-0.5 w-full", className)}>
      <div
        className="absolute inset-y-0 left-0 bg-primary/30"
        style={{ width: `${levelPercent}%` }}
      />
      <div
        className="absolute inset-y-0 left-0 bg-primary"
        style={{ width: `${mixerPercent}%` }}
      />
    </div>
  )
}
