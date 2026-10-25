import {
  defaultSettingsConfig,
  type SettingsConfig,
} from "./settings-config"

/**
 * Every page and every setting in Settings, described once. The pages read
 * their labels and descriptions from here, search looks through it, and the
 * resets - one setting, one page - work from the paths it names, so a setting
 * can't be shown under one name and found under another.
 */

export type SettingsSectionId =
  | "appearance"
  | "startup"
  | "navigation"
  | "overlay"
  | "mapping"
  | "notifications"
  | "controller"
  | "diagnostics"
  | "backup"
  | "updates"
  | "about"

export type SettingsGroupId = "general" | "sections" | "devices" | "advanced"

export type SettingsPageInfo = {
  id: SettingsSectionId
  group: SettingsGroupId
  title: string
  description: string
}

export const settingsGroupTitles: Record<SettingsGroupId, string> = {
  general: "General",
  // A page for each screen in the app's own sidebar, in the same order.
  sections: "Sections",
  devices: "Devices",
  advanced: "Advanced",
}

export const settingsPages: SettingsPageInfo[] = [
  {
    id: "appearance",
    group: "general",
    title: "Appearance",
    description: "The colour theme, and whether figures animate when they change.",
  },
  {
    id: "startup",
    group: "general",
    title: "Startup",
    description: "Whether Volcon starts with Windows, and how it opens.",
  },
  {
    id: "navigation",
    group: "general",
    title: "Navigation",
    description:
      "Going back to where you were, and forward again, with the mouse's side buttons or the keyboard.",
  },
  {
    id: "overlay",
    group: "general",
    title: "Overlay",
    description:
      "The volume popup that appears while you turn a control: which corner it uses and how long it stays.",
  },
  {
    id: "mapping",
    group: "sections",
    title: "Mapping",
    description:
      "How the Mapping screen behaves when you take an app off a control, and its live level meters.",
  },
  {
    id: "notifications",
    group: "sections",
    title: "Notifications",
    description:
      "Which messages reach the title bar, the sidebar's unread dot, and how much history is kept.",
  },
  {
    id: "controller",
    group: "devices",
    title: "Controller",
    description: "How the position of a knob or fader becomes a volume level.",
  },
  {
    id: "diagnostics",
    group: "advanced",
    title: "Diagnostics",
    description: "What Volcon writes to its log, and what to send along with a bug report.",
  },
  {
    id: "backup",
    group: "advanced",
    title: "Backup & reset",
    description: "Save your settings to a file, bring them back, or start over from the defaults.",
  },
  {
    id: "updates",
    group: "advanced",
    title: "Updates",
    description: "Whether there's a newer version of Volcon, and what's new in it.",
  },
  {
    id: "about",
    group: "advanced",
    title: "About",
    description: "Which version is installed, what it runs on, and where to find out more.",
  },
]

export const settingsPageMap = Object.fromEntries(
  settingsPages.map((page) => [page.id, page])
) as Record<SettingsSectionId, SettingsPageInfo>

export function isSettingsSectionId(value: string | null): value is SettingsSectionId {
  return value !== null && value in settingsPageMap
}

/** Every setting's address in the config, such as `overlay.position`. */
type Leaves<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends Record<string, unknown>
    ? Leaves<T[K], `${Prefix}${K}.`>
    : `${Prefix}${K}`
}[keyof T & string]

export type SettingPath = Exclude<Leaves<SettingsConfig>, "schemaVersion">

type PathValue<T, P extends string> = P extends `${infer Key}.${infer Rest}`
  ? Key extends keyof T
    ? PathValue<T[Key], Rest>
    : never
  : P extends keyof T
    ? T[P]
    : never

export type SettingValue<P extends SettingPath> = PathValue<SettingsConfig, P>

export type SettingEntry = {
  /** The setting's path where it has one; otherwise a name for the action. */
  id: string
  page: SettingsSectionId
  /** The heading it sits under on its page. */
  group: string
  label: string
  description: string
  /** Other words someone might search for it by. */
  keywords?: string[]
  /** Where its value lives, for settings that have one. Actions don't. */
  path?: SettingPath
}

