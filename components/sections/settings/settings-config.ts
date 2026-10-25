import { useSyncExternalStore } from "react"

import { getLaunchAtSignIn, setLaunchAtSignIn } from "@/lib/bridge-client"

export type SettingsConfig = {
  schemaVersion: 1
  appearance: {
    theme: "system" | "light" | "dark"
    /** Volume figures roll to each new value instead of just changing. */
    animatedNumbers: boolean
    /** Each sidebar button names its screen on hover. */
    sidebarTooltips: boolean
    /** A mapping's screen puts its name and level in the middle of the title bar. */
    toolbarReadout: boolean
  }
  overlay: {
    /** Whether the overlay comes up at all when a control moves. */
    enabled: boolean
    position: "top-left" | "top-right" | "bottom-left" | "bottom-right"
    avoidTaskbar: boolean
    fadeDelayMs: number
    /**
     * How opaque the overlay turns, in percent, while the mouse is over it, so
     * whatever it's covering can be read. 100 doesn't fade at all.
     */
    hoverOpacity: number
    /**
     * How many controls the overlay shows at once. Another moved while they're
     * all up takes the place of the one left alone longest.
     */
    maxCards: number
    /** The gap between stacked overlays, in px. */
    cardGap: number
    /** How far the overlay sits from the screen's edges, in px. */
    edgeMargin: number
    /** How big each overlay is drawn, from half size to half as big again. */
    scale: number
  }
  notifications: {
    /** Messages appear in the title bar as they happen. Off, they're only logged. */
    titleBar: boolean
    /** The least serious kind that still gets a line in the title bar. */
    titleBarLevel: "all" | "warnings" | "errors"
    /**
     * How long an ordinary message stays in the title bar, in milliseconds.
     * Warnings and errors stay proportionally longer.
     */
    displayTimeMs: number
    /** The dot on the sidebar's bell when something arrived unseen. */
    unreadBadge: boolean
    /** Say when a MIDI device is plugged in or unplugged. */
    deviceAlerts: boolean
    /** Keep the log between launches rather than starting each session empty. */
    keepHistory: boolean
    /** How many messages the log holds before the oldest go. */
    historyLimit: number
    /**
     * The same message several times in a row shows as one entry with a count
     * on the Notifications screen, which opens to list each one. Only where the
     * screen starts: it has a switch of its own.
     */
    groupRepeats: boolean
  }
  mapping: {
    /**
     * Ask before an app is taken off a control. Turned off by the dialog's own
     * "Don't ask again", and back on here.
     */
    confirmRemoveApp: boolean
    /**
     * Live left and right audio levels beside each assigned app. Off, nothing is
     * measured at all - the backend isn't asked and holds nothing for it.
     */
    levelMeters: boolean
  }
  startup: {
    launchOnStartup: boolean
    reopenLastSection: boolean
    openToTray: boolean
  }
  controller: {
    logarithmicSensitivity: {
      enabled: boolean
      strength: number
    }
    /**
     * How far a control at rest has to move, in percent of its travel, before
     * the movement counts. Once it's moving, every step does. 0 is off.
     */
    deadzone: number
  }
  diagnostics: {
    /** Also record every controller message and volume change. */
    verboseLogging: boolean
    /** The least serious messages that are still written to the log. */
    logLevel: "error" | "warn" | "info" | "debug"
  }
  navigation: {
    /** The mouse's side buttons go back and forward between screens. */
    mouseButtons: boolean
    /** Alt+Left and Alt+Right do the same from the keyboard. */
    altArrows: boolean
  }
  updates: {
    /** Look for a newer version when Volcon starts, once a day at most. */
    autoCheck: boolean
    /** Count test versions as updates too. */
    prereleases: boolean
  }
}

/** The widest deadzone the settings offer. The backend accepts up to 25. */
export const maxDeadzonePercent = 10

export type SettingsConfigUpdate = (
  updater: (current: SettingsConfig) => SettingsConfig
) => void

export const settingsConfigStorageKey = "volcon-settings-config"

/** Fired when the config changes, so an open settings screen can follow along. */
export const settingsConfigChangedEvent = "volcon:settings-config-changed"

