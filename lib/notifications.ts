"use client"

import { useSyncExternalStore } from "react"

import {
  getSettingsSnapshot,
  subscribeToSettings,
} from "@/components/sections/settings/settings-config"
import { isNotificationEvent, type NotificationEvent } from "@/lib/notification-events"

/**
 * Everything the app has told you, and the one line of it showing right now.
 *
 * Raising a notification does two things: it puts a line in the title bar for a
 * few seconds, and it writes the message down. The title bar is a glance - if
 * you were looking at something else when it went past, the Notifications
 * screen still has it, in full, with the detail one line had no room for.
 *
 * Three readers, one record:
 *
 * - the title bar takes `useCurrentNotification`, the newest one while fresh;
 * - the Notifications screen takes `useNotifications`, all of them;
 * - the sidebar takes `useUnreadCount`, how many arrived while you were away.
 *
 * The log is kept between launches, so something that went wrong just before
 * the window was closed is still there to read when it opens again.
 */

export type NotificationKind = "success" | "error" | "warning" | "info"

/**
 * The part of the app a notification came from. Used to filter the log and to
 * say where something happened, so "Couldn't apply the preset" reads as a
 * preset problem rather than a mystery.
 */
export type NotificationSource =
  | "mapping"
  | "presets"
  | "controller"
  | "audio"
  | "settings"
  | "app"

export const notificationSourceLabels: Record<NotificationSource, string> = {
  mapping: "Mapping",
  presets: "Presets",
  controller: "Controller",
  audio: "Audio",
  settings: "Settings",
  app: "App",
}

export type NotificationAction = {
  label: string
  onClick: () => void
}

/** How an Undo went: things put back, or not - cancelled, or no longer possible. */
export type UndoOutcome =
  | {
      done: true
      /** Said in the title bar once it's done: "Appearance settings put back". */
      title: string
      description?: string
      event?: NotificationEvent
    }
  | {
      done: false
      /** Why it couldn't be done, when it wasn't simply cancelled. */
      reason?: string
    }

/**
 * Puts back what a notification is about. May ask first, which is why it can
 * take a while to answer.
 */
export type NotificationUndo = () => UndoOutcome | Promise<UndoOutcome>

/** One labelled fact about a notification, such as `Preset: Gaming`. */
export type NotificationField = {
  label: string
  value: string
}

export type NotificationOptions = {
  /** The second line, where there is room for one. */
  description?: string
  /**
   * The long version, for the Notifications screen rather than the title bar.
   * Never truncated where it's shown: an error message from the backend, or
   * the reason something couldn't be done, belongs here.
   */
  detail?: string
  /** Where in the app it happened. Defaults to `app`. */
  source?: NotificationSource
  /**
   * Labelled facts - which preset, which control, which app - so a message can
   * stay short and still be specific. Searched, copied, and shown as a table
   * for a notification with no `event` to show instead.
   */
  fields?: NotificationField[]
  /**
   * What happened, as data: the Notifications screen shows each kind of event
   * its own way, from the device that went to the settings that changed.
   */
  event?: NotificationEvent
  /**
   * Puts it back. Offered as Undo in the title bar and on the Notifications
   * screen until it's used - once - or until Volcon closes.
   */
  undo?: NotificationUndo
  /** The one thing to do about it, offered in the title bar as well. */
  action?: NotificationAction
  /** Anything else that can be done, offered on the Notifications screen only. */
  actions?: NotificationAction[]
  /** Milliseconds in the title bar. Defaults by kind - see `lifetimeFor`. */
  duration?: number
  /**
   * Marks notifications as the same message even where their wording differs,
   * such as one failure with a different error each time. The same message in
   * a row can be grouped on the Notifications screen, and isn't written down
   * again while it's still repeating - see `BURST_MS`. Without a key, the same
   * kind, title and description make the same message.
   */
  key?: string
  /** Write it down without putting it in the title bar. */
  silent?: boolean
}

export type Notification = {
  id: number
  kind: NotificationKind
  title: string
  description?: string
  detail?: string
  source: NotificationSource
  fields: NotificationField[]
  event?: NotificationEvent
  /** While it can still be undone. Not kept between launches. */
  undo?: NotificationUndo
  /** When it was undone, if it has been. */
  undoneAt?: number
  /** The title bar's action first, then the rest. Not kept between launches. */
  actions: NotificationAction[]
  duration: number
  /** Epoch milliseconds of when it was raised. */
  at: number
  key?: string
  read: boolean
}

