/**
 * What a notification was about, as data rather than words.
 *
 * The title and description say it in a sentence for the title bar. This is
 * the same event in full - the device that went, the control that moved, the
 * apps that were let go, the settings that changed - so the Notifications
 * screen can show what happened properly instead of a table of labels. It's
 * kept with the notification between launches, so it's all plain data: names
 * and numbers, never functions or icons.
 */

/** An app, enough to name it and to find its icon again later. */
export type EventApp = {
  /** The process name Volcon tracks it by, which its icon is found under. */
  app: string
  /** How it's shown. */
  name: string
}

/** One setting that went from one value to another, written the way Settings shows it. */
export type SettingChange = {
  label: string
  /** The Settings page it's on. */
  page: string
  before: string
  after: string
}

/** Somewhere a failure was trying to reach, offered to copy or retry. */
export type FailureTarget =
  | { kind: "url"; value: string }
  | { kind: "path"; value: string }
  | { kind: "file"; value: string }

export type NotificationEvent =
  /** A MIDI device appeared in the list of controllers, or left it. */
  | { type: "device"; change: "connected" | "disconnected"; device: string }
  /** A control was learned and became a mapping. */
  | {
      type: "control-learned"
      control: number
      device: string
      preset: string
      presetId: string
      mappingId?: string
      /** The preset already had a mapping for it, which learning just found again. */
      alreadyMapped?: boolean
    }
  /** Learning a control couldn't start, for want of one of the things it needs. */
  | {
      type: "learn-blocked"
      missing: "preset" | "controller" | "connection"
      preset?: string
      device?: string
    }
  /** Learning a control started, and then went wrong. */
  | { type: "learn-failed"; device: string; reason: string }
  /** A mapping was put on a different control by relearning it. */
  | {
      type: "control-moved"
      mapping: string
      mappingId: string
      preset: string
      from: number
      to: number
      /** The mapping that had that control before, now left without one. */
      displaced?: { name: string; id: string }
    }
  /** A mapping was deleted, and its apps handed back to Windows. */
  | { type: "mapping-deleted"; mapping: string; control: number; preset: string; apps: EventApp[] }
  /** A mapping was moved or copied to another preset. */
  | {
      type: "mapping-sent"
      mode: "move" | "copy"
      mapping: string
      control: number
      from: string
      to: string
      toId: string
      apps: EventApp[]
      /** What the other preset already called this control, if it had it. */
      mergedInto?: string
      /** The preset was made for it there and then. */
      newPreset?: boolean
    }
  | { type: "preset-created"; preset: string; presetId: string; device?: string }
  | {
      type: "preset-deleted"
      preset: string
      mappings: Array<{ name: string; control: number; apps: number }>
    }
  /** The active preset couldn't be handed to the backend. */
  | { type: "preset-apply-failed"; preset: string; reason: string }
  /** Moving a control should have set some apps' volume, and Windows said no. */
  | { type: "levels-failed"; control: number; mapping: string; apps: EventApp[]; reason: string }
  /**
   * Settings changed in bulk: a page reset, everything reset, a backup
   * imported - or one of those undone.
   */
  | {
      type: "settings-changed"
      how: "page-reset" | "reset" | "imported" | "undone"
      /** The page that was reset. */
      page?: string
      /** The backup that was imported. */
      file?: string
      /** For an undo, what it went back to before: "the Appearance page was reset". */
      undid?: string
      /** For an undo, how many settings changed since were left as they were. */
      kept?: number
      changes: SettingChange[]
    }
  /** A file was written, such as a settings backup. */
  | { type: "file-saved"; file: string; path: string }
  /** Diagnostic info, or anything else, put on the clipboard. */
  | {
      type: "copied"
      what: string
      /** What's in it, a line for each part. */
      contents: string[]
    }
  /** A newer version of Volcon has been released. */
  | {
      type: "update-available"
      installed: string
      latest: string
      /** Its release page, to download from. */
      url: string
      prerelease?: boolean
    }
  /** Something asked for didn't happen. */
  | {
      type: "action-failed"
      /** What was being done, as an instruction: "Open the log folder". */
      attempted: string
      reason: string
      /** What might put it right, where something can be said. */
      hint?: string
      target?: FailureTarget
    }

export type NotificationEventType = NotificationEvent["type"]

const eventTypes: ReadonlySet<string> = new Set<NotificationEventType>([
  "device",
  "control-learned",
  "learn-blocked",
  "learn-failed",
  "control-moved",
  "mapping-deleted",
  "mapping-sent",
  "preset-created",
  "preset-deleted",
  "preset-apply-failed",
  "levels-failed",
  "settings-changed",
  "file-saved",
  "copied",
  "update-available",
  "action-failed",
])

/**
 * Whether a value read back from storage is an event this version knows. One
 * written by a newer version, or mangled, is dropped and the notification is
 * shown without it.
 */
export function isNotificationEvent(value: unknown): value is NotificationEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string" &&
    eventTypes.has((value as { type: string }).type)
  )
}

/** Every name and value in an event, for search to look through. */
export function eventKeywords(event: NotificationEvent | undefined): string[] {
  const words: string[] = []

  const collect = (value: unknown) => {
    if (typeof value === "string") {
      words.push(value)
    } else if (typeof value === "number") {
      words.push(String(value))
    } else if (Array.isArray(value)) {
      value.forEach(collect)
    } else if (value && typeof value === "object") {
      Object.values(value).forEach(collect)
    }
  }

  collect(event)
  return words
}
