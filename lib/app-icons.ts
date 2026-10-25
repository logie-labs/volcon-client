"use client"

import { useEffect, useSyncExternalStore } from "react"

import { normalizeAppName } from "@/components/sections/mapping/preset-config"
import { getIconByPath } from "@/lib/bridge-client"
import { hasTauriRuntime } from "@/lib/tauri-runtime"

/**
 * Where each app lives, and the last icon it was seen with.
 *
 * An app's icon is read from its executable, wherever it was last seen running,
 * so it shows even while the app is closed and keeps up if the app changes its
 * icon. The last icon seen is kept alongside it for when that file can't be
 * read any more - the app was moved, updated into a new folder, uninstalled -
 * and is shown instead without a word: an old icon beats a blank square.
 *
 * Kept between launches, and shared by both windows through local storage. The
 * main window does the remembering, from the audio sessions it polls.
 */

type KnownApp = {
  /** Its executable, wherever it was last seen running. */
  path?: string
  /** The last icon it was seen with: a data URL. */
  icon?: string
  /** Its name as Windows gives it, without ".exe". */
  name?: string
  /** When it was last seen, for dropping the longest-unseen when there are too many. */
  seenAt?: number
}

/** Lookups over every app seen so far, as one value that changes when anything does. */
export type AppDirectory = {
  /**
   * The icon to show for `app`: read from its executable while that can still
   * be read, otherwise the last one it was seen with. `path` is somewhere else
   * it might be, such as where it was when it was assigned.
   */
  icon: (app: string, path?: string | null) => string | null
  /** Where its executable was last seen. */
  path: (app: string) => string | null
  /** Its name as Windows gives it. */
  name: (app: string) => string | null
}

const storageKey = "volcon.apps"
/** Where icons were kept before, read once to carry them over. */
const legacyStorageKey = "volcon.appCache"
/** Enough for every app anybody plays sound from, without growing forever. */
const MAX_APPS = 200

let known: Record<string, KnownApp> | null = null
/** Icons read from files this session, by path: a data URL, or null when it couldn't be read. */
const fileIcons = new Map<string, string | null>()
const requested = new Set<string>()
const listeners = new Set<() => void>()
let saveTimer: ReturnType<typeof setTimeout> | null = null

function basename(path: string) {
  return path.slice(Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/")) + 1)
}

/** Icons from before this store, keyed by name, display name and path all at once. */
function fromLegacyCache(raw: string) {
  const carried: Record<string, KnownApp> = {}
  const parsed = JSON.parse(raw) as {
    icons?: Record<string, unknown>
    names?: Record<string, unknown>
  }

  for (const [key, icon] of Object.entries(parsed?.icons ?? {})) {
    if (typeof icon !== "string" || !icon) {
      continue
    }

    const isPath = key.includes("\\") || key.includes("/")
    const app = normalizeAppName(isPath ? basename(key) : key)
    const entry = (carried[app] ??= {})
    entry.icon ??= icon

    if (isPath) {
      entry.path ??= key
    }
  }

  for (const [app, name] of Object.entries(parsed?.names ?? {})) {
    if (typeof name === "string" && name) {
      ;(carried[normalizeAppName(app)] ??= {}).name = name
    }
  }

  return carried
}

function load(): Record<string, KnownApp> {
  if (known) {
    return known
  }

  known = {}

  if (typeof window === "undefined") {
    return known
  }

  try {
    const raw = window.localStorage.getItem(storageKey)

    if (raw) {
      const parsed: unknown = JSON.parse(raw)

      if (parsed && typeof parsed === "object") {
        known = parsed as Record<string, KnownApp>
      }
    } else {
      const legacy = window.localStorage.getItem(legacyStorageKey)

      if (legacy) {
        known = fromLegacyCache(legacy)
        persist()
        window.localStorage.removeItem(legacyStorageKey)
      }
    }
  } catch {
    // Unreadable or blocked storage: icons are found again as apps are seen.
  }

  return known
}

function persist() {
  if (typeof window === "undefined") {
    return
  }

  if (saveTimer) {
    clearTimeout(saveTimer)
  }

  saveTimer = setTimeout(() => {
    saveTimer = null
    const apps = load()
    const keys = Object.keys(apps)

    if (keys.length > MAX_APPS) {
      keys
        .sort((left, right) => (apps[left].seenAt ?? 0) - (apps[right].seenAt ?? 0))
        .slice(0, keys.length - MAX_APPS)
        .forEach((key) => delete apps[key])
    }

    try {
      window.localStorage.setItem(storageKey, JSON.stringify(apps))
    } catch {
      // Full or blocked storage: what's known still works for this session.
    }
  }, 1000)
}

function iconFor(app: string, path?: string | null) {
  const entry = load()[normalizeAppName(app)]

  for (const candidate of [entry?.path, path]) {
    const icon = candidate ? fileIcons.get(candidate) : undefined

    if (icon) {
      return icon
    }
  }

  return entry?.icon ?? null
}

function makeDirectory(): AppDirectory {
  return {
    icon: iconFor,
    path: (app) => load()[normalizeAppName(app)]?.path ?? null,
    name: (app) => load()[normalizeAppName(app)]?.name ?? null,
  }
}

let directory = makeDirectory()
let announceTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Tells everything reading the directory, shortly: icons read at launch arrive
 * one after another, and a screen full of them should re-render once, not once
 * for each.
 */
function announce() {
  if (announceTimer) {
    return
  }

  announceTimer = setTimeout(() => {
    announceTimer = null
    directory = makeDirectory()
    listeners.forEach((listener) => listener())
  }, 50)
}

/** A save in the other window: the overlay picks up what the main window has learned. */
function onStorage(event: StorageEvent) {
  if (event.key === storageKey) {
    known = null
    announce()
  }
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) {
    window.addEventListener("storage", onStorage)
  }

  listeners.add(listener)

  return () => {
    listeners.delete(listener)

    if (listeners.size === 0) {
      window.removeEventListener("storage", onStorage)
    }
  }
}

