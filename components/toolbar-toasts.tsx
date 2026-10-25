"use client"

import { useEffect, useState } from "react"

import {
  dismissCurrentNotification,
  undoNotification,
  useCurrentNotification,
  type Notification,
} from "@/lib/notifications"
import { cn } from "@/lib/utils"

import { notificationKindStyle } from "./notification-kind"

/**
 * How long a leaving message stays mounted to play its exit. Matched to the
 * `duration-200` both lines animate with; the incoming one is already on screen
 * while this runs, so it delays nothing.
 */
const EXIT_MS = 200

/** One message, drawn over the title, on its way in or on its way out. */
function Line({ entry, leaving }: { entry: Notification; leaving: boolean }) {
  const { icon: Icon, tone } = notificationKindStyle[entry.kind]
  // An Undo first, since it's the one thing worth catching before it goes;
  // otherwise its first action.
  const action = entry.undo
    ? { label: "Undo", onClick: () => void undoNotification(entry.id) }
    : entry.actions[0]

  return (
    <div
      // A running commentary: a screen reader hears it when it's free, except
      // for errors. The outgoing copy has been announced once already.
      aria-live={
        leaving ? "off" : entry.kind === "error" ? "assertive" : "polite"
      }
      aria-hidden={leaving}
      className={cn(
        "pointer-events-none absolute inset-0 z-10 flex items-center gap-2 px-3",
        // The exit is the entrance mirrored - same distance, curve and length -
        // so the two overlap as one handover rather than two movements.
        // `fill-mode-forwards` keeps the leaving line faded out until React
        // removes it, instead of snapping back to full strength for a frame.
        leaving
          ? "animate-out fill-mode-forwards fade-out-0 slide-out-to-bottom-3"
          : "animate-in fade-in-0 slide-in-from-top-3",
        "duration-200 ease-out"
      )}
    >
      <Icon aria-hidden className={cn("size-3.5 shrink-0", tone)} />

      {/* One line that truncates: the full text is on the Notifications screen. */}
      <span className="min-w-0 truncate text-[11px] text-foreground/90">
        {entry.title}
        {entry.description ? (
          <span className="text-muted-foreground"> · {entry.description}</span>
        ) : null}
      </span>

      {action && !leaving ? (
        <button
          type="button"
          // The one thing here that takes the pointer, so the rest of the bar
          // keeps dragging the window.
          className="pointer-events-auto shrink-0 font-mono text-[10px] tracking-[0.08em] text-foreground uppercase underline decoration-dotted underline-offset-2 transition-colors hover:decoration-solid"
          onClick={() => {
            action.onClick()

            // Done is done: leaving the offer up invites taking it twice. An
            // Undo takes itself down once it's done, and stays if it asks
            // first and the answer is no.
            if (!entry.undo) {
              dismissCurrentNotification()
            }
          }}
        >
          {action.label}
        </button>
      ) : null}
    </div>
  )
}

/**
 * Messages in the title bar, over the title they briefly replace.
 *
 * Sits inside the toolbar's left cell and takes no pointer events, because
 * that cell is the window's drag region: a layer over it that took the pointer
 * would stop the window dragging for as long as a message was up. Only the
 * action button opts back in.
 */
export function ToolbarToasts() {
  const current = useCurrentNotification()

  /** The message that owns the line. */
  const [shown, setShown] = useState<Notification | null>(current)
  /**
   * The one it took the line from, kept only long enough to leave. Two slots
   * because the animations overlap: the old fades down and out while the new
   * fades in, which reads as one line being rewritten.
   */
  const [leaving, setLeaving] = useState<Notification | null>(null)

  // Adjusted during render, so the new message is up the same frame the store
  // has it rather than a frame later from an effect.
  if (current?.id !== shown?.id) {
    setLeaving(shown)
    setShown(current)
  }

  useEffect(() => {
    if (!leaving) {
      return
    }

    const timeout = setTimeout(() => setLeaving(null), EXIT_MS)

    return () => clearTimeout(timeout)
  }, [leaving])

  if (!shown && !leaving) {
    return null
  }

  return (
    <>
      {/* The backdrop outlives any one message: it fades in with the first,
          holds through every swap, and fades out with the last, so a swap
          never lets the title underneath flash through. */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 z-10",
          "bg-[color-mix(in_oklab,var(--background)_94%,var(--foreground)_6%)]",
          shown
            ? "animate-in fade-in-0"
            : "animate-out fill-mode-forwards fade-out-0",
          "duration-200 ease-out"
        )}
      />

      {/* Outgoing first so the incoming paints over it. Keyed, so each gets its
          own element to animate. */}
      {leaving ? <Line key={leaving.id} entry={leaving} leaving /> : null}
      {shown ? <Line key={shown.id} entry={shown} leaving={false} /> : null}
    </>
  )
}