/**
 * What makes two notifications the same message: their key if they have one,
 * otherwise their kind, title and description.
 */
export function notificationIdentity(
  entry: Pick<Notification, "kind" | "title" | "description" | "key">
) {
  return entry.key !== undefined
    ? `key:${entry.key}`
    : `${entry.kind}:${entry.title}:${entry.description ?? ""}`
}

/**
 * How long each kind stays in the title bar. Failures last longest because
 * they're the ones worth reading twice; a success confirms something you just
 * did, so it only has to be noticed.
 */
function lifetimeFor(kind: NotificationKind) {
  switch (kind) {
    case "error":
      return 6000
    case "warning":
      return 5000
    default:
      return 3500
  }
}

/** How the person has asked to be told things, from Settings > Notifications. */
function preferences() {
  return getSettingsSnapshot().notifications
}

/**
 * How long a message of `kind` stays in the title bar, in milliseconds, when an
 * ordinary one stays for `displayTimeMs` - the display time in Settings. Every
 * kind is scaled together, so failures still stay longest.
 */
export function displayDuration(displayTimeMs: number, kind: NotificationKind = "info") {
  return (displayTimeMs * lifetimeFor(kind)) / lifetimeFor("info")
}

/** How serious each kind is, for the title bar's "warnings and errors" filters. */
const kindSeverity: Record<NotificationKind, number> = {
  info: 0,
  success: 0,
  warning: 1,
  error: 2,
}

const levelSeverity = { all: 0, warnings: 1, errors: 2 } as const

/** Whether a message of this kind gets a line in the title bar. */
function showsInTitleBar(kind: NotificationKind) {
  const { titleBar, titleBarLevel } = preferences()
  return titleBar && kindSeverity[kind] >= levelSeverity[titleBarLevel]
}

/**
 * The same message raised again this soon after the last time is a burst - a
 * failure repeating on every pointer move of a drag, say - and isn't written
 * down again. The window slides: a burst is one entry however long it lasts,
 * and the title bar keeps showing it until it stops.
 */
const BURST_MS = 1000

/** When each message was last raised, for telling a burst from a new event. */
const lastRaised = new Map<string, number>()

const storageKey = "volcon.notifications"

let nextId = 1
/** Newest first, which is the order the screen reads in. */
let log: Notification[] = []
let current: Notification | null = null
let timer: ReturnType<typeof setTimeout> | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
let restored = false
const listeners = new Set<() => void>()

function isKind(value: unknown): value is NotificationKind {
  return (
    value === "success" ||
    value === "error" ||
    value === "warning" ||
    value === "info"
  )
}

function isSource(value: unknown): value is NotificationSource {
  return typeof value === "string" && value in notificationSourceLabels
}

/**
 * The event behind a notification written before events were kept, where its
 * key says plainly what it was: so a device coming and going that's already in
 * the log reads the same as one that happens now.
 */
function eventFromKey(key: unknown): NotificationEvent | undefined {
  const match = typeof key === "string" ? /^midi-(connected|disconnected):(.+)$/.exec(key) : null

  return match
    ? { type: "device", change: match[1] as "connected" | "disconnected", device: match[2] }
    : undefined
}

/**
 * Reads back the log from the last launch, once, the first time anything asks.
 * Actions are functions and don't survive the trip, so restored entries have
 * none - the message and its detail are what's worth keeping.
 */