/** Asks the settings screen to show a particular section. */
export const settingsSectionRequestEvent = "volcon:settings-section"

export const activeSettingsSectionStorageKey = "volcon.settings.active-section"

/**
 * A page asked for while the settings screen wasn't open to hear it, for the
 * screen to open on when it does - whether or not it reopens the last page.
 */
let pendingSection: string | null = null

/**
 * Shows a page of Settings: switched to at once if the screen is open, and
 * opened on when it next is if not.
 */
export function requestSettingsSection(id: string) {
  pendingSection = id

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(settingsSectionRequestEvent, { detail: id }))
  }
}

/** The page last asked for, until the settings screen has opened on it. */
export function pendingSettingsSection() {
  return pendingSection
}

export function clearPendingSettingsSection() {
  pendingSection = null
}

export const defaultSettingsConfig: SettingsConfig = {
  schemaVersion: 1,
  appearance: {
    theme: "system",
    animatedNumbers: true,
    sidebarTooltips: true,
    toolbarReadout: true,
  },
  overlay: {
    enabled: true,
    position: "top-left",
    avoidTaskbar: true,
    fadeDelayMs: 1000,
    hoverOpacity: 50,
    maxCards: 3,
    cardGap: 8,
    edgeMargin: 20,
    scale: 1,
  },
  notifications: {
    titleBar: true,
    titleBarLevel: "all",
    displayTimeMs: 3500,
    unreadBadge: true,
    deviceAlerts: true,
    keepHistory: true,
    historyLimit: 200,
    groupRepeats: false,
  },
  mapping: {
    confirmRemoveApp: true,
    levelMeters: true,
  },
  startup: {
    launchOnStartup: false,
    reopenLastSection: true,
    openToTray: false,
  },
  controller: {
    logarithmicSensitivity: {
      enabled: false,
      strength: 20,
    },
    deadzone: 0,
  },
  diagnostics: {
    verboseLogging: false,
    logLevel: "info",
  },
  navigation: {
    mouseButtons: true,
    altArrows: true,
  },
  updates: {
    autoCheck: true,
    prereleases: false,
  },
}

/** The log sizes the settings offer. */
export const notificationHistoryLimits = [50, 100, 200, 500] as const

/** The log levels, least to most detailed. */
export const logLevels = ["error", "warn", "info", "debug"] as const

const flag = (value: unknown, fallback: boolean) =>
  typeof value === "boolean" ? value : fallback

/** A whole number from `min` to `max`, or `fallback` if it isn't a number at all. */
const wholeNumber = (value: unknown, min: number, max: number, fallback: number) =>
  Math.round(
    Math.max(min, Math.min(max, typeof value === "number" && Number.isFinite(value) ? value : fallback))
  )

/** The most overlays the settings let show at once. */
export const maxOverlayCards = 8

/** The widest gap between stacked overlays, in px. */
export const maxOverlayGap = 24

/** The furthest the overlay can sit from the screen's edges, in px. */
export const maxOverlayEdgeMargin = 80

/** The overlay's size, as a multiple of its usual one. */
export const minOverlayScale = 0.5
export const maxOverlayScale = 1.5

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T) =>
  allowed.includes(value as T) ? (value as T) : fallback

function normalizeDeadzone(value: unknown) {
  const percent =
    typeof value === "number" && Number.isFinite(value)
      ? value
      : defaultSettingsConfig.controller.deadzone

  return Math.max(0, Math.min(maxDeadzonePercent, Math.round(percent)))
}

function normalizeControllerConfig(
  parsedController: Partial<SettingsConfig["controller"]> | undefined
) {
  const legacyStrength =
    typeof (parsedController as { controllerSensitivity?: number } | undefined)
      ?.controllerSensitivity === "number"
      ? (parsedController as { controllerSensitivity?: number })
          .controllerSensitivity
      : undefined

  return {
    logarithmicSensitivity: {
      enabled:
        parsedController?.logarithmicSensitivity?.enabled ??
        defaultSettingsConfig.controller.logarithmicSensitivity.enabled,
      strength:
        parsedController?.logarithmicSensitivity?.strength ??
        legacyStrength ??
        defaultSettingsConfig.controller.logarithmicSensitivity.strength,
    },
    deadzone: normalizeDeadzone(parsedController?.deadzone),
  } satisfies SettingsConfig["controller"]
}