export const settingEntries: SettingEntry[] = [
  // Appearance
  {
    id: "appearance.theme",
    path: "appearance.theme",
    page: "appearance",
    group: "Theme",
    label: "Theme",
    description: "Light, dark, or whichever Windows is using.",
    keywords: ["dark", "light", "mode", "colour", "color", "system"],
  },
  {
    id: "appearance.animatedNumbers",
    path: "appearance.animatedNumbers",
    page: "appearance",
    group: "Motion",
    label: "Animated numbers",
    description: "Volume figures roll to each new value. Off, they change instantly.",
    keywords: ["animation", "roll", "motion", "reduce", "figures"],
  },
  {
    id: "appearance.sidebarTooltips",
    path: "appearance.sidebarTooltips",
    page: "appearance",
    group: "Sidebar",
    label: "Sidebar tooltips",
    description: "Name each screen when the pointer rests on its button in the sidebar.",
    keywords: ["tooltip", "hover", "label", "names", "icons", "hint"],
  },
  {
    id: "appearance.toolbarReadout",
    path: "appearance.toolbarReadout",
    page: "appearance",
    group: "Title bar",
    label: "Level in the title bar",
    description: "On a mapping's screen, show its name and live level in the middle of the title bar.",
    keywords: ["toolbar", "volume", "percent", "level", "indicator", "header", "readout"],
  },

  // Startup
  {
    id: "startup.launchOnStartup",
    path: "startup.launchOnStartup",
    page: "startup",
    group: "Launch",
    label: "Launch with Windows",
    description: "Start Volcon when you sign in to Windows.",
    keywords: ["autostart", "boot", "login", "sign in", "startup"],
  },
  {
    id: "startup.openToTray",
    path: "startup.openToTray",
    page: "startup",
    group: "Launch",
    label: "Start in the tray",
    description:
      "Open hidden in the notification area instead of showing the window. Applies from the next launch.",
    keywords: ["hidden", "minimised", "minimized", "background", "tray"],
  },
  {
    id: "startup.reopenLastSection",
    path: "startup.reopenLastSection",
    page: "startup",
    group: "Window",
    label: "Reopen where you left off",
    description: "Open on the screen and settings page you last had open.",
    keywords: ["restore", "remember", "last", "screen", "section"],
  },

  // Overlay: the first switch is the page's own, above everything else.
  {
    id: "overlay.enabled",
    path: "overlay.enabled",
    page: "overlay",
    group: "Overlay",
    label: "Show the overlay",
    description:
      "Pop up the volume overlay while you turn a control. Off, nothing appears on screen when a control moves.",
    keywords: ["hud", "popup", "osd", "on screen", "disable", "hide"],
  },
  {
    id: "overlay.position",
    path: "overlay.position",
    page: "overlay",
    group: "Placement",
    label: "Corner",
    description: "Which corner of the screen the overlay appears in.",
    keywords: ["position", "top", "bottom", "left", "right", "hud", "popup"],
  },
  {
    id: "overlay.avoidTaskbar",
    path: "overlay.avoidTaskbar",
    page: "overlay",
    group: "Placement",
    label: "Keep clear of the taskbar",
    description: "Place the overlay inside the part of the screen the taskbar doesn't cover.",
    keywords: ["work area", "taskbar", "overlap"],
  },
  {
    id: "overlay.edgeMargin",
    path: "overlay.edgeMargin",
    page: "overlay",
    group: "Placement",
    label: "Distance from the edge",
    description: "How far the overlay sits in from the edges of the screen.",
    keywords: ["margin", "padding", "inset", "offset", "edge"],
  },
  {
    id: "overlay.scale",
    path: "overlay.scale",
    page: "overlay",
    group: "Size",
    label: "Scale",
    description: "How big the overlay is drawn. Only its size changes; where it sits and the space around it stay as they are.",
    keywords: ["size", "zoom", "bigger", "smaller", "larger"],
  },
  {
    id: "overlay.maxCards",
    path: "overlay.maxCards",
    page: "overlay",
    group: "Stacking",
    label: "Most at once",
    description:
      "How many controls the overlay shows at a time, stacked. Another moved while they're all up takes the place of the one left alone longest.",
    keywords: ["maximum", "limit", "multiple", "stack", "several", "count"],
  },
  {
    id: "overlay.cardGap",
    path: "overlay.cardGap",
    page: "overlay",
    group: "Stacking",
    label: "Spacing",
    description: "The gap between overlays when more than one is up.",
    keywords: ["gap", "space", "between", "stack"],
  },
  {
    id: "overlay.fadeDelayMs",
    path: "overlay.fadeDelayMs",
    page: "overlay",
    group: "Timing",
    label: "Fade after",
    description: "How long the overlay stays after the last change before it fades out.",
    keywords: ["delay", "timeout", "duration", "hide", "seconds"],
  },
  {
    id: "overlay.hoverOpacity",
    path: "overlay.hoverOpacity",
    page: "overlay",
    group: "Hover",
    label: "Opacity on hover",
    description:
      "How see-through the overlay turns while the mouse is over it, so whatever it covers can still be read.",
    keywords: ["transparency", "transparent", "see-through", "fade", "mouse", "hover"],
  },
  {
    id: "overlay.preview",
    page: "overlay",
    group: "Preview",
    label: "Preview",
    description: "Raise the overlay now to check where it appears and how long it stays.",
    keywords: ["test", "preview", "try", "show"],
  },

  // Navigation
  {
    id: "navigation.mouseButtons",
    path: "navigation.mouseButtons",
    page: "navigation",
    group: "Back and forward",
    label: "Mouse buttons",
    description:
      "The back and forward buttons on the side of a mouse step through the screens and pages you've been to. Off, they do nothing here.",
    keywords: ["mouse", "side buttons", "back", "forward", "history", "previous"],
  },
  {
    id: "navigation.altArrows",
    path: "navigation.altArrows",
    page: "navigation",
    group: "Back and forward",
    label: "Alt and arrow keys",
    description: "Alt+Left goes back and Alt+Right goes forward, the same as the mouse buttons.",
    keywords: ["keyboard", "shortcut", "alt", "arrow", "back", "forward"],
  },

  // Mapping
  {
    id: "mapping.confirmRemoveApp",
    path: "mapping.confirmRemoveApp",
    page: "mapping",
    group: "Removing apps",
    label: "Confirm before removing",
    description:
      "Ask before taking an app off a control. Ticking Don't ask again in that dialog turns this off.",
    keywords: ["delete", "remove", "unassign", "dialog", "ask", "prompt"],
  },
  {
    id: "mapping.levelMeters",
    path: "mapping.levelMeters",
    page: "mapping",
    group: "Level meters",
    label: "Show level meters",
    description:
      "Live left and right audio levels beside each assigned app. Off, nothing is measured at all.",
    keywords: ["audio", "meter", "peak", "vu", "channels", "levels"],
  },

  // Notifications
  {
    id: "notifications.titleBar",
    path: "notifications.titleBar",
    page: "notifications",
    group: "Title bar",
    label: "Show in title bar",
    description:
      "Show each message in the title bar as it happens. Off, they're only kept on the Notifications screen.",
    keywords: ["toast", "popup", "banner", "message"],
  },
  {
    id: "notifications.titleBarLevel",
    path: "notifications.titleBarLevel",
    page: "notifications",
    group: "Title bar",
    label: "Title bar shows",
    description: "The least serious messages that still get shown. Everything is logged either way.",
    keywords: ["level", "severity", "errors", "warnings", "filter"],
  },
  {
    id: "notifications.displayTimeMs",
    path: "notifications.displayTimeMs",
    page: "notifications",
    group: "Title bar",
    label: "Display time",
    description: "How long a message stays in the title bar. Errors always stay longest.",
    keywords: ["duration", "timeout", "seconds"],
  },
  {
    id: "notifications.unreadBadge",
    path: "notifications.unreadBadge",
    page: "notifications",
    group: "Sidebar",
    label: "Unread badge",
    description: "A dot on the bell when something arrives while you're on another screen.",
    keywords: ["dot", "bell", "badge", "unread", "indicator"],
  },
  {
    id: "notifications.keepHistory",
    path: "notifications.keepHistory",
    page: "notifications",
    group: "History",
    label: "Keep between launches",
    description:
      "Remember notifications after Volcon closes. Off, each launch starts with an empty log.",
    keywords: ["persist", "save", "history", "log"],
  },
  {
    id: "notifications.historyLimit",
    path: "notifications.historyLimit",
    page: "notifications",
    group: "History",
    label: "History size",
    description: "How many notifications are kept before the oldest are dropped.",
    keywords: ["limit", "count", "maximum"],
  },
  {
    id: "notifications.groupRepeats",
    path: "notifications.groupRepeats",
    page: "notifications",
    group: "History",
    label: "Group notifications",
    description:
      "Show the same notification several times in a row as one entry with a count, which opens to list each one. The Notifications screen has its own switch too.",
    keywords: ["group", "stack", "collapse", "repeat", "duplicate", "count"],
  },
  {
    id: "notifications.clear",
    page: "notifications",
    group: "History",
    label: "Clear history",
    description: "Remove every notification from the log.",
    keywords: ["delete", "empty", "wipe"],
  },
  {
    id: "notifications.deviceAlerts",
    path: "notifications.deviceAlerts",
    page: "notifications",
    group: "Alerts",
    label: "Device alerts",
    description: "Say when a MIDI controller is plugged in or unplugged.",
    keywords: ["midi", "connect", "disconnect", "plug", "usb"],
  },

  // Controller
  {
    id: "controller.logarithmicSensitivity.enabled",
    path: "controller.logarithmicSensitivity.enabled",
    page: "controller",
    group: "Response curve",
    label: "Logarithmic response",
    description: "Give the quiet end of each control more travel, closer to how loudness is heard.",
    keywords: ["curve", "log", "sensitivity", "taper", "quiet"],
  },
  {
    id: "controller.logarithmicSensitivity.strength",
    path: "controller.logarithmicSensitivity.strength",
    page: "controller",
    group: "Response curve",
    label: "Curve strength",
    description: "How far the curve bends away from a straight line.",
    keywords: ["curve", "amount", "intensity", "sensitivity"],
  },
  {
    id: "controller.deadzone",
    path: "controller.deadzone",
    page: "controller",
    group: "Deadzone",
    label: "Deadzone",
    description:
      "How far a knob or fader has to move from rest before it counts, so jitter can't nudge the volume. Once it's moving, every step gets through.",
    keywords: ["jitter", "noise", "wobble", "threshold", "drift"],
  },

  // Diagnostics
  {
    id: "diagnostics.logLevel",
    path: "diagnostics.logLevel",
    page: "diagnostics",
    group: "Logging",
    label: "Log level",
    description: "The least serious messages that are written to the log.",
    keywords: ["logs", "verbosity", "debug", "info", "warn", "error"],
  },
  {
    id: "diagnostics.verboseLogging",
    path: "diagnostics.verboseLogging",
    page: "diagnostics",
    group: "Logging",
    label: "Verbose logging",
    description:
      "Also record every controller message and volume change. Useful for tracking down a problem; leave it off otherwise.",
    keywords: ["trace", "detailed", "midi", "debug"],
  },
  {
    id: "diagnostics.openLogs",
    page: "diagnostics",
    group: "Logging",
    label: "Log files",
    description: "Open the folder that holds Volcon's log files.",
    keywords: ["folder", "explorer", "files", "logs"],
  },
  {
    id: "diagnostics.copyInfo",
    page: "diagnostics",
    group: "Support",
    label: "Diagnostic info",
    description:
      "Copy versions, devices, settings and recent errors, ready to paste into a bug report.",
    keywords: ["bug", "report", "support", "clipboard", "copy", "version"],
  },

  // Backup & reset
  {
    id: "backup.export",
    page: "backup",
    group: "Backup",
    label: "Export settings",
    description: "Save every setting to a file in your Downloads folder.",
    keywords: ["save", "backup", "file", "json", "download"],
  },
  {
    id: "backup.import",
    page: "backup",
    group: "Backup",
    label: "Import settings",
    description: "Replace your settings with the ones in an exported file.",
    keywords: ["load", "restore", "file", "json", "open"],
  },
  {
    id: "backup.resetAll",
    page: "backup",
    group: "Reset",
    label: "Reset all settings",
    description:
      "Put every setting back to how Volcon ships. Your mappings and presets aren't affected.",
    keywords: ["defaults", "factory", "restore", "clear"],
  },

  // Updates
  {
    id: "updates.check",
    page: "updates",
    group: "Version",
    label: "Check for updates",
    description: "Look on GitHub for a newer version of Volcon.",
    keywords: ["update", "upgrade", "new version", "latest", "release", "download"],
  },
  {
    id: "updates.autoCheck",
    path: "updates.autoCheck",
    page: "updates",
    group: "Checking",
    label: "Check automatically",
    description: "Look when Volcon starts, once a day at most, and say so in the title bar if there's something new.",
    keywords: ["automatic", "startup", "daily", "notify", "update"],
  },
  {
    id: "updates.prereleases",
    path: "updates.prereleases",
    page: "updates",
    group: "Checking",
    label: "Include pre-releases",
    description: "Offer test versions too, before they're released for everyone. They may have rough edges.",
    keywords: ["beta", "preview", "test", "early", "pre-release", "update"],
  },

  // About
  {
    id: "about.version",
    page: "about",
    group: "Version",
    label: "Version",
    description: "Which version of Volcon is installed, and what it runs on.",
    keywords: ["about", "update", "build", "tauri", "webview", "commit", "hash"],
  },
  {
    id: "about.updates",
    page: "about",
    group: "Version",
    label: "Updates",
    description: "Whether this is the latest version. Checking and settings are on their own page.",
    keywords: ["update", "upgrade", "latest", "new version"],
  },
  {
    id: "about.shortcuts",
    page: "about",
    group: "Help",
    label: "Keyboard and mouse shortcuts",
    description: "Every shortcut Volcon has, in one place.",
    keywords: ["keyboard", "keys", "hotkeys", "shortcuts", "mouse", "f2", "ctrl"],
  },
  {
    id: "about.report",
    page: "about",
    group: "Help",
    label: "Report a problem",
    description: "Start an issue on GitHub with your versions and recent errors filled in.",
    keywords: ["bug", "issue", "problem", "feedback", "github", "support"],
  },
  {
    id: "about.source",
    page: "about",
    group: "Links",
    label: "Source code",
    description: "Volcon's code and issue tracker, on GitHub.",
    keywords: ["github", "repository", "issues", "bug", "code"],
  },
  {
    id: "about.credits",
    page: "about",
    group: "Links",
    label: "Credits",
    description: "The open-source projects Volcon is built with.",
    keywords: ["licences", "licenses", "open source", "thanks", "attribution", "libraries"],
  },
]