function restore() {
  if (restored || typeof window === "undefined") {
    return
  }

  restored = true

  // History off means each launch starts clean, and nothing from before is kept.
  if (!preferences().keepHistory) {
    try {
      window.localStorage.removeItem(storageKey)
    } catch {
      // Blocked storage: there's nothing to read back either way.
    }
    return
  }

  try {
    const raw = window.localStorage.getItem(storageKey)
    const parsed: unknown = raw ? JSON.parse(raw) : []

    if (!Array.isArray(parsed)) {
      return
    }

    log = parsed
      .filter(
        (entry): entry is Notification =>
          typeof entry === "object" &&
          entry !== null &&
          typeof entry.id === "number" &&
          typeof entry.title === "string" &&
          typeof entry.at === "number" &&
          isKind(entry.kind)
      )
      .slice(0, preferences().historyLimit)
      // Built field by field, so whatever older versions stored alongside -
      // repeats folded into a count, say - is left behind.
      .map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        title: entry.title,
        description: typeof entry.description === "string" ? entry.description : undefined,
        detail: typeof entry.detail === "string" ? entry.detail : undefined,
        source: isSource(entry.source) ? entry.source : "app",
        fields: Array.isArray(entry.fields) ? entry.fields : [],
        event: isNotificationEvent(entry.event) ? entry.event : eventFromKey(entry.key),
        undoneAt: typeof entry.undoneAt === "number" ? entry.undoneAt : undefined,
        actions: [],
        duration: typeof entry.duration === "number" ? entry.duration : lifetimeFor(entry.kind),
        at: entry.at,
        key: typeof entry.key === "string" ? entry.key : undefined,
        read: entry.read === true,
      }))

    nextId = log.reduce((highest, entry) => Math.max(highest, entry.id), 0) + 1
  } catch {
    // Unreadable or blocked storage: start with an empty log.
  }
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

    try {
      if (!preferences().keepHistory) {
        window.localStorage.removeItem(storageKey)
        return
      }

      // Actions and undos are functions, which JSON can't keep - dropped here
      // so what's stored is only what can be read back.
      window.localStorage.setItem(
        storageKey,
        JSON.stringify(log, (key, value) => (key === "actions" || key === "undo" ? undefined : value))
      )
    } catch {
      // Full or blocked storage: the log still works for this session.
    }
  }, 250)
}

function announce() {
  persist()

  for (const listener of listeners) {
    listener()
  }
}

function clearTimer() {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
}

/** Takes the current message down after its time in the title bar. */
function scheduleHide(duration: number) {
  clearTimer()

  timer = setTimeout(() => {
    timer = null
    current = null
    announce()
  }, duration)
}

function raise(
  kind: NotificationKind,
  title: string,
  options: NotificationOptions = {}
) {
  restore()

  const now = Date.now()
  const identity = notificationIdentity({ kind, title, description: options.description, key: options.key })
  const previous = lastRaised.get(identity)
  lastRaised.set(identity, now)

  // Only recent ones matter, so the record doesn't grow for the whole session.
  if (lastRaised.size > 100) {
    for (const [seen, at] of lastRaised) {
      if (now - at >= BURST_MS) {
        lastRaised.delete(seen)
      }
    }
  }

  // Still repeating: the burst is already written down. If it's the line in
  // the title bar, it stays up until the repeats stop.
  if (previous !== undefined && now - previous < BURST_MS) {
    const latest = log.find((entry) => notificationIdentity(entry) === identity)

    if (latest) {
      if (current === latest) {
        scheduleHide(latest.duration)
      }

      return latest.id
    }
  }

  const shown = !options.silent && showsInTitleBar(kind)
  const entry: Notification = {
    id: nextId++,
    kind,
    title,
    description: options.description,
    detail: options.detail,
    source: options.source ?? "app",
    fields: options.fields ?? [],
    event: options.event,
    undo: options.undo,
    actions: [
      ...(options.action ? [options.action] : []),
      ...(options.actions ?? []),
    ],
    duration: options.duration ?? displayDuration(preferences().displayTimeMs, kind),
    at: now,
    key: options.key,
    read: false,
  }

  // Every time is its own entry; the Notifications screen can group the same
  // message in a row, if asked to.
  log = [entry, ...log].slice(0, preferences().historyLimit)

  if (!shown) {
    announce()
    return entry.id
  }

  // Straight over whatever was in the bar. The bar crossfades the swap, so it
  // reads as the line being updated, and the one it replaces is in the log.
  current = entry
  scheduleHide(entry.duration)
  announce()

  return entry.id
}

// A change in Settings applies at once: a smaller history drops the oldest, a
// title bar turned off clears its line, and keeping history on or off writes
// or removes the stored copy.
if (typeof window !== "undefined") {
  subscribeToSettings(() => {
    if (!restored) {
      return
    }

    const { historyLimit } = preferences()

    if (log.length > historyLimit) {
      log = log.slice(0, historyLimit)
    }

    if (current && !showsInTitleBar(current.kind)) {
      clearTimer()
      current = null
    }

    announce()
  })
}

/** Put the current message away early. It stays in the log. */
export function dismissCurrentNotification() {
  clearTimer()

  if (current) {
    current = null
    announce()
  }
}

/** Raise a notification of any kind. */
export function notify(
  kind: NotificationKind,
  title: string,
  options?: NotificationOptions
) {
  return raise(kind, title, options)
}

