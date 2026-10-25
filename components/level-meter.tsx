"use client"

import { useEffect, useRef } from "react"

import { useSettingsConfig } from "@/components/sections/settings/settings-config"
import {
  METER_FLOOR_DB,
  subscribeToMeter,
  type MeterFrame,
} from "@/lib/audio-meters"
import { cn } from "@/lib/utils"

/**
 * The meter's colours, laid out along its length rather than chosen by level:
 * green through the ordinary range, amber as it nears the top, red at full
 * scale. The level reveals however much of this there is, so a loud signal
 * shows its amber and red tip exactly as a hardware meter would. On the meter's
 * decibel scale, 70% is -18 dB and 88% about -7 dB.
 */
export const SCALE_COLOURS =
  "var(--primary) 0%, var(--primary) 70%, var(--color-amber-500, #f59e0b) 88%, var(--destructive) 100%"

/** Marks along the large meter, in dB, each at its place on the meter's scale. */
const DB_TICKS = [-60, -40, -20, -10, -6, 0]

type Orientation = "vertical" | "horizontal"

type ChannelRefs = {
  source: React.RefObject<HTMLDivElement | null>
  heard: React.RefObject<HTMLDivElement | null>
  hold: React.RefObject<HTMLDivElement | null>
}

/**
 * How far an app's own volume moves its level along the meter. The meter is in
 * decibels, so a volume is a fixed step down it: half volume is 6 dB lower
 * wherever the signal sits. Nothing gets through at zero, or while muted.
 */
function gainOffset(gain: number) {
  return gain > 0 ? (20 * Math.log10(gain)) / -METER_FLOOR_DB : -Infinity
}

function clip(level: number, orientation: Orientation) {
  const hidden = `${((1 - Math.min(1, Math.max(0, level))) * 100).toFixed(2)}%`
  return orientation === "vertical"
    ? `inset(${hidden} 0 0 0)`
    : `inset(0 ${hidden} 0 0)`
}

function drawChannel(
  refs: ChannelRefs,
  level: number,
  peak: number,
  offset: number,
  orientation: Orientation
) {
  const heard = Math.max(0, level + offset)
  const heardPeak = Math.max(0, peak + offset)

  if (refs.source.current) {
    refs.source.current.style.clipPath = clip(level, orientation)
  }

  if (refs.heard.current) {
    refs.heard.current.style.clipPath = clip(heard, orientation)
  }

  if (refs.hold.current) {
    const at = `${(Math.min(1, heardPeak) * 100).toFixed(2)}%`

    if (orientation === "vertical") {
      refs.hold.current.style.bottom = at
    } else {
      refs.hold.current.style.left = at
    }

    refs.hold.current.style.opacity = heardPeak > 0.01 ? "1" : "0"
  }
}

function Channel({
  sourceRef,
  heardRef,
  holdRef,
  orientation,
  className,
}: {
  sourceRef: ChannelRefs["source"]
  heardRef: ChannelRefs["heard"]
  holdRef: ChannelRefs["hold"]
  orientation: Orientation
  className?: string
}) {
  const vertical = orientation === "vertical"
  const layer = {
    background: `linear-gradient(${vertical ? "to top" : "to right"}, ${SCALE_COLOURS})`,
    clipPath: vertical ? "inset(100% 0 0 0)" : "inset(0 100% 0 0)",
    // Readings arrive about thirty times a second; this blends between them.
    transition: "clip-path 45ms linear",
  }

  return (
    <div className={cn("relative overflow-hidden bg-muted", className)}>
      {/* What the app is playing, before its volume: faint, behind. */}
      <div
        ref={sourceRef}
        className="absolute inset-0 opacity-30"
        style={layer}
      />
      {/* What gets through at the volume it's set to: what you hear. */}
      <div ref={heardRef} className="absolute inset-0" style={layer} />
      <div
        ref={holdRef}
        className={cn(
          "absolute bg-foreground/80 opacity-0 transition-opacity duration-150",
          vertical ? "inset-x-0 bottom-0 h-px" : "inset-y-0 left-0 w-px"
        )}
      />
    </div>
  )
}

/**
 * An app's live audio level, left and right, as two bars.
 *
 * Each bar shows two things, in the app's usual faint-and-solid way: faint, the
 * level the app is playing at, which Windows reports before the app's own
 * volume; solid, what gets through once its volume is applied, which is what
 * you hear. The faint part stays put however the volume is set, and the solid
 * part tracks the volume exactly.
 *
 * Vertical and small beside an app's volume figures, or horizontal and large
 * with a decibel scale in the app's own window. Draws straight onto its own
 * elements on every reading, so a meter updating thirty times a second never
 * re-renders anything around it. Renders nothing at all, and measures nothing,
 * with level meters turned off in Settings.
 */
