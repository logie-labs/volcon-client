"use client"

import { useEffect, useRef, useState } from "react"

import { cn } from "@/lib/utils"

import type { SettingsConfig } from "../settings-config"

type Corner = SettingsConfig["overlay"]["position"]

const corners: ReadonlyArray<{ value: Corner; label: string }> = [
  { value: "top-left", label: "Top left" },
  { value: "top-right", label: "Top right" },
  { value: "bottom-left", label: "Bottom left" },
  { value: "bottom-right", label: "Bottom right" },
]

/** The little screen's size, in px: `w-48` at 16:10. */
const SCREEN_HEIGHT = 120

/** The taskbar strip along its bottom: `h-2.5`. */
const TASKBAR = 10

/** One overlay in miniature, at its usual size: `w-14 h-6`. */
const CHIP_WIDTH = 56
const CHIP_HEIGHT = 24

/** How long a change to the stack shows them all before going back to one. */
const STACK_PREVIEW_MS = 1600

/**
 * Where a chip sits follows a dragged slider within a frame or so, so it keeps
 * up rather than trailing behind; only the stack fading in and out, and the
 * chips resizing to fit it, take their time.
 */
const CHIP_TRANSITION = [
  "opacity 300ms ease-out",
  "height 150ms ease-out",
  "width 150ms ease-out",
  "top 60ms linear",
  "bottom 60ms linear",
  "left 60ms linear",
  "right 60ms linear",
  "border-color 150ms",
  "background-color 150ms",
].join(", ")

/**
 * Real pixels to the little screen's. Exaggerated well past true scale -
 * at true scale a gap or margin of a few pixels would round away to nothing -
 * but still in proportion to the settings, so their changes can be seen.
 */
const miniInset = (edgeMargin: number) => 3 + edgeMargin * 0.12
const miniGap = (cardGap: number) => cardGap * 0.25

/** The corner an arrow key moves to from `corner`, if any. */
function cornerToward(corner: Corner, key: string): Corner | null {
  const [vertical, horizontal] = corner.split("-")

  switch (key) {
    case "ArrowLeft":
      return `${vertical}-left` as Corner
    case "ArrowRight":
      return `${vertical}-right` as Corner
    case "ArrowUp":
      return `top-${horizontal}` as Corner
    case "ArrowDown":
      return `bottom-${horizontal}` as Corner
    default:
      return null
  }
}

/** The overlay in miniature: an app icon and its level. */
function MiniOverlay({ active }: { active: boolean }) {
  return (
    <>
      <span
        aria-hidden
        className={cn("aspect-square h-1/2 max-h-3 shrink-0", active ? "bg-foreground/30" : "bg-foreground/10")}
      />
      <span aria-hidden className="relative h-1 flex-1 bg-foreground/10">
        <span
          className={cn("absolute inset-y-0 left-0 w-3/5", active ? "bg-primary" : "bg-foreground/15")}
        />
      </span>
    </>
  )
}

/**
 * A small screen to pick the overlay's corner on, taskbar and all, drawn the
 * way the overlay will sit: in from the edges by the set distance, and above
 * the taskbar when it's kept clear of it. Changing how many can stack, or the
 * space between them, shows that many for a moment before settling back to
 * one. A radio group: arrow keys move between the corners.
 */