/** The familiar four, for call sites that already know which kind they are. */
export const toast = {
  success: (title: string, options?: NotificationOptions) =>
    raise("success", title, options),
  error: (title: string, options?: NotificationOptions) =>
    raise("error", title, options),
  warning: (title: string, options?: NotificationOptions) =>
    raise("warning", title, options),
  info: (title: string, options?: NotificationOptions) =>
    raise("info", title, options),
  dismiss: dismissCurrentNotification,
}

/** Undos asked for and not answered yet - one waiting on a question, say. */
const undoing = new Set<number>()

/**
 * Undoes what a notification is about, if it still can be, and says how that
 * went: a line in the title bar either way, since an Undo pressed on the
 * Notifications screen changes things on another screen, out of sight. Each can
 * only be used once.
 */
export async function undoNotification(id: number) {
  restore()

  const entry = log.find((candidate) => candidate.id === id)
  const undo = entry?.undo

  if (!entry || !undo || undoing.has(id)) {
    return
  }

  undoing.add(id)

  try {
    const outcome = await undo()

    if (outcome.done) {
      log = log.map((candidate) =>
        candidate.id === id ? { ...candidate, undo: undefined, undoneAt: Date.now() } : candidate
      )

      // The offer to undo it is spent, so it leaves the title bar too.
      if (current?.id === id) {
        clearTimer()
        current = null
      }

      announce()
      raise("success", outcome.title, {
        source: entry.source,
        description: outcome.description,
        event: outcome.event,
      })
    } else if (outcome.reason) {
      raise("warning", `Couldn't undo: ${entry.title}`, {
        source: entry.source,
        description: outcome.reason,
      })
    }
  } finally {
    undoing.delete(id)
  }
}

/** Everything is read. Called while the Notifications screen is looked at. */
export function markNotificationsRead() {
  restore()

  if (!log.some((entry) => !entry.read)) {
    return
  }

  log = log.map((entry) => (entry.read ? entry : { ...entry, read: true }))
  announce()
}

/** Throw the log away. The one in the title bar is left to finish. */
export function clearNotifications() {
  restore()

  if (log.length === 0) {
    return
  }

  log = []
  announce()
}

/**
 * Drop the ones named, and nothing else. The title bar is left alone even if
 * it's showing one of these: it's about to go on its own, and snatching it
 * mid-sentence because a list behind it was tidied is the worse surprise.
 */
export function removeNotifications(ids: Iterable<number>) {
  restore()

  const dropping = new Set(ids)

  if (dropping.size === 0) {
    return
  }

  log = log.filter((entry) => !dropping.has(entry.id))
  announce()
}

function subscribe(listener: () => void) {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

const EMPTY: readonly Notification[] = []

function getLog() {
  restore()
  return log
}

/** The whole log, newest first, read once - for code outside React. */
export function getNotifications(): readonly Notification[] {
  return getLog()
}

/**
 * The whole log, newest first. The array is replaced rather than mutated on
 * every change, so it's a stable reference between changes.
 */
export function useNotifications(): readonly Notification[] {
  return useSyncExternalStore(subscribe, getLog, () => EMPTY)
}

/** The one in the title bar, or null. */
export function useCurrentNotification(): Notification | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null
  )
}

/** How many there are, read or not. */
export function useNotificationCount(): number {
  return useSyncExternalStore(
    subscribe,
    () => getLog().length,
    () => 0
  )
}

/** How many arrived while you were looking at something else. */
export function useUnreadCount(): number {
  return useSyncExternalStore(
    subscribe,
    () => getLog().reduce((total, entry) => total + (entry.read ? 0 : 1), 0),
    () => 0
  )
}

/** "just now", "4m ago", "2h ago", "3d ago" - short enough for a list. */
export function describeAge(at: number, now = Date.now()) {
  const seconds = Math.max(0, Math.round((now - at) / 1000))

  if (seconds < 45) {
    return "just now"
  }

  const minutes = Math.round(seconds / 60)

  if (minutes < 60) {
    return `${minutes}m ago`
  }

  const hours = Math.round(minutes / 60)

  if (hours < 24) {
    return `${hours}h ago`
  }

  return `${Math.round(hours / 24)}d ago`
}

/** The full date and time, for when "2h ago" isn't precise enough. */
export function describeTimestamp(at: number) {
  return new Date(at).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  })
}