/** The display times the slider offers, in milliseconds. */
export const minDisplayTimeMs = 1000
export const maxDisplayTimeMs = 7000

/**
 * What the display time used to be called, before it could be anything in
 * between: each one's length for an ordinary message.
 */
const legacyDisplayTimes: Record<string, number> = { short: 2100, normal: 3500, long: 6100 }

function normalizeDisplayTime(parsed: Record<string, unknown> | undefined) {
  const value = parsed?.displayTimeMs
  const legacy = typeof parsed?.displayTime === "string" ? legacyDisplayTimes[parsed.displayTime] : undefined
  const milliseconds =
    typeof value === "number" && Number.isFinite(value)
      ? value
      : (legacy ?? defaultSettingsConfig.notifications.displayTimeMs)

  return Math.round(Math.max(minDisplayTimeMs, Math.min(maxDisplayTimeMs, milliseconds)) / 100) * 100
}

function normalizeNotificationsConfig(
  parsed: Partial<SettingsConfig["notifications"]> | undefined
) {
  const defaults = defaultSettingsConfig.notifications

  return {
    titleBar: flag(parsed?.titleBar, defaults.titleBar),
    titleBarLevel: pick(parsed?.titleBarLevel, ["all", "warnings", "errors"], defaults.titleBarLevel),
    displayTimeMs: normalizeDisplayTime(parsed as Record<string, unknown> | undefined),
    unreadBadge: flag(parsed?.unreadBadge, defaults.unreadBadge),
    deviceAlerts: flag(parsed?.deviceAlerts, defaults.deviceAlerts),
    keepHistory: flag(parsed?.keepHistory, defaults.keepHistory),
    historyLimit: (notificationHistoryLimits as readonly number[]).includes(
      parsed?.historyLimit as number
    )
      ? (parsed?.historyLimit as number)
      : defaults.historyLimit,
    groupRepeats: flag(parsed?.groupRepeats, defaults.groupRepeats),
  } satisfies SettingsConfig["notifications"]
}

/**
 * Any stored or imported settings, made whole: anything missing takes its
 * default, anything out of range is pulled back in, and settings that have
 * moved since an older version are carried over to where they live now.
 */
