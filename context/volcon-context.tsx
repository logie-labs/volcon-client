"use client"

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { listen } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"

import {
  clampPercent,
  controlValueToPercent,
  setControlPosition,
} from "@/lib/control-volume-store"
import { normalizeAppName } from "@/components/sections/mapping/preset-config"
import {
  getState,
  listAudioSessions,
  listInputs,
  listRunningProcessNames,
  type ProcessDetails,
} from "@/lib/bridge-client"
import { rememberApps } from "@/lib/app-icons"
import { toast } from "@/lib/notifications"
import { getSettingsSnapshot } from "@/components/sections/settings/settings-config"
import { hasTauriRuntime } from "@/lib/tauri-runtime"
import { setActiveCurve } from "@/lib/volume-levels"

const POLL_INTERVAL_MS = 3000

/** Label of the overlay's window in tauri.conf.json. */
const OVERLAY_WINDOW = "overlay"

export type OverlaySnapshot = {
  control: number
  value: number
  percent: number
  apps: ProcessDetails[]
}

type ControlUpdateEvent = {
  control: number
  value: number
  volume: number
}

type OverlayUpdateEvent = {
  control: number
  value: number
  volume: number
  apps: ProcessDetails[]
}

/**
 * Everything here changes at human speed — devices appearing, audio sessions
 * coming and going. Control positions deliberately do not live in this context:
 * they arrive at MIDI rate and are kept in `lib/control-volume-store`, which
 * notifies only the components showing that one control.
 */
type VolconRuntime = {
  /**
   * The latest apps and level the backend sent for each control, by control,
   * so the overlay can show several controls at once.
   */
  overlays: Readonly<Record<number, OverlaySnapshot>>
  selectedInput: string | null
  midiInputs: string[]
  audioSessions: ProcessDetails[]
  /**
   * Whether the audio sessions have been read at least once. An empty list
   * alone can't say: nothing has made a sound yet, or nothing has looked.
   */
  audioSessionsLoaded: boolean
  /**
   * Normalized names of every app with a process running, playing audio or
   * not. Audio sessions alone can't tell an app that's open but silent from
   * one that isn't open at all.
   */
  runningApps: ReadonlySet<string>
}

const defaultRuntime: VolconRuntime = {
  overlays: {},
  selectedInput: null,
  midiInputs: [],
  audioSessions: [],
  audioSessionsLoaded: false,
  runningApps: new Set(),
}

const VolconContext = createContext<VolconRuntime | null>(null)

/**
 * Says so when a MIDI device is unplugged or plugged in. Compared against the
 * last list that was read successfully, so a failed poll - which reads as no
 * devices at all - isn't mistaken for every device going at once.
 */
function announceInputChanges(previous: readonly string[], next: readonly string[]) {
  if (!getSettingsSnapshot().notifications.deviceAlerts) {
    return
  }

  const before = new Set(previous)
  const after = new Set(next)

  for (const name of previous) {
    if (!after.has(name)) {
      toast.warning(`${name} disconnected`, {
        source: "controller",
        key: `midi-disconnected:${name}`,
        description: "Its controls won't change any volumes until it's plugged back in.",
        fields: [{ label: "Device", value: name }],
        event: { type: "device", change: "disconnected", device: name },
      })
    }
  }

  for (const name of next) {
    if (!before.has(name)) {
      toast.success(`${name} connected`, {
        source: "controller",
        key: `midi-connected:${name}`,
        description: "Its controls are live again.",
        fields: [{ label: "Device", value: name }],
        event: { type: "device", change: "connected", device: name },
      })
    }
  }
}