export function OverlayCornerPicker({
  value,
  avoidTaskbar,
  maxCards,
  cardGap,
  edgeMargin,
  scale,
  disabled = false,
  onValueChange,
  ...aria
}: {
  value: Corner
  avoidTaskbar: boolean
  maxCards: number
  cardGap: number
  edgeMargin: number
  /** The overlay's size setting: the chips grow and shrink with it. */
  scale: number
  disabled?: boolean
  onValueChange: (corner: Corner) => void
  "aria-labelledby"?: string
  "aria-describedby"?: string
}) {
  const buttons = useRef(new Map<Corner, HTMLButtonElement>())

  // A change to the stack shows it off. Compared during render, against what
  // was last seen, so the preview starts the same frame the setting changes.
  const [seen, setSeen] = useState({ maxCards, cardGap })
  const [previewing, setPreviewing] = useState(false)

  if (seen.maxCards !== maxCards || seen.cardGap !== cardGap) {
    setSeen({ maxCards, cardGap })
    setPreviewing(true)
  }

  // ...and settles back to one once it's been left alone a moment.
  useEffect(() => {
    if (!previewing) {
      return
    }

    const timer = setTimeout(() => setPreviewing(false), STACK_PREVIEW_MS)
    return () => clearTimeout(timer)
  }, [previewing, maxCards, cardGap])

  const inset = miniInset(edgeMargin)
  const gap = miniGap(cardGap)
  const count = previewing ? maxCards : 1
  // The chips are the overlay at its set scale...
  const chipWidth = CHIP_WIDTH * scale
  const fullHeight = CHIP_HEIGHT * scale
  // ...shrunk to fit the screen when as many as there are wouldn't.
  const room = SCREEN_HEIGHT - 2 * inset - TASKBAR
  const chipHeight = Math.min(fullHeight, (room - (count - 1) * gap) / count)

  /** Where a chip sits from its corner, `index` places out from it. */
  const place = (corner: Corner, index: number, height: number) => {
    const [cornerVertical, cornerHorizontal] = corner.split("-") as ["top" | "bottom", "left" | "right"]
    const fromBottom = cornerVertical === "bottom" && avoidTaskbar ? TASKBAR : 0

    return {
      [cornerVertical]: inset + fromBottom + index * (height + gap),
      [cornerHorizontal]: inset,
      width: chipWidth,
      height,
    }
  }

  return (
    <div
      role="radiogroup"
      aria-disabled={disabled || undefined}
      data-previewing={previewing || undefined}
      {...aria}
      className={cn(
        "relative aspect-16/10 w-48 shrink-0 overflow-hidden border bg-muted/30 transition-opacity",
        disabled && "pointer-events-none opacity-50"
      )}
    >
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-2.5 border-t bg-muted" />

      {/* The stack in the chosen corner: one, or for a moment as many as can
          show at once. Every chip is always there, so they fade and move
          rather than pop. */}
      {Array.from({ length: maxCards }, (_, index) => (
        <span
          key={index}
          aria-hidden
          style={{
            ...place(value, index, chipHeight),
            opacity: index < count ? 1 : 0,
            transition: CHIP_TRANSITION,
          }}
          className="pointer-events-none absolute flex items-center gap-1 border border-primary bg-background px-1"
        >
          <MiniOverlay active />
        </span>
      ))}

      {corners.map((corner) => {
        const selected = corner.value === value

        return (
          <button
            key={corner.value}
            ref={(node) => {
              if (node) {
                buttons.current.set(corner.value, node)
              } else {
                buttons.current.delete(corner.value)
              }
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={corner.label}
            title={corner.label}
            disabled={disabled}
            tabIndex={selected ? 0 : -1}
            onClick={() => onValueChange(corner.value)}
            onKeyDown={(event) => {
              const next = cornerToward(corner.value, event.key)

              if (!next) {
                return
              }

              event.preventDefault()
              onValueChange(next)
              buttons.current.get(next)?.focus()
            }}
            style={{
              ...place(corner.value, 0, fullHeight),
              // Out of the way while the stack is shown off, which can run
              // down past where the corner below would be.
              opacity: previewing && !selected ? 0 : 1,
              transition: CHIP_TRANSITION,
            }}
            className={cn(
              "absolute flex items-center gap-1 px-1 outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
              // The chosen corner's chip is drawn by the stack above; this is
              // only where to click.
              selected
                ? "border border-transparent"
                : "border border-dashed border-foreground/20 hover:border-foreground/40 hover:bg-background/50"
            )}
          >
            {selected ? null : <MiniOverlay active={false} />}
          </button>
        )
      })}
    </div>
  )
}