export function normalizeSettingsConfig(
  parsed: Partial<SettingsConfig> | null | undefined
): SettingsConfig {
  // Level meters used to be an appearance setting; they live with the mapping
  // screen they belong to now.
  const legacyLevelMeters = (parsed?.appearance as { levelMeters?: unknown } | undefined)
    ?.levelMeters

  return {
    schemaVersion: 1,
    appearance: {
      theme: pick(parsed?.appearance?.theme, ["system", "light", "dark"], defaultSettingsConfig.appearance.theme),
      animatedNumbers: flag(
        parsed?.appearance?.animatedNumbers,
        defaultSettingsConfig.appearance.animatedNumbers
      ),
      sidebarTooltips: flag(
        parsed?.appearance?.sidebarTooltips,
        defaultSettingsConfig.appearance.sidebarTooltips
      ),
      toolbarReadout: flag(
        parsed?.appearance?.toolbarReadout,
        defaultSettingsConfig.appearance.toolbarReadout
      ),
    },
    overlay: {
      enabled: flag(parsed?.overlay?.enabled, defaultSettingsConfig.overlay.enabled),
      position: pick(
        parsed?.overlay?.position,
        ["top-left", "top-right", "bottom-left", "bottom-right"],
        defaultSettingsConfig.overlay.position
      ),
      avoidTaskbar: flag(parsed?.overlay?.avoidTaskbar, defaultSettingsConfig.overlay.avoidTaskbar),
      // At least a second, long enough to read the level it shows.
      fadeDelayMs: Math.max(
        1000,
        Math.min(
          10000,
          typeof parsed?.overlay?.fadeDelayMs === "number"
            ? parsed.overlay.fadeDelayMs
            : defaultSettingsConfig.overlay.fadeDelayMs
        )
      ),
      hoverOpacity: wholeNumber(parsed?.overlay?.hoverOpacity, 0, 100, defaultSettingsConfig.overlay.hoverOpacity),
      maxCards: wholeNumber(parsed?.overlay?.maxCards, 1, maxOverlayCards, defaultSettingsConfig.overlay.maxCards),
      cardGap: wholeNumber(parsed?.overlay?.cardGap, 0, maxOverlayGap, defaultSettingsConfig.overlay.cardGap),
      edgeMargin: wholeNumber(
        parsed?.overlay?.edgeMargin,
        0,
        maxOverlayEdgeMargin,
        defaultSettingsConfig.overlay.edgeMargin
      ),
      // To the nearest 0.05, the slider's step.
      scale:
        wholeNumber(
          typeof parsed?.overlay?.scale === "number" ? parsed.overlay.scale * 20 : undefined,
          minOverlayScale * 20,
          maxOverlayScale * 20,
          defaultSettingsConfig.overlay.scale * 20
        ) / 20,
    },
    startup: {
      launchOnStartup: flag(parsed?.startup?.launchOnStartup, defaultSettingsConfig.startup.launchOnStartup),
      reopenLastSection: flag(
        parsed?.startup?.reopenLastSection,
        defaultSettingsConfig.startup.reopenLastSection
      ),
      openToTray: flag(parsed?.startup?.openToTray, defaultSettingsConfig.startup.openToTray),
    },
    notifications: normalizeNotificationsConfig(parsed?.notifications),
    mapping: {
      confirmRemoveApp: flag(
        parsed?.mapping?.confirmRemoveApp,
        defaultSettingsConfig.mapping.confirmRemoveApp
      ),
      levelMeters: flag(
        parsed?.mapping?.levelMeters ?? legacyLevelMeters,
        defaultSettingsConfig.mapping.levelMeters
      ),
    },
    controller: normalizeControllerConfig(parsed?.controller),
    diagnostics: {
      verboseLogging: flag(
        parsed?.diagnostics?.verboseLogging,
        defaultSettingsConfig.diagnostics.verboseLogging
      ),
      logLevel: pick(parsed?.diagnostics?.logLevel, logLevels, defaultSettingsConfig.diagnostics.logLevel),
    },
    navigation: {
      mouseButtons: flag(parsed?.navigation?.mouseButtons, defaultSettingsConfig.navigation.mouseButtons),
      altArrows: flag(parsed?.navigation?.altArrows, defaultSettingsConfig.navigation.altArrows),
    },
    updates: {
      autoCheck: flag(parsed?.updates?.autoCheck, defaultSettingsConfig.updates.autoCheck),
      prereleases: flag(parsed?.updates?.prereleases, defaultSettingsConfig.updates.prereleases),
    },
  }
}

export function createDefaultSettingsConfig() {
  return structuredClone(defaultSettingsConfig)
}

export function loadSettingsConfig() {
  if (typeof window === "undefined") {
    return createDefaultSettingsConfig()
  }

  const raw = window.localStorage.getItem(settingsConfigStorageKey)

  if (!raw) {
    return createDefaultSettingsConfig()
  }

  try {
    return normalizeSettingsConfig(JSON.parse(raw) as Partial<SettingsConfig>)
  } catch {
    return createDefaultSettingsConfig()
  }
}

/** Settings waiting to go to the overlay window, sent once a frame at most. */
let overlayPending: SettingsConfig | null = null

/**
 * Hands the overlay window the latest settings. A dragged slider saves on
 * every pointer move, and each send is a trip through the main thread that
 * also carries the overlay its levels; one a frame is all it can show anyway.
 */
function sendToOverlay(config: SettingsConfig) {
  const alreadyQueued = overlayPending !== null
  overlayPending = config

  if (alreadyQueued) {
    return
  }

  requestAnimationFrame(() => {
    const latest = overlayPending
    overlayPending = null

    if (latest) {
      void import("@tauri-apps/api/window")
        .then(({ getCurrentWindow }) => getCurrentWindow().emitTo("overlay", "settings:update", latest))
        .catch(() => {})
    }
  })
}