export function VolconProvider({ children }: { children: ReactNode }) {
  const [runtime, setRuntime] = useState<VolconRuntime>(defaultRuntime)
  const listenerCleanupRef = useRef<Array<() => void>>([])

  useEffect(() => {
    if (!hasTauriRuntime()) {
      return
    }

    // Both windows mount this provider, but the overlay only ever draws a level
    // and a row of icons.
    const isOverlayWindow = getCurrentWindow().label === OVERLAY_WINDOW
    let cancelled = false
    /** The devices last seen, once the first read has landed. */
    let knownInputs: string[] | null = null

    const adoptInputs = (inputs: string[]) => {
      if (knownInputs !== null && !isOverlayWindow) {
        announceInputChanges(knownInputs, inputs)
      }

      knownInputs = inputs
    }

    const bootstrap = async () => {
      try {
        const [stateResult, inputsResult, sessions] = await Promise.all([
          getState(),
          listInputs(),
          listAudioSessions(),
        ])

        if (cancelled) {
          return
        }

        if (typeof stateResult.lastControl === "number" && typeof stateResult.lastValue === "number") {
          setControlPosition(stateResult.lastControl, stateResult.lastValue)
        }

        // Whatever the settings say, this is the chain actually in force.
        setActiveCurve(stateResult.curve)
        adoptInputs(inputsResult.inputs)
        rememberApps(sessions)

        setRuntime((current) => ({
          ...current,
          selectedInput: stateResult.selected,
          midiInputs: inputsResult.inputs,
          audioSessions: sessions,
          audioSessionsLoaded: true,
        }))
      } catch {
        if (!cancelled) {
          setRuntime((current) => ({
            ...current,
            midiInputs: [],
            audioSessions: [],
            audioSessionsLoaded: true,
          }))
        }
      }
    }

    const subscribe = async () => {
      // Straight into the store, never into React state: this fires once per MIDI
      // message, and the position needs to land before the audio thread has
      // finished moving anything.
      const unlistenControl = await listen<ControlUpdateEvent>("control:update", (event) => {
        const payload = event.payload

        if (typeof payload?.control !== "number") {
          return
        }

        const value = typeof payload.value === "number" ? payload.value : 0
        const volume =
          typeof payload.volume === "number" ? payload.volume : controlValueToPercent(value)

        setControlPosition(payload.control, value, volume)
      })

      // The backend sends these to the overlay window only, but a plain `listen`
      // hears events sent to any window, so the main window has to opt out
      // itself. Otherwise each frame (an icon per app) re-renders it for nothing.
      const unlistenOverlay = isOverlayWindow
        ? await listen<OverlayUpdateEvent>("overlay:update", (event) => {
            const payload = event.payload

            if (typeof payload?.control !== "number") {
              return
            }

            const value = typeof payload.value === "number" ? payload.value : 0
            const volume =
              typeof payload.volume === "number" ? payload.volume : controlValueToPercent(value)

            setRuntime((current) => ({
              ...current,
              overlays: {
                ...current.overlays,
                [payload.control]: {
                  control: payload.control,
                  value,
                  percent: clampPercent(volume),
                  apps: Array.isArray(payload.apps) ? payload.apps : [],
                },
              },
            }))
          })
        : () => {}

      if (cancelled) {
        unlistenControl()
        unlistenOverlay()
        return
      }

      listenerCleanupRef.current.push(unlistenControl, unlistenOverlay)
    }

    let runningKey: string | null = null

    // Kept apart from the device and session poll, so a failure here can't take
    // those lists down with it.
    const refreshRunningApps = async () => {
      try {
        const names = await listRunningProcessNames()

        if (cancelled) {
          return
        }

        const apps = Array.from(new Set(names.map(normalizeAppName))).sort()
        const key = apps.join("\n")

        // The process list rarely changes between polls, and republishing an
        // identical set would re-render everything reading this context.
        if (key === runningKey) {
          return
        }

        runningKey = key
        setRuntime((current) => ({ ...current, runningApps: new Set(apps) }))
      } catch {
        // Without it, an open but silent app reads as not running until the
        // next poll succeeds.
      }
    }

    const stopListening = () => {
      cancelled = true
      listenerCleanupRef.current.forEach((cleanup) => cleanup())
      listenerCleanupRef.current = []
    }

    void subscribe()

    // Devices and audio sessions are the main window's business. Each poll is a
    // command run on the main thread, the same thread that delivers the overlay
    // its events, so the overlay polling too only gave those events more to wait
    // behind.
    if (isOverlayWindow) {
      return stopListening
    }

    void bootstrap()
    void refreshRunningApps()

    const pollTimer = window.setInterval(() => {
      void refreshRunningApps()

      void (async () => {
        try {
          const [inputsResult, sessions] = await Promise.all([listInputs(), listAudioSessions()])

          if (cancelled) {
            return
          }

          adoptInputs(inputsResult.inputs)
          // Where each app playing sound lives, and how it looks, for when it
          // isn't running.
          rememberApps(sessions)
          setRuntime((current) => ({
            ...current,
            midiInputs: inputsResult.inputs,
            audioSessions: sessions,
            audioSessionsLoaded: true,
          }))
        } catch {
          if (!cancelled) {
            setRuntime((current) => ({
              ...current,
              midiInputs: [],
              audioSessions: [],
              audioSessionsLoaded: true,
            }))
          }
        }
      })()
    }, POLL_INTERVAL_MS)

    return () => {
      window.clearInterval(pollTimer)
      stopListening()
    }
  }, [])

  return <VolconContext.Provider value={runtime}>{children}</VolconContext.Provider>
}

export function useVolconRuntime() {
  const context = useContext(VolconContext)

  if (!context) {
    throw new Error("useVolconRuntime must be used within VolconProvider")
  }

  return context
}

/** The latest apps and level for each control the overlay has heard about. */
export function useOverlaySnapshots() {
  const { overlays } = useVolconRuntime()
  return overlays
}

export function useMidiInputs() {
  const { midiInputs } = useVolconRuntime()
  return midiInputs
}

export function useAudioSessions() {
  const { audioSessions } = useVolconRuntime()
  return audioSessions
}

/** Whether the audio sessions have been read yet, whatever was found. */
export function useAudioSessionsLoaded() {
  const { audioSessionsLoaded } = useVolconRuntime()
  return audioSessionsLoaded
}

export function useRunningApps() {
  const { runningApps } = useVolconRuntime()
  return runningApps
}

export { getControlPosition, useControlPercent } from "@/lib/control-volume-store"
