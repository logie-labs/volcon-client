"use client"

import { useEffect, useEffectEvent, useRef, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import {
  getCurrentWindow,
  currentMonitor,
  cursorPosition,
  primaryMonitor,
  LogicalSize,
  PhysicalPosition,
} from "@tauri-apps/api/window"
import { RiComputerLine } from "@remixicon/react"

import {
  adoptSettingsConfig,
  defaultSettingsConfig,
  loadSettingsConfig,
  settingsConfigStorageKey,
  type SettingsConfig,
} from "@/components/sections/settings/settings-config"
import { appClusterKey, pickPrimaryApp } from "@/components/sections/mapping/preset-config"
import { VolumeNumber } from "@/components/volume-number"
import { useOverlaySnapshots, type OverlaySnapshot } from "@/context/volcon-context"
import { useControlPercent } from "@/lib/control-volume-store"
import { useAppDirectory } from "@/lib/app-icons"
import { useHdIcon } from "@/lib/hd-icons"
import { hasTauriRuntime } from "@/lib/tauri-runtime"
import { cn } from "@/lib/utils"

type OverlaySettings = SettingsConfig["overlay"]

type OverlayShowEvent = {
  control?: number
}

/** How far around the cards, in logical px, still counts as the mouse being over them. */
const hoverMargin = 24

/** How often to check the cursor while the overlay is showing. */
const hoverPollMs = 50

/** One card's size, in logical px - `w-60` and `h-17.5` below. */
const CARD_WIDTH = 240
const CARD_HEIGHT = 70

function overlaySettings(config: SettingsConfig): OverlaySettings {
  return config.overlay
}

/** The window's size, in logical px, for as many cards as Settings allows, stacked. */
const windowSize = (settings: OverlaySettings) => ({
  width: Math.round(CARD_WIDTH * settings.scale),
  height:
    Math.round(settings.maxCards * CARD_HEIGHT * settings.scale) +
    (settings.maxCards - 1) * settings.cardGap,
})

/** The settings that decide where the window goes and how big it is. */
const placementKey = (settings: OverlaySettings) =>
  [settings.position, settings.avoidTaskbar, settings.edgeMargin, settings.maxCards, settings.cardGap, settings.scale].join(":")

/** The placement settings last acted on, so a change to anything else doesn't move the window. */
let placedFor: string | null = null

/** What the window was last given, so an unchanged size or spot isn't set again. */
let appliedSize: string | null = null
let appliedPosition: string | null = null

/** A placement running, and the settings to place by once it's done, if newer. */
let placing = false
let placeAgain: OverlaySettings | null = null

/**
 * Sizes the window to hold the most cards Settings allows, then puts it in its
 * corner, the set distance in from the screen's edges. Sized for the most
 * rather than for those up right now, so the window never resizes while cards
 * come and go; the room around them is transparent and ignores the mouse.
 *
 * One at a time: every move of a settings slider asks, and each placement is a
 * few trips to the main thread - the same thread that delivers the levels the
 * cards show, so a pile of them would hold the numbers still. Asked again while
 * one is running, it places once more when that's done, by the latest settings.
 */
function scheduleOverlayPosition(settings: OverlaySettings) {
  if (!hasTauriRuntime()) return

  if (placing) {
    placeAgain = settings
    return
  }

  placing = true

  void (async () => {
    try {
      const appWindow = getCurrentWindow()
      const { width, height } = windowSize(settings)

      if (appliedSize !== `${width}x${height}`) {
        await appWindow.setSize(new LogicalSize(width, height))
        appliedSize = `${width}x${height}`
      }

      // The primary screen is the fallback for when Windows has left the
      // overlay off every screen, after a display was unplugged, say.
      const monitor = (await currentMonitor()) ?? (await primaryMonitor())

      if (monitor) {
        // Everything below is in the screen's own pixels.
        const scale = monitor.scaleFactor
        const wide = Math.round(width * scale)
        const tall = Math.round(height * scale)
        const margin = Math.round(settings.edgeMargin * scale)
        const area = settings.avoidTaskbar
          ? monitor.workArea
          : { position: monitor.position, size: monitor.size }

        const isRight = settings.position.endsWith("right")
        const isBottom = settings.position.startsWith("bottom")

        const x = isRight
          ? area.position.x + area.size.width - wide - margin
          : area.position.x + margin

        const y = isBottom
          ? area.position.y + area.size.height - tall - margin
          : area.position.y + margin

        const maxX = area.position.x + area.size.width - wide
        const maxY = area.position.y + area.size.height - tall
        const left = Math.max(area.position.x, Math.min(maxX, x))
        const top = Math.max(area.position.y, Math.min(maxY, y))

        if (appliedPosition !== `${left},${top}`) {
          await appWindow.setPosition(new PhysicalPosition(left, top))
          appliedPosition = `${left},${top}`
        }
      }
    } catch {
      // Nothing to do but leave it where it is.
    } finally {
      placing = false

      const next = placeAgain
      placeAgain = null

      if (next) {
        scheduleOverlayPosition(next)
      }
    }
  })()
}

/**
 * An app's icon, drawn from the large copy in its executable once that's
 * fetched, so it stays sharp at any scale; the small everyday one until then,
 * and the last one it was seen with if the backend sent none.
 */
function OverlayAppIcon({ app }: { app: OverlaySnapshot["apps"][number] }) {
  // Only what the main window has already learned: reading files from here
  // would queue on the thread that delivers this window its events.
  const knownApps = useAppDirectory()
  const icon = useHdIcon(app.executable_path) ?? app.icon ?? knownApps.icon(app.name)

  return icon ? (
    <img src={icon} alt={app.name} className="size-full object-contain" />
  ) : (
    <RiComputerLine className="h-5 w-5 text-muted-foreground" />
  )
}

/** One control on the overlay: the apps it moves, and where it's set. */
function OverlayCard({ control, scale }: { control: number; scale: number }) {
  // Read here rather than handed down, so new apps for one control re-render
  // that card alone, not the stack and every card's animation with it.
  const snapshot = useOverlaySnapshots()[control]
  // The icon row comes from `overlay:update`, which the audio thread only sends
  // when the app list changes. The level comes from `control:update` instead, so
  // the bar tracks the knob rather than the rate those heavier frames are sent.
  const volume = useControlPercent(control, snapshot?.percent ?? 0)

  // Cluster by install directory (falling back to normalized name) so sub-processes of the same
  // app (e.g. a Spotify helper process) collapse into a single icon instead of showing twice.
  const appClusters = new Map<string, OverlaySnapshot["apps"]>()
  for (const app of snapshot?.apps ?? []) {
    const key = appClusterKey(app)
    const group = appClusters.get(key)
    if (group) {
      group.push(app)
    } else {
      appClusters.set(key, [app])
    }
  }

  const apps = Array.from(appClusters.values()).map((group) => pickPrimaryApp(group))

  const visibleAppCount = apps.length <= 2 ? apps.length : 1

  const visibleApps = [...apps]
    .sort((a, b) => a.name.localeCompare(b.name) || a.pid - b.pid)
    .slice(0, visibleAppCount)

  const extraCount = Math.max(0, apps.length - visibleApps.length)

  return (
    // Zoomed rather than transformed, so it takes up its scaled size and its
    // text and icons are drawn sharp at it.
    <div className="relative h-17.5 w-60 overflow-hidden border bg-background" style={{ zoom: scale }}>
      <div className="relative z-1 flex h-full w-full items-center justify-between gap-4 p-3 px-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex min-w-0 items-center gap-2">
            {apps.length === 0 ? (
              <div className="flex size-10 shrink-0 items-center justify-center border border-foreground/10 bg-muted">
                <RiComputerLine className="h-5 w-5 text-muted-foreground" />
              </div>
            ) : (
              <>
                {visibleApps.map((app) => (
                  <div
                    key={`${app.pid}-${app.name}`}
                    className="flex size-10 shrink-0 items-center justify-center overflow-hidden border border-foreground/10 bg-muted p-1"
                  >
                    <OverlayAppIcon app={app} />
                  </div>
                ))}

                {extraCount > 0 && (
                  <div className="flex size-10 shrink-0 items-center justify-center border border-foreground/10 bg-muted text-xs font-medium text-muted-foreground">
                    +{extraCount}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Mounted with the card, so it arrives showing the level rather than
            rolling there from whatever was shown last time. */}
        <div className="z-1 flex gap-1 leading-none">
          <VolumeNumber value={Math.round(volume)} className="text-4xl text-foreground" />
          <span className="text-muted-foreground">%</span>
        </div>

        <div
          className={`absolute top-0 left-0 z-0 h-full w-full origin-left border-primary/50 bg-primary/50 will-change-transform dark:bg-primary/10 ${
            volume === 0 || volume === 100 ? "" : "border-r"
          }`}
          style={{ width: `${volume}%` }}
        />
      </div>
    </div>
  )
}

export default function OverlayPage() {
  // The controls with a card up, oldest first. Only a card arriving or leaving
  // changes this: a control that keeps moving keeps its card up through the
  // refs below, without re-rendering the stack hundreds of times a second.
  const [shown, setShown] = useState<number[]>([])
  const shownRef = useRef<number[]>([])
  /** When each card's control last moved, for choosing which gives way to a newcomer. */
  const raisedAt = useRef(new Map<number, number>())
  const hideTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  // The mouse is over the cards, or close to them: they fade back so whatever
  // is underneath stays readable.
  const [hovered, setHovered] = useState(false)
  const stackRef = useRef<HTMLDivElement | null>(null)

  // The settings this window draws with, and the same for its event handlers,
  // which are registered once.
  const [settings, setSettings] = useState<OverlaySettings>(defaultSettingsConfig.overlay)
  const settingsRef = useRef<OverlaySettings>(defaultSettingsConfig.overlay)

  const commitShown = (next: number[]) => {
    shownRef.current = next
    setShown(next)

    if (next.length === 0) {
      // So it doesn't come back already faded from where the mouse was last time.
      setHovered(false)
    }
  }

  const forget = (control: number) => {
    const timer = hideTimers.current.get(control)

    if (timer) {
      clearTimeout(timer)
    }

    hideTimers.current.delete(control)
    raisedAt.current.delete(control)
  }

  const hideCard = (control: number) => {
    forget(control)
    commitShown(shownRef.current.filter((shownControl) => shownControl !== control))
  }

  const hideAll = () => {
    for (const control of shownRef.current) {
      forget(control)
    }

    commitShown([])
  }

  /** The visible controls, less the ones left alone longest, down to `limit`. */
  const trimmedTo = (controls: number[], limit: number) => {
    let next = controls

    while (next.length > limit) {
      const stalest = next.reduce((oldest, control) =>
        (raisedAt.current.get(control) ?? 0) < (raisedAt.current.get(oldest) ?? 0) ? control : oldest
      )
      forget(stalest)
      next = next.filter((control) => control !== stalest)
    }

    return next
  }

  const showCard = (control: number) => {
    if (!settingsRef.current.enabled) {
      return
    }

    raisedAt.current.set(control, Date.now())

    // Each card fades on its own clock, from its own control's last move.
    const timer = hideTimers.current.get(control)
    if (timer) {
      clearTimeout(timer)
    }
    hideTimers.current.set(
      control,
      setTimeout(() => hideCard(control), settingsRef.current.fadeDelayMs)
    )

    // Already up: nothing on screen has to change.
    if (shownRef.current.includes(control)) {
      return
    }

    // Placed on the way in rather than once at launch: screens get plugged in,
    // unplugged and rescaled while the app runs, and the overlay belongs in the
    // corner of the screen as it is now.
    if (shownRef.current.length === 0) {
      scheduleOverlayPosition(settingsRef.current)
    }

    commitShown(trimmedTo([...shownRef.current, control], settingsRef.current.maxCards))
  }

  const applySettings = (next: OverlaySettings) => {
    settingsRef.current = next
    setSettings(next)

    // Only a change to where it goes, or how big, moves the window.
    if (placementKey(next) !== placedFor) {
      placedFor = placementKey(next)
      scheduleOverlayPosition(next)
    }

    if (!next.enabled) {
      hideAll()
    } else if (shownRef.current.length > next.maxCards) {
      commitShown(trimmedTo(shownRef.current, next.maxCards))
    }
  }

  // What the window's event listeners call, registered once below.
  const onSettings = useEffectEvent(applySettings)
  const onShow = useEffectEvent(showCard)
  const onHide = useEffectEvent(hideAll)

  // The mouse isn't heard - the overlay ignores it so it never gets in the way -
  // so while anything is showing, ask where the cursor is.
  const anyShown = shown.length > 0

  useEffect(() => {
    if (!anyShown || !hasTauriRuntime()) return

    const appWindow = getCurrentWindow()
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const poll = async () => {
      try {
        const [cursor, position, scale] = await Promise.all([
          cursorPosition(),
          appWindow.outerPosition(),
          appWindow.scaleFactor(),
        ])
        const stack = stackRef.current?.getBoundingClientRect()

        if (cancelled || !stack) return

        // The window is taller than the cards it holds, and the space around
        // them doesn't count: only the cards themselves, on screen.
        const margin = hoverMargin * scale
        const left = position.x + stack.left * scale
        const top = position.y + stack.top * scale

        setHovered(
          cursor.x >= left - margin &&
            cursor.x <= left + stack.width * scale + margin &&
            cursor.y >= top - margin &&
            cursor.y <= top + stack.height * scale + margin
        )
      } catch {
        // Not knowing where the cursor is just leaves the overlay as it is.
      }

      if (!cancelled) {
        timer = setTimeout(poll, hoverPollMs)
      }
    }

    void poll()

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [anyShown])

  useEffect(() => {
    const refreshSettings = () => onSettings(overlaySettings(loadSettingsConfig()))

    const handleStorage = (event: StorageEvent) => {
      if (event.key === settingsConfigStorageKey) {
        refreshSettings()
      }
    }

    // The stored settings once the page is up; the defaults until then.
    queueMicrotask(refreshSettings)

    window.addEventListener("storage", handleStorage)
    window.addEventListener("focus", refreshSettings)

    return () => {
      window.removeEventListener("storage", handleStorage)
      window.removeEventListener("focus", refreshSettings)
    }
  }, [])

  useEffect(() => {
    if (!hasTauriRuntime()) return

    let unlistenShow: null | (() => void) = null
    let unlistenHide: null | (() => void) = null
    let unlistenSettings: null | (() => void) = null
    const timers = hideTimers.current

    ;(async () => {
      const appWindow = getCurrentWindow()

      unlistenSettings = await appWindow.listen<SettingsConfig>(
        "settings:update",
        ({ payload }) => {
          // All of them, not just the overlay's own: its figures stop rolling
          // when Animated numbers is turned off, too.
          adoptSettingsConfig(payload)
          onSettings(overlaySettings(payload))
        }
      )

      // Only the backend decides when the overlay shows: it raises it for a
      // control that moves something and says nothing for one that doesn't.
      // Listening to raw `control:update` as well popped the overlay for any
      // control at all, unmapped ones included.
      unlistenShow = await appWindow.listen<OverlayShowEvent>("overlay:show", ({ payload }) => {
        if (typeof payload?.control === "number") {
          onShow(payload.control)
        }
      })

      unlistenHide = await appWindow.listen("overlay:hide", () => onHide())
    })()

    return () => {
      for (const timer of timers.values()) {
        clearTimeout(timer)
      }

      unlistenShow?.()
      unlistenHide?.()
      unlistenSettings?.()
    }
  }, [])

  // Cards stack away from the corner they're in: down from a top corner, up
  // from a bottom one, with the newest furthest out.
  const fromBottom = settings.position.startsWith("bottom")
  const ordered = fromBottom ? [...shown].reverse() : shown

  return (
    <div className={cn("flex h-full w-full flex-col", fromBottom ? "justify-end" : "justify-start")}>
      <div
        ref={stackRef}
        className="relative flex flex-col transition-opacity duration-300"
        style={{ gap: settings.cardGap, opacity: hovered ? settings.hoverOpacity / 100 : 1 }}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          {ordered.map((control) => (
            <motion.div
              key={control}
              layout
              initial={{ opacity: 0, scale: 0.95, y: fromBottom ? 12 : -12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.25, ease: "easeOut" } }}
              transition={{ type: "spring", bounce: 0.15, duration: 0.4 }}
            >
              <OverlayCard control={control} scale={settings.scale} />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}