export function saveSettingsConfig(config: SettingsConfig) {
  if (typeof window === "undefined") {
    return
  }

  window.localStorage.setItem(settingsConfigStorageKey, JSON.stringify(config))
  window.dispatchEvent(
    new CustomEvent(settingsConfigChangedEvent, { detail: config })
  )

  sendToOverlay(config)
  pushBackendSettings(config)
}

/**
 * The stored settings, read once and kept until they change, for code that
 * asks often - every notification raised, every render of the sidebar - and
 * shouldn't parse local storage each time.
 */
let settingsSnapshot: SettingsConfig | null = null
const settingsListeners = new Set<() => void>()
let watchingSettings = false

function watchSettings() {
  if (watchingSettings || typeof window === "undefined") {
    return
  }

  watchingSettings = true

  const refresh = () => {
    settingsSnapshot = null
    settingsListeners.forEach((listener) => listener())
  }

  // The first is a save in this window; `storage` is a save in another one.
  window.addEventListener(settingsConfigChangedEvent, refresh)
  window.addEventListener("storage", refresh)
}

export function getSettingsSnapshot() {
  settingsSnapshot ??= loadSettingsConfig()
  return settingsSnapshot
}

/**
 * Settings handed over by the main window, for a window that only shows them:
 * the overlay. Taken as they arrive rather than read back from storage, so they
 * apply even when the save in the other window raises no `storage` event here.
 */
export function adoptSettingsConfig(config: SettingsConfig) {
  watchSettings()
  settingsSnapshot = normalizeSettingsConfig(config)
  settingsListeners.forEach((listener) => listener())
}

/** Runs `listener` after any change to the stored settings. */
export function subscribeToSettings(listener: () => void) {
  watchSettings()
  settingsListeners.add(listener)

  return () => {
    settingsListeners.delete(listener)
  }
}

/** The stored settings, kept current as they change anywhere in the app. */
export function useSettingsConfig(): SettingsConfig {
  return useSyncExternalStore(
    subscribeToSettings,
    getSettingsSnapshot,
    () => defaultSettingsConfig
  )
}

let lastPushedBackend: string | null = null
let pushRetry: ReturnType<typeof setTimeout> | null = null

/**
 * Hands the settings that apply in the backend to it: the response curve on the
 * audio thread, where a control position becomes a level; the deadzone in the
 * MIDI callback, before a movement goes anywhere; and how much gets logged. The
 * curve it reports back is adopted as the one the UI describes.
 *
 * The answer matters as much as the request: until the backend confirms, the UI
 * keeps showing the chain that is really running. A push that fails is retried,
 * because a setting that silently never arrived is the same bug wearing a
 * different hat.
 */
export function pushBackendSettings(config: SettingsConfig) {
  const { logarithmicSensitivity, deadzone } = config.controller
  const { enabled, strength } = logarithmicSensitivity
  const { logLevel, verboseLogging } = config.diagnostics
  const signature = `${enabled}:${strength}:${deadzone}:${logLevel}:${verboseLogging}`

  // Every settings save comes through here, and dragging a slider saves on each
  // pointer move. Only an actual change is worth a round trip.
  if (signature === lastPushedBackend) {
    return
  }

  lastPushedBackend = signature

  if (pushRetry !== null) {
    clearTimeout(pushRetry)
    pushRetry = null
  }

  void Promise.all([import("@/lib/bridge-client"), import("@/lib/volume-levels")])
    .then(async ([{ setDeadzone, setLogging, setVolumeCurve }, { setActiveCurve }]) => {
      // All idempotent on the backend, so a change to one resending the others
      // costs nothing.
      const [curve, zone, logging] = await Promise.all([
        setVolumeCurve(enabled, strength),
        setDeadzone(deadzone),
        setLogging(logLevel, verboseLogging),
      ])

      setActiveCurve({ enabled: curve.enabled, strength: curve.strength })

      // A reply that isn't what was asked for is a failed push, not a success:
      // the backend is running something other than what Settings shows.
      if (
        !curve.ok ||
        !zone.ok ||
        !logging.ok ||
        !backendMatches(
          { enabled, strength, deadzone, logLevel, verboseLogging },
          {
            enabled: curve.enabled,
            strength: curve.strength,
            deadzone: zone.percent,
            logLevel: logging.level,
            verboseLogging: logging.verbose,
          }
        )
      ) {
        throw new Error("The backend didn't apply the settings.")
      }
    })
    .catch(() => {
      // Not under Tauri, the bridge isn't up yet, or it answered with something
      // else. Let the next save through, and try again shortly in case this
      // was only a matter of timing.
      lastPushedBackend = null

      if (typeof window !== "undefined" && pushRetry === null) {
        pushRetry = setTimeout(() => {
          pushRetry = null
          // Re-read rather than resend: a newer setting may have landed while
          // this one was failing, and that is the one that should go over.
          pushBackendSettings(loadSettingsConfig())
        }, 1000)
      }
    })
}

