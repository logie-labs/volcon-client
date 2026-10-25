"use client"

import { useEffect, useState, type Dispatch, type SetStateAction } from "react"

/**
 * What a screen was showing - a switch flipped, a filter, a search, the page
 * or mapping it was on - kept for as long as Volcon is open. Screens come and
 * go as you move between them, and each would otherwise start over every time,
 * so switching away and back finds a screen as it was left.
 *
 * Only for this run of the app: what should outlast a restart is a setting.
 * Kept in memory alone, so the first render of a screen always matches what
 * the page was prerendered with.
 */

const kept = new Map<string, unknown>()

/** The value kept under `key`, or undefined if nothing has been yet. */
export function sessionValue<T>(key: string): T | undefined {
  return kept.get(key) as T | undefined
}

export function setSessionValue(key: string, value: unknown) {
  kept.set(key, value)
}

/**
 * `useState`, kept under `key` between visits: it starts from whatever it was
 * when the screen was last left, and from `initial` the first time.
 */
export function useSessionState<T>(
  key: string,
  initial: T | (() => T)
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() =>
    kept.has(key)
      ? (kept.get(key) as T)
      : typeof initial === "function"
        ? (initial as () => T)()
        : initial
  )

  useEffect(() => {
    kept.set(key, value)
  }, [key, value])

  return [value, setValue]
}
