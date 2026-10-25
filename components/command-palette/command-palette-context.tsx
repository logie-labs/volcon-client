"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react"

import type { CommandSeed, PaletteCommand } from "./types"

/**
 * A registry rather than a fixed list: any section contributes the commands it
 * knows how to run, and the palette is just the surface that finds and drives
 * them. Adding an app to a control is one such registration, not a special case
 * the palette knows about.
 */
type CommandPaletteContextValue = {
  /** Contributes (or with `null`, withdraws) one source's commands. */
  register: (sourceId: string, commands: PaletteCommand[] | null) => void
  open: (seed?: CommandSeed) => void
  close: () => void
  /** Opens if shut, shuts if open — what a single keyboard chord should do. */
  toggle: (seed?: CommandSeed) => void
  /** Re-render on registration changes. Only the palette itself needs this. */
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => number
  getCommands: () => PaletteCommand[]
  getSeed: () => CommandSeed | null
  isOpen: () => boolean
}

const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(null)

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  // Registrations live in a ref and publish through a version counter, so a
  // section re-registering never re-renders the section — only the palette,
  // which is the one thing that reads them.
  const registrations = useRef(new Map<string, PaletteCommand[]>())
  // Flattened once per registration change, so the palette gets the same array
  // back until something actually re-registers and can tell when that happens.
  const flattened = useRef<PaletteCommand[] | null>(null)
  const listeners = useRef(new Set<() => void>())
  const version = useRef(0)
  const openState = useRef(false)
  const seed = useRef<CommandSeed | null>(null)

  const publish = useCallback(() => {
    version.current += 1

    for (const listener of listeners.current) {
      listener()
    }
  }, [])

  const value = useMemo<CommandPaletteContextValue>(
    () => ({
      register: (sourceId, commands) => {
        if (commands === null) {
          registrations.current.delete(sourceId)
        } else {
          registrations.current.set(sourceId, commands)
        }

        flattened.current = null
        publish()
      },
      open: (nextSeed) => {
        seed.current = nextSeed ?? null
        openState.current = true
        publish()
      },
      close: () => {
        seed.current = null
        openState.current = false
        publish()
      },
      toggle: (nextSeed) => {
        const nextOpen = !openState.current
        seed.current = nextOpen ? (nextSeed ?? null) : null
        openState.current = nextOpen
        publish()
      },
      subscribe: (listener) => {
        listeners.current.add(listener)

        return () => {
          listeners.current.delete(listener)
        }
      },
      getSnapshot: () => version.current,
      getCommands: () =>
        (flattened.current ??= Array.from(registrations.current.values()).flat()),
      getSeed: () => seed.current,
      isOpen: () => openState.current,
    }),
    [publish],
  )

  return <CommandPaletteContext.Provider value={value}>{children}</CommandPaletteContext.Provider>
}

function useCommandPaletteContext() {
  const context = useContext(CommandPaletteContext)

  if (!context) {
    throw new Error("useCommandPalette must be used within CommandPaletteProvider")
  }

  return context
}

/**
 * Opening and closing the palette. Every function here is stable, so a component
 * that only launches commands never re-renders because of the registry.
 */
export function useCommandPalette() {
  const { open, close, toggle } = useCommandPaletteContext()

  return useMemo(() => ({ open, close, toggle }), [open, close, toggle])
}

/**
 * Contributes commands for as long as the caller is mounted.
 *
 * `commands` must be memoized on the data it closes over — the same contract as
 * a dependency array. A fresh array every render costs a palette re-render, not
 * a loop.
 */
export function useRegisterCommands(commands: PaletteCommand[]) {
  const { register } = useCommandPaletteContext()
  const sourceId = useId()

  useEffect(() => {
    register(sourceId, commands)

    return () => register(sourceId, null)
  }, [register, sourceId, commands])
}

/** The live registry, for the palette itself. */
export function useCommandRegistry() {
  const context = useCommandPaletteContext()

  useSyncExternalStore(context.subscribe, context.getSnapshot, () => 0)

  return {
    commands: context.getCommands(),
    isOpen: context.isOpen(),
    seed: context.getSeed(),
    open: context.open,
    close: context.close,
    toggle: context.toggle,
  }
}