type BackendState = {
  enabled: boolean
  strength: number
  deadzone?: number
  logLevel?: string
  verboseLogging?: boolean
}

/**
 * Whether two backend states are the same, allowing for float rounding. A
 * backend too old to report a part can't be checked on it.
 */
function backendMatches(wanted: BackendState, actual: BackendState) {
  return (
    wanted.enabled === actual.enabled &&
    Math.abs(wanted.strength - actual.strength) < 0.01 &&
    (actual.deadzone === undefined || wanted.deadzone === actual.deadzone) &&
    (actual.logLevel === undefined || wanted.logLevel === actual.logLevel) &&
    (actual.verboseLogging === undefined || wanted.verboseLogging === actual.verboseLogging)
  )
}

/** How often the backend is checked against Settings while the app is open. */
const RECONCILE_INTERVAL_MS = 5000

/**
 * Asks the backend what it's actually running and, if that isn't what Settings
 * says, sends Settings over again. Covers every way the two can drift apart: a
 * push at launch that landed before the backend was listening, a backend that
 * restarted or was updated underneath a running window, or a reply lost in
 * between. The setting on screen is always the one in force within a few
 * seconds, without having to toggle it off and on.
 */
export async function reconcileBackendSettings() {
  if (typeof window === "undefined") {
    return
  }

  try {
    const { getState } = await import("@/lib/bridge-client")
    const state = await getState()
    const config = loadSettingsConfig()
    const { logarithmicSensitivity, deadzone } = config.controller

    if (
      !backendMatches(
        { ...logarithmicSensitivity, deadzone, ...config.diagnostics },
        {
          ...state.curve,
          deadzone: state.deadzone,
          logLevel: state.logging?.level,
          verboseLogging: state.logging?.verbose,
        }
      )
    ) {
      lastPushedBackend = null
      pushBackendSettings(config)
    }
  } catch {
    // Bridge not up yet: push anyway, which retries until it is.
    lastPushedBackend = null
    pushBackendSettings(loadSettingsConfig())
  }
}

/** Set before Reset everything reloads Volcon, so the fresh start can say so. */
export const justResetKey = "volcon.just-reset"

/**
 * How often Windows is asked whether it still starts Volcon, besides being told
 * straight away by the backend: in case a change slips past it.
 */
const LAUNCH_READ_INTERVAL_MS = 30_000

/** Says a change to Launch with Windows didn't take, and why. */
function complainAboutLaunch(wanted: boolean, reason: string) {
  // Imported here because notifications read the settings too.
  void import("@/lib/notifications").then(({ toast }) => {
    toast.error("Couldn't change Launch with Windows", {
      source: "settings",
      detail: reason,
      event: {
        type: "action-failed",
        attempted: wanted
          ? "Have Windows start Volcon when you sign in"
          : "Stop Windows starting Volcon when you sign in",
        reason,
        hint: "The switch in Settings → Startup shows what Windows is really set to.",
      },
    })
  })
}

/**
 * Keeps the startup settings that live outside the app in step with it.
 *
 * Launch with Windows is the same switch as Volcon's entry in Startup apps, in
 * Windows' Settings and Task Manager, so it's Windows' to say. The backend says
 * the moment it changes there, it's read again on start and when the window
 * comes back, and the setting simply follows. Only a change made here (the
 * switch, a reset, an import, the command menu) is sent to Windows, one at a
 * time, and the switch then shows what Windows did with it. Following never
 * sends anything back, so the setting and Windows can't keep flipping each
 * other.
 *
 * Whether it opens hidden is the backend's to read at launch, and is sent to it
 * whenever it changes.
 */
