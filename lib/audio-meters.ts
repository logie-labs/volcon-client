"use client"

import { getPeaks, stopPeaks } from "@/lib/bridge-client"
import { hasTauriRuntime } from "@/lib/tauri-runtime"

/**
 * Live left and right levels for the level meters.
 *
 * The backend measures, this polls, and the meters draw. Polling only happens
 * while at least one meter is on screen and the window can be seen: the moment
 * the last meter unmounts - its screen closed, or meters turned off in Settings
 * - or the window is hidden, polling stops and the backend is told to stop
 * measuring and let go of what it held to measure with. Nothing runs, on either
 * side, for a meter nobody can see.
 */

/** One meter's reading, on the meter's own 0-1 scale (see `toMeterScale`). */
export type MeterFrame = {
  left: number
  right: number
  /** The recent peak on each side, held briefly so a transient can be read. */
  leftHold: number
  rightHold: number
}

const SILENT: MeterFrame = { left: 0, right: 0, leftHold: 0, rightHold: 0 }

/** About thirty readings a second: smooth enough to look alive, cheap to ask for. */
const POLL_MS = 33

/** The quietest level a meter shows; anything below reads as silence. */
export const METER_FLOOR_DB = -60

/** How fast a falling level drops, in meter heights per second. Rises are instant. */
const FALL_PER_SECOND = 1.8

/** How long a peak is held before it starts to drop, and how fast it then falls. */
const HOLD_MS = 900
const HOLD_FALL_PER_SECOND = 0.7

/**
 * A peak amplitude on the meter's scale, which is decibels rather than raw
 * amplitude: ordinary listening sits in the middle of the meter instead of
 * crowding the bottom of it, which is how hardware meters read too.
 */
export function toMeterScale(peak: number) {
  if (!(peak > 0)) {
    return 0
  }

  const db = 20 * Math.log10(peak)
  return Math.min(1, Math.max(0, (db - METER_FLOOR_DB) / -METER_FLOOR_DB))
}

type Channel = { level: number; hold: number; holdUntil: number }

type Entry = {
  listeners: Set<(frame: MeterFrame) => void>
  left: Channel
  right: Channel
}

const entries = new Map<string, Entry>()
let polling = false
/** Bumped whenever polling stops, so a reply still in flight is thrown away. */
let generation = 0
let timer: ReturnType<typeof setTimeout> | null = null
let lastTickAt = 0
let watchingVisibility = false

function silentChannel(): Channel {
  return { level: 0, hold: 0, holdUntil: 0 }
}

function advance(
  channel: Channel,
  target: number,
  now: number,
  seconds: number
) {
  channel.level = Math.max(target, channel.level - FALL_PER_SECOND * seconds)

  if (channel.level >= channel.hold) {
    channel.hold = channel.level
    channel.holdUntil = now + HOLD_MS
  } else if (now > channel.holdUntil) {
    channel.hold = Math.max(
      channel.level,
      channel.hold - HOLD_FALL_PER_SECOND * seconds
    )
  }
}

function frameOf(entry: Entry): MeterFrame {
  return {
    left: entry.left.level,
    right: entry.right.level,
    leftHold: entry.left.hold,
    rightHold: entry.right.hold,
  }
}

function shouldPoll() {
  return (
    entries.size > 0 &&
    hasTauriRuntime() &&
    document.visibilityState === "visible"
  )
}

function startPolling() {
  if (polling || !shouldPoll()) {
    return
  }

  polling = true
  lastTickAt = performance.now()
  void tick(++generation)
}

/**
 * Stops polling, tells the backend to stop measuring, and drops every meter to
 * silence so one that comes back starts empty rather than frozen mid-song.
 */
function stopPolling() {
  if (!polling) {
    return
  }

  polling = false
  generation++

  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }

  void stopPeaks().catch(() => {
    // The backend stops on its own a moment after the last poll anyway.
  })

  for (const entry of entries.values()) {
    entry.left = silentChannel()
    entry.right = silentChannel()

    for (const listener of entry.listeners) {
      listener(SILENT)
    }
  }
}

async function tick(run: number) {
  const apps = [...entries.keys()]
  let peaks: Record<string, [number, number]> = {}

  try {
    peaks = (await getPeaks(apps)).peaks ?? {}
  } catch {
    // A missed reading draws as a moment of decay, not as an error.
  }

  if (run !== generation) {
    return
  }

  const now = performance.now()
  const seconds = Math.min(0.25, (now - lastTickAt) / 1000)
  lastTickAt = now

  for (const [app, entry] of entries) {
    const [left = 0, right = 0] = peaks[app] ?? []
    advance(entry.left, toMeterScale(left), now, seconds)
    advance(entry.right, toMeterScale(right), now, seconds)

    const frame = frameOf(entry)
    for (const listener of entry.listeners) {
      listener(frame)
    }
  }

  timer = setTimeout(() => {
    timer = null
    void tick(run)
  }, POLL_MS)
}

function watchVisibility() {
  if (watchingVisibility) {
    return
  }

  watchingVisibility = true

  // Minimised, hidden to the tray, or behind another window's tab: no meters
  // can be seen, so none are measured.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      startPolling()
    } else {
      stopPolling()
    }
  })
}

/**
 * Starts delivering `app`'s levels to `listener` until the returned function is
 * called. The first subscriber anywhere starts polling; the last one leaving
 * stops it, and the backend's measuring with it.
 */
export function subscribeToMeter(
  app: string,
  listener: (frame: MeterFrame) => void
) {
  watchVisibility()

  let entry = entries.get(app)

  if (!entry) {
    entry = {
      listeners: new Set(),
      left: silentChannel(),
      right: silentChannel(),
    }
    entries.set(app, entry)
  }

  entry.listeners.add(listener)
  listener(frameOf(entry))
  startPolling()

  return () => {
    const current = entries.get(app)

    if (!current) {
      return
    }

    current.listeners.delete(listener)

    if (current.listeners.size === 0) {
      entries.delete(app)
    }

    if (entries.size === 0) {
      stopPolling()
    }
  }
}