/**
 * Notes where apps are and how they look, from processes seen running. Cheap to
 * call on every poll: nothing is announced or saved unless something changed.
 */
export function rememberApps(
  seen: ReadonlyArray<{ name: string; executable_path?: string | null; icon?: string | null }>
) {
  const apps = load()
  const now = Date.now()
  let changed = false

  for (const process of seen) {
    const key = normalizeAppName(process.executable_path ? basename(process.executable_path) : process.name)

    if (!key) {
      continue
    }

    const entry = (apps[key] ??= {})
    const name = process.name.replace(/\.exe$/i, "")
    let learned = false

    if (process.executable_path && entry.path !== process.executable_path) {
      entry.path = process.executable_path
      learned = true
    }

    if (process.icon && entry.icon !== process.icon) {
      entry.icon = process.icon
      learned = true
    }

    if (name && entry.name !== name) {
      entry.name = name
      learned = true
    }

    // Seen again with nothing new: only worth a save once an hour.
    if (learned || now - (entry.seenAt ?? 0) > 3_600_000) {
      entry.seenAt = now
      changed = true
    }
  }

  if (changed) {
    persist()
    announce()
  }
}

/**
 * Reads the icons of `apps` from their executables, once each per session: from
 * where each was last seen running, and from `path` if given. A file that can't
 * be read leaves the app on its last icon, quietly.
 */
export function requestAppIcons(apps: ReadonlyArray<{ app: string; path?: string | null }>) {
  if (!hasTauriRuntime()) {
    return
  }

  for (const { app, path } of apps) {
    const key = normalizeAppName(app)

    for (const candidate of [load()[key]?.path, path]) {
      if (!candidate || requested.has(candidate)) {
        continue
      }

      requested.add(candidate)

      void getIconByPath(candidate)
        .catch(() => null)
        .then((icon) => {
          fileIcons.set(candidate, icon ?? null)

          if (icon) {
            // The newest icon there is: kept for the day this file goes.
            const entry = (load()[key] ??= {})
            entry.icon = icon
            entry.path ??= candidate
            persist()
          }

          announce()
        })
    }
  }
}

/**
 * Every app seen so far, re-rendering whatever reads it when anything is
 * learned: a new location, a fresher icon, an icon read from a file.
 */
export function useAppDirectory(): AppDirectory {
  return useSyncExternalStore(subscribe, () => directory, () => directory)
}

/** One app's icon, read from its executable where possible, else its last one. */
export function useAppIcon(app: string | null | undefined, path?: string | null): string | null {
  const apps = useAppDirectory()

  useEffect(() => {
    if (app) {
      requestAppIcons([{ app, path }])
    }
  }, [app, path])

  return app ? apps.icon(app, path) : null
}