function startStartupSync() {
  // A development build would register its own, temporary executable.
  const managesWindows = process.env.NODE_ENV === "production"
  let applied: SettingsConfig["startup"] | null = null
  /** What Windows was last read as, or set to; null until it's been asked. */
  let windowsSays: boolean | null = null
  let sending = false

  /** Takes Windows' answer as the setting, without sending it back. */
  const adopt = (enabled: boolean) => {
    windowsSays = enabled
    const current = getSettingsSnapshot()

    if (current.startup.launchOnStartup !== enabled) {
      saveSettingsConfig({ ...current, startup: { ...current.startup, launchOnStartup: enabled } })
    }
  }

  const read = async () => {
    if (!managesWindows || sending) {
      return
    }

    try {
      const enabled = await getLaunchAtSignIn()

      // A change may have set off while Windows was being asked.
      if (!sending) {
        adopt(enabled)
      }
    } catch {
      // Without an answer, the setting stays as it is.
    }
  }

  const send = async (wanted: boolean) => {
    sending = true
    let enabled: boolean

    try {
      enabled = await setLaunchAtSignIn(wanted)
    } catch (error) {
      sending = false
      complainAboutLaunch(wanted, error instanceof Error ? error.message : String(error))
      // The switch goes back to what Windows is really set to.
      void read()
      return
    }

    sending = false
    windowsSays = enabled
    const latest = getSettingsSnapshot().startup.launchOnStartup

    // Changed again while this was on its way: the newest wish is the one
    // that counts.
    if (latest !== wanted) {
      if (latest !== enabled) {
        void send(latest)
      }

      return
    }

    if (enabled !== wanted) {
      complainAboutLaunch(wanted, "Windows didn't keep the change.")
      adopt(enabled)
    }
  }

  const apply = () => {
    const next = getSettingsSnapshot().startup
    const previous = applied
    applied = next

    if (managesWindows && !sending && windowsSays !== null && next.launchOnStartup !== windowsSays) {
      void send(next.launchOnStartup)
    }

    // The backend reads this one at launch; sent at start too, so the two
    // can't disagree after settings were imported or reset while it was off.
    if (!previous || previous.openToTray !== next.openToTray) {
      void import("@tauri-apps/api/core")
        .then(({ invoke }) => invoke("set_open_to_tray", { enabled: next.openToTray }))
        .catch(() => {})
    }
  }

  const onFocus = () => void read()
  const timer = window.setInterval(onFocus, LAUNCH_READ_INTERVAL_MS)
  let stopListening: (() => void) | null = null
  let stopped = false

  // Switched in Startup apps - or by this window, which is already in step.
  if (managesWindows) {
    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<boolean>("launch:changed", (event) => {
          if (!sending) {
            adopt(event.payload)
          }
        })
      )
      .then((unlisten) => {
        if (stopped) {
          unlisten()
        } else {
          stopListening = unlisten
        }
      })
      .catch(() => {})
  }

  apply()
  void read()
  window.addEventListener("focus", onFocus)
  const unsubscribe = subscribeToSettings(apply)

  return () => {
    stopped = true
    window.clearInterval(timer)
    window.removeEventListener("focus", onFocus)
    stopListening?.()
    unsubscribe()
  }
}

/**
 * Keeps everything Settings controls outside this window in step with it, for
 * as long as the main window is open: the backend's settings (now, on a timer,
 * and whenever the window comes back into focus) and the startup settings
 * Windows holds (whenever they change). Returns a function that stops it all.
 */
export function startSettingsSync() {
  void reconcileBackendSettings()

  const interval = window.setInterval(() => {
    void reconcileBackendSettings()
  }, RECONCILE_INTERVAL_MS)
  const onFocus = () => void reconcileBackendSettings()
  const stopStartupSync = startStartupSync()

  window.addEventListener("focus", onFocus)

  return () => {
    window.clearInterval(interval)
    window.removeEventListener("focus", onFocus)
    stopStartupSync()
  }
}
