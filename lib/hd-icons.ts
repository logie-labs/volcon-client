"use client"

import { useEffect, useSyncExternalStore } from "react"

import { getIconHd } from "@/lib/bridge-client"
import { hasTauriRuntime } from "@/lib/tauri-runtime"

/**
 * Sharp copies of app icons, fetched once per executable and kept for the
 * session. The everyday icons are drawn small, which is fine in a list and soft
 * anywhere bigger; these are drawn at 128px from the largest image the file
 * holds.
 */

/** A path's icon once fetched: a data URL, or null when it has none to give. */
const icons = new Map<string, string | null>()
const requested = new Set<string>()
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function request(path: string) {
  if (requested.has(path) || !hasTauriRuntime()) {
    return
  }

  requested.add(path)

  void getIconHd(path)
    .catch(() => null)
    .then((icon) => {
      icons.set(path, icon)
      listeners.forEach((listener) => listener())
    })
}

/**
 * The sharp icon for `path`, or null until it arrives - or for good, if the
 * file has none, in which case the ordinary icon is the one to show.
 */
export function useHdIcon(path: string | null | undefined): string | null {
  const icon = useSyncExternalStore(
    subscribe,
    () => (path ? (icons.get(path) ?? null) : null),
    () => null
  )

  useEffect(() => {
    if (path) {
      request(path)
    }
  }, [path])

  return icon
}