const entryMap = new Map(settingEntries.map((entry) => [entry.id, entry]))

export function getSettingEntry(id: string) {
  const entry = entryMap.get(id)

  if (!entry) {
    throw new Error(`No setting called "${id}"`)
  }

  return entry
}

export function getSetting<P extends SettingPath>(config: SettingsConfig, path: P): SettingValue<P> {
  let value: unknown = config

  for (const key of path.split(".")) {
    value = (value as Record<string, unknown>)[key]
  }

  return value as SettingValue<P>
}

/** A copy of `config` with one setting changed. */
export function setSetting<P extends SettingPath>(
  config: SettingsConfig,
  path: P,
  value: SettingValue<P>
): SettingsConfig {
  const write = (target: Record<string, unknown>, keys: string[]): Record<string, unknown> => {
    const [key, ...rest] = keys

    return {
      ...target,
      [key]: rest.length === 0 ? value : write(target[key] as Record<string, unknown>, rest),
    }
  }

  return write(config, path.split(".")) as SettingsConfig
}

export function isDefaultSetting(config: SettingsConfig, path: SettingPath) {
  return getSetting(config, path) === getSetting(defaultSettingsConfig, path)
}

/** A copy of `config` with one setting back at its default. */
export function resetSetting(config: SettingsConfig, path: SettingPath) {
  return setSetting(config, path, getSetting(defaultSettingsConfig, path))
}

