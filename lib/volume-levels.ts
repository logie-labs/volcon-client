"use client"

import { useSyncExternalStore } from "react"

/**
 * The UI's mirror of the level chain in `src-tauri/src/server/state/levels.rs`.
 *
 * A control position becomes a level in ordered stages — curve, then trim, then
 * mute — and the audio thread is the one that actually runs them. This mirror
 * exists so a level can be labelled on screen without a round trip per frame of
 * a knob sweep.
 *
 * The mirror is only trustworthy because of where its curve comes from: the
 * backend's answer to what it is applying, never the settings store. Reading the
 * setting directly is what lets the screen describe a curve the audio thread
 * isn't using — a number that disagrees with what you can hear.
 */

export type VolumeCurve = {
  enabled: boolean
  strength: number
}

export const DEFAULT_CURVE: VolumeCurve = { enabled: false, strength: 20 }

/** Mirrors `MAX_GAMMA` in levels.rs. */
const MAX_GAMMA = 4

function sane(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback
}

function gamma(curve: VolumeCurve) {
  const strength = Math.max(0, Math.min(100, sane(curve.strength, 0)))

  return 1 + (strength / 100) * (MAX_GAMMA - 1)
}

/** Stage 1: response shaping. 0–1 in, 0–1 out, both ends fixed. */
export function shapePosition(position: number, curve: VolumeCurve) {
  const clamped = Math.max(0, Math.min(1, sane(position, 0)))

  if (!curve.enabled) {
    return clamped
  }

  return clamped ** gamma(curve)
}

function saneTrim(trim: number) {
  return Math.max(0, Math.min(1, sane(trim, 1)))
}

/**
 * The level with the curve off: the position and the trim as whole percents,
 * multiplied and rounded to a whole percent again, so a control at 14% sets
 * 14%. Mirrors `whole_percent_level` in levels.rs, in whole numbers on both
 * sides so the two can't round a hair apart.
 */
export function wholeLevelPercent(positionPercent: number, trim: number) {
  const position = Math.round(
    Math.max(0, Math.min(100, sane(positionPercent, 0)))
  )
  const trimPercent = Math.round(saneTrim(trim) * 100)

  return Math.floor((position * trimPercent + 50) / 100)
}

/**
 * The whole chain, in the percentages the UI carries levels around in: where a
 * control sits, in, and what the app is actually set to, out. A whole percent
 * with the curve off; with it on, the exact figure.
 */
export function resolveLevelPercent(
  positionPercent: number,
  modifiers: { trim: number; muted: boolean },
  curve: VolumeCurve,
) {
  if (modifiers.muted) {
    return 0
  }

  if (!curve.enabled) {
    return wholeLevelPercent(positionPercent, modifiers.trim)
  }

  const shaped = shapePosition(positionPercent / 100, curve)
  const trimmed = shaped * saneTrim(modifiers.trim)

  return Math.max(0, Math.min(100, trimmed * 100))
}

// --- the curve the backend has confirmed it is applying --------------------

let active: VolumeCurve = DEFAULT_CURVE
const listeners = new Set<() => void>()

function same(left: VolumeCurve, right: VolumeCurve) {
  return left.enabled === right.enabled && left.strength === right.strength
}

/**
 * Adopts a curve the backend has reported. The only way this value changes —
 * call it with a response, never with a local intention.
 */
export function setActiveCurve(curve: VolumeCurve | null | undefined) {
  if (!curve || typeof curve.enabled !== "boolean") {
    return
  }

  const next: VolumeCurve = {
    enabled: curve.enabled,
    strength: sane(Number(curve.strength), DEFAULT_CURVE.strength),
  }

  if (same(active, next)) {
    return
  }

  active = next

  for (const listener of listeners) {
    listener()
  }
}

export function getActiveCurve() {
  return active
}

function subscribe(listener: () => void) {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

/** The curve the audio thread is applying right now. */
export function useActiveCurve() {
  return useSyncExternalStore(subscribe, getActiveCurve, () => DEFAULT_CURVE)
}
