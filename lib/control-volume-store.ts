"use client"

import { useCallback, useSyncExternalStore } from "react"

/**
 * Live control positions, kept outside React state on purpose.
 *
 * A knob sweep arrives as a MIDI CC stream — well over a hundred events a
 * second — and routing that through a context value re-rendered every consumer
 * in the app for each one. Everything that shows a level subscribes to just the
 * control it displays instead, and notifications are coalesced to one per frame,
 * so a moving knob costs one render of one component per frame.
 *
 * The position here is the raw controller value, applied the moment the event
 * lands. The audio thread smooths its way to that target afterwards; the UI does
 * not wait for it, which is what makes a control driving five apps feel as
 * immediate as one driving a single app.
 */

export type ControlPosition = {
  control: number
  /** Raw MIDI value, 0–127. */
  value: number
  /** Position as a percentage, 0–100. */
  percent: number
  updatedAt: number
}

type Listener = () => void

const positions = new Map<number, ControlPosition>()
const listeners = new Set<Listener>()
const controlListeners = new Map<number, Set<Listener>>()

let pendingControls: Set<number> | null = null
let flushHandle: number | null = null
let fallbackHandle: ReturnType<typeof setTimeout> | null = null

/** How long a change waits for a frame before it's delivered without one. */
const FLUSH_FALLBACK_MS = 50

export function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)))
}

export function controlValueToPercent(value: number) {
  return clampPercent((value / 127) * 100)
}

function flush() {
  if (flushHandle !== null && typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(flushHandle)
  }

  if (fallbackHandle !== null) {
    clearTimeout(fallbackHandle)
  }

  flushHandle = null
  fallbackHandle = null

  const controls = pendingControls
  pendingControls = null

  if (!controls) {
    return
  }

  for (const control of controls) {
    const subscribers = controlListeners.get(control)

    if (!subscribers) {
      continue
    }

    for (const listener of subscribers) {
      listener()
    }
  }

  for (const listener of listeners) {
    listener()
  }
}

function scheduleNotify(control: number) {
  if (pendingControls) {
    pendingControls.add(control)
  } else {
    pendingControls = new Set([control])
  }

  if (flushHandle !== null || fallbackHandle !== null) {
    return
  }

  if (typeof requestAnimationFrame === "function") {
    flushHandle = requestAnimationFrame(flush)
  }

  // A frame doesn't always come: a window being moved or resized can hold
  // them back, which froze the overlay's figures while it was repositioned.
  // Whichever of the two comes first delivers, and cancels the other.
  fallbackHandle = setTimeout(flush, FLUSH_FALLBACK_MS)
}

/**
 * Records where a control now sits. Called straight off the `control:update`
 * event, which the backend emits synchronously from the MIDI callback, so this
 * is the earliest the app can possibly know the position.
 */
export function setControlPosition(control: number, value: number, percent?: number) {
  const nextPercent =
    typeof percent === "number" && Number.isFinite(percent)
      ? clampPercent(percent)
      : controlValueToPercent(value)

  const existing = positions.get(control)

  if (existing && existing.percent === nextPercent && existing.value === value) {
    return
  }

  positions.set(control, {
    control,
    value,
    percent: nextPercent,
    updatedAt: Date.now(),
  })

  scheduleNotify(control)
}

/**
 * Seeds a control's position from saved state so a page opened before the knob
 * has been touched shows the level it was left at rather than zero.
 */
export function seedControlPosition(control: number, percent: number) {
  if (positions.has(control)) {
    return
  }

  const clamped = clampPercent(percent)

  positions.set(control, {
    control,
    value: Math.round((clamped / 100) * 127),
    percent: clamped,
    updatedAt: 0,
  })

  scheduleNotify(control)
}

export function getControlPosition(control: number) {
  return positions.get(control) ?? null
}

export function getControlPercents() {
  const percents: Record<number, number> = {}

  for (const [control, position] of positions) {
    percents[control] = position.percent
  }

  return percents
}

function subscribeToControl(control: number, listener: Listener) {
  const subscribers = controlListeners.get(control) ?? new Set<Listener>()
  subscribers.add(listener)
  controlListeners.set(control, subscribers)

  return () => {
    subscribers.delete(listener)

    if (subscribers.size === 0) {
      controlListeners.delete(control)
    }
  }
}

/** Fires for any control, coalesced to one call per frame. */
export function subscribeToControls(listener: Listener) {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

/**
 * The live position of one control as a percentage, falling back to `fallback`
 * until the control has reported in.
 */
export function useControlPercent(control: number, fallback = 0) {
  const subscribe = useCallback(
    (listener: Listener) => subscribeToControl(control, listener),
    [control],
  )

  const getSnapshot = useCallback(() => positions.get(control)?.percent ?? null, [control])

  const percent = useSyncExternalStore(subscribe, getSnapshot, () => null)

  return percent ?? clampPercent(fallback)
}

/**
 * The live raw position of one control, 0–127, falling back to `fallbackPercent`
 * until the control has reported in. For figures finer than a whole percent,
 * which the rounded percentage can't give.
 */
export function useControlValue(control: number, fallbackPercent = 0) {
  const subscribe = useCallback(
    (listener: Listener) => subscribeToControl(control, listener),
    [control],
  )

  const getSnapshot = useCallback(() => positions.get(control)?.value ?? null, [control])

  const value = useSyncExternalStore(subscribe, getSnapshot, () => null)

  return value ?? Math.round((clampPercent(fallbackPercent) / 100) * 127)
}

/** The control moved most recently, or null if none has reported in. */
function latestPercent() {
  let latest: ControlPosition | null = null

  for (const position of positions.values()) {
    if (!latest || position.updatedAt > latest.updatedAt) {
      latest = position
    }
  }

  return latest?.percent ?? null
}

/**
 * The live position of whichever control was moved last, as a percentage, for
 * a preview that should follow the knob in your hand whichever one it is.
 * Falls back to `fallback` until any control has reported in.
 */
export function useLatestControlPercent(fallback = 50) {
  const percent = useSyncExternalStore(subscribeToControls, latestPercent, () => null)

  return percent ?? clampPercent(fallback)
}