export function pagePaths(page: SettingsSectionId) {
  return settingEntries.flatMap((entry) =>
    entry.page === page && entry.path ? [entry.path] : []
  )
}

/** Every setting there is, by path, in the order Settings lists them. */
export function allSettingPaths() {
  return settingEntries.flatMap((entry) => (entry.path ? [entry.path] : []))
}

export function pageIsDefault(config: SettingsConfig, page: SettingsSectionId) {
  return pagePaths(page).every((path) => isDefaultSetting(config, path))
}

/** Whether every setting is at its default. */
export function allDefault(config: SettingsConfig) {
  return settingEntries.every((entry) => !entry.path || isDefaultSetting(config, entry.path))
}

/** A copy of `config` with every setting on one page back at its default. */
export function resetPage(config: SettingsConfig, page: SettingsSectionId) {
  return pagePaths(page).reduce(resetSetting, config)
}

/**
 * The settings matching a search, best first. Every word typed has to appear
 * somewhere - the label, the description, the heading, the page, or one of the
 * other words it goes by - and a word found in the label counts for most.
 */
export function searchSettings(query: string) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)

  if (words.length === 0) {
    return []
  }

  const scored = settingEntries.flatMap((entry, index) => {
    const label = entry.label.toLowerCase()
    const fields = [
      entry.description,
      entry.group,
      settingsPageMap[entry.page].title,
      ...(entry.keywords ?? []),
    ].map((field) => field.toLowerCase())

    let score = 0

    for (const word of words) {
      if (label.startsWith(word)) {
        score += 4
      } else if (label.includes(word)) {
        score += 3
      } else if ((entry.keywords ?? []).some((keyword) => keyword.toLowerCase().startsWith(word))) {
        score += 2
      } else if (fields.some((field) => field.includes(word))) {
        score += 1
      } else {
        return []
      }
    }

    return [{ entry, score, index }]
  })

  // Ties keep the order the settings appear in, page by page.
  return scored
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ entry }) => entry)
}