export function LevelMeter({
  apps,
  gain = 1,
  orientation = "vertical",
  muted = false,
  className,
}: {
  /**
   * The apps as assigned - the names their volumes are set by. A row standing
   * for several (helpers installed alongside the main app) shows the loudest.
   */
  apps: string[]
  /** The app's volume in the mixer, 0 to 1, which the solid level is scaled by. */
  gain?: number
  orientation?: Orientation
  /** Nothing is heard from a muted app, so only its faint level shows. */
  muted?: boolean
  className?: string
}) {
  const enabled = useSettingsConfig().mapping.levelMeters

  const leftSource = useRef<HTMLDivElement>(null)
  const leftHeard = useRef<HTMLDivElement>(null)
  const leftHold = useRef<HTMLDivElement>(null)
  const rightSource = useRef<HTMLDivElement>(null)
  const rightHeard = useRef<HTMLDivElement>(null)
  const rightHold = useRef<HTMLDivElement>(null)

  // Read at draw time rather than baked into the subscription, so the volume
  // changing as a control turns doesn't resubscribe the meter.
  const offset = useRef(0)
  const nextOffset = gainOffset(muted ? 0 : gain)

  useEffect(() => {
    offset.current = nextOffset
  })

  // A stable key for the list, so a re-render with the same apps doesn't
  // resubscribe.
  const appKey = JSON.stringify(apps)

  useEffect(() => {
    const names = JSON.parse(appKey) as string[]

    if (!enabled || names.length === 0) {
      return
    }

    const frames = new Map<string, MeterFrame>()
    const left = { source: leftSource, heard: leftHeard, hold: leftHold }
    const right = { source: rightSource, heard: rightHeard, hold: rightHold }

    const draw = () => {
      let leftLevel = 0
      let rightLevel = 0
      let leftPeak = 0
      let rightPeak = 0

      for (const frame of frames.values()) {
        leftLevel = Math.max(leftLevel, frame.left)
        rightLevel = Math.max(rightLevel, frame.right)
        leftPeak = Math.max(leftPeak, frame.leftHold)
        rightPeak = Math.max(rightPeak, frame.rightHold)
      }

      drawChannel(left, leftLevel, leftPeak, offset.current, orientation)
      drawChannel(right, rightLevel, rightPeak, offset.current, orientation)
    }

    const unsubscribes = names.map((name) =>
      subscribeToMeter(name, (frame) => {
        frames.set(name, frame)
        draw()
      })
    )

    return () => unsubscribes.forEach((unsubscribe) => unsubscribe())
  }, [appKey, enabled, orientation])

  if (!enabled) {
    return null
  }

  if (orientation === "vertical") {
    return (
      <div
        aria-hidden
        title="Left and right audio level: faint is what the app is playing, solid is what you hear at its volume"
        className={cn("flex h-10 shrink-0 gap-0.75", className)}
      >
        <Channel
          sourceRef={leftSource}
          heardRef={leftHeard}
          holdRef={leftHold}
          orientation="vertical"
          className="w-1"
        />
        <Channel
          sourceRef={rightSource}
          heardRef={rightHeard}
          holdRef={rightHold}
          orientation="vertical"
          className="w-1"
        />
      </div>
    )
  }

  return (
    <div aria-hidden className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-center gap-2">
        <span className="w-2 font-mono text-[10px] text-muted-foreground">
          L
        </span>
        <Channel
          sourceRef={leftSource}
          heardRef={leftHeard}
          holdRef={leftHold}
          orientation="horizontal"
          className="h-2.5 flex-1"
        />
      </div>
      <div className="flex items-center gap-2">
        <span className="w-2 font-mono text-[10px] text-muted-foreground">
          R
        </span>
        <Channel
          sourceRef={rightSource}
          heardRef={rightHeard}
          holdRef={rightHold}
          orientation="horizontal"
          className="h-2.5 flex-1"
        />
      </div>

      <div className="relative ml-4 h-3 font-mono text-[9px] whitespace-nowrap text-muted-foreground/70">
        {DB_TICKS.map((db, index) => {
          const at = ((db - METER_FLOOR_DB) / -METER_FLOOR_DB) * 100
          const edge =
            index === 0
              ? "translate-x-0"
              : index === DB_TICKS.length - 1
                ? "-translate-x-full"
                : "-translate-x-1/2"

          return (
            <span
              key={db}
              className={cn("absolute top-0 tabular-nums", edge)}
              style={{ left: `${at}%` }}
            >
              {db === 0 ? "0 dB" : db}
            </span>
          )
        })}
      </div>
    </div>
  )
}
