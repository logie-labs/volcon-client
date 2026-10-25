"use client"

import { useEffect, useRef, useState, useSyncExternalStore } from "react"

import Counter from "@/components/Counter"
import {
  defaultSettingsConfig,
  getSettingsSnapshot,
  subscribeToSettings,
} from "@/components/sections/settings/settings-config"

// From the shared snapshot, which is read once and kept until the settings
// change: every figure asks on every render, and a turning knob re-renders them
// each frame. The snapshot also takes what the main window sends the overlay,
// so the overlay's figures follow a change made in Settings.
const readAnimatedNumbers = () => getSettingsSnapshot().appearance.animatedNumbers

function subscribeToPageVisibility(listener: () => void) {
  document.addEventListener("visibilitychange", listener)
  return () => document.removeEventListener("visibilitychange", listener)
}

/**
 * One observer for every figure rather than one each: there can be dozens on
 * screen, and they all ask the same question. It reports clipping by scroll
 * areas as well as the window edge, so a card scrolled out of the grid counts
 * as off screen.
 */
let sharedObserver: IntersectionObserver | null = null
const visibilityCallbacks = new Map<Element, (onScreen: boolean) => void>()

function observeOnScreen(element: Element, callback: (onScreen: boolean) => void) {
  sharedObserver ??= new IntersectionObserver((entries) => {
    for (const entry of entries) {
      visibilityCallbacks.get(entry.target)?.(entry.isIntersecting)
    }
  })

  visibilityCallbacks.set(element, callback)
  sharedObserver.observe(element)

  return () => {
    visibilityCallbacks.delete(element)
    sharedObserver?.unobserve(element)
  }
}

/**
 * A volume figure. Rolls odometer-style to each new value, or with "Animated
 * numbers" off in Settings, simply shows it. Sized, weighted and coloured by
 * `className`, like the plain number it replaces.
 *
 * Only changes roll: a figure appears showing its value, with no intro spin.
 * To have one appear fresh again, give it a new `key`.
 *
 * Only figures that can be seen roll. One scrolled out of view, or in a window
 * that's minimised or hidden, is drawn as plain text, so a turning knob isn't
 * running springs nobody is looking at. It picks the roll back up, without an
 * intro, once it's visible again.
 */
export function VolumeNumber({
  value,
  decimals,
  className,
}: {
  value: number
  /** Fixed decimal places; whole numbers when left out. */
  decimals?: number
  className?: string
}) {
  const animated = useSyncExternalStore(
    subscribeToSettings,
    readAnimatedNumbers,
    () => defaultSettingsConfig.appearance.animatedNumbers,
  )
  const pageVisible = useSyncExternalStore(
    subscribeToPageVisibility,
    () => document.visibilityState === "visible",
    () => true,
  )
  const ref = useRef<HTMLSpanElement | null>(null)
  // Assumed visible until told otherwise, so a figure that is on screen when it
  // appears doesn't start as plain text and swap a frame later.
  const [onScreen, setOnScreen] = useState(true)

  useEffect(() => {
    const element = ref.current

    if (!element || !animated) {
      return
    }

    return observeOnScreen(element, setOnScreen)
  }, [animated])

  return (
    <span ref={ref} className={className}>
      {animated && onScreen && pageVisible ? (
        <Counter
          value={value}
          decimals={decimals}
          duration={0.1}
          bounce={0.2}
          stagger={0.01}
          intro={false}
          fontSize="inherit"
        />
      ) : decimals === undefined ? (
        value
      ) : (
        value.toFixed(decimals)
      )}
    </span>
  )
}
