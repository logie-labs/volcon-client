"use client"

import { AnimatePresence, motion } from "framer-motion"
import { useCallback, useEffect, useMemo, useState } from "react"
import { isEnabled } from "@tauri-apps/plugin-autostart"

import { ScrollArea } from "@/components/ui/scroll-area"
import { usePageInHistory } from "@/lib/navigation-history"
import { sessionValue, setSessionValue, useSessionState } from "@/lib/session-state"

import { SettingsSearchResults } from "./components/settings-search-results"
import { SettingsSidebar } from "./components/settings-sidebar"
import {
  activeSettingsSectionStorageKey,
  clearPendingSettingsSection,
  getSettingsSnapshot,
  loadSettingsConfig,
  pendingSettingsSection,
  saveSettingsConfig,
  settingsConfigChangedEvent,
  settingsSectionRequestEvent,
  type SettingsConfig,
  type SettingsConfigUpdate,
} from "./settings-config"
import { SettingsProvider, type SettingsHighlight } from "./settings-context"
import { settingsNavGroups, settingsSectionMap, type SettingsSectionId } from "./settings-registry"
import { isSettingsSectionId, searchSettings, type SettingEntry } from "./settings-schema"

/** Pages that have moved, under the name a stored page might still have. */
const movedSections: Record<string, SettingsSectionId> = {
  "reset-settings": "backup",
}

function toSectionId(value: string | null): SettingsSectionId | null {
  if (isSettingsSectionId(value)) {
    return value
  }

  return value !== null ? (movedSections[value] ?? null) : null
}

/** How long a setting opened from search stays lit up. */
const HIGHLIGHT_MS = 2000

/** Where the page Settings was left on is kept while Volcon is open. */
const sessionPageKey = "settings.page"

/**
 * The page to open on: one just asked for - from the command palette, say -
 * then the one it was left on since Volcon opened, whatever "Reopen where you
 * left off" says, since that's about launching. The first time after launch,
 * it's the page from last time if Settings is to reopen it.
 */
function initialSection(): SettingsSectionId {
  const requested = toSectionId(pendingSettingsSection())

  if (requested) {
    return requested
  }

  const leftOn = toSectionId(sessionValue<string>(sessionPageKey) ?? null)

  if (leftOn) {
    return leftOn
  }

  if (typeof window === "undefined" || !getSettingsSnapshot().startup.reopenLastSection) {
    return "appearance"
  }

  try {
    return toSectionId(window.localStorage.getItem(activeSettingsSectionStorageKey)) ?? "appearance"
  } catch {
    return "appearance"
  }
}

export default function SettingsSection() {
  // A search is kept while Volcon is open, like the page.
  const [query, setQuery] = useSessionState("settings.query", "")
  // Both read before the first render rather than after it, so the screen
  // opens on the right page instead of showing the first one and switching.
  // This screen only ever mounts in the browser - the app always starts on
  // another one - so there's no server render for them to disagree with.
  const [activeId, setActiveId] = useState<SettingsSectionId>(initialSection)
  // Each settings page is a place to go back to.
  usePageInHistory("settings", activeId)
  const [config, setConfig] = useState<SettingsConfig>(loadSettingsConfig)
  const [highlight, setHighlight] = useState<SettingsHighlight | null>(null)

  const updateConfig = useCallback<SettingsConfigUpdate>((updater) => {
    setConfig((current) => updater(current))
  }, [])

  // The requested page is open now; the next visit goes by the usual rules.
  useEffect(() => {
    clearPendingSettingsSection()
  }, [])

  useEffect(() => {
    saveSettingsConfig(config)
  }, [config])

  // A setting changed elsewhere — from the command palette, say. Adopt it only
  // when it actually differs, otherwise this screen's own save would bounce
  // straight back in as a change and loop.
  useEffect(() => {
    const handleConfigChanged = (event: Event) => {
      const next = (event as CustomEvent<SettingsConfig>).detail

      if (!next) {
        return
      }

      setConfig((current) =>
        JSON.stringify(current) === JSON.stringify(next) ? current : next,
      )
    }

    const handleSectionRequest = (event: Event) => {
      const requested = toSectionId((event as CustomEvent<string>).detail)

      if (requested) {
        // Heard while open, so it shouldn't also decide where the next visit
        // starts.
        clearPendingSettingsSection()
        setQuery("")
        setActiveId(requested)
      }
    }

    window.addEventListener(settingsConfigChangedEvent, handleConfigChanged)
    window.addEventListener(settingsSectionRequestEvent, handleSectionRequest)

    return () => {
      window.removeEventListener(settingsConfigChangedEvent, handleConfigChanged)
      window.removeEventListener(settingsSectionRequestEvent, handleSectionRequest)
    }
  }, [setQuery])

  useEffect(() => {
    // For coming back to it while Volcon is open, and for the next launch.
    setSessionValue(sessionPageKey, activeId)

    try {
      window.localStorage.setItem(activeSettingsSectionStorageKey, activeId)
    } catch {
      // Blocked storage: the page just won't be remembered.
    }
  }, [activeId])

  // Windows is the authority on whether Volcon launches with it - the setting
  // can be changed from Task Manager too - so the switch follows what Windows
  // says.
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      return
    }

    let cancelled = false

    const syncAutostartState = async () => {
      try {
        const enabled = await isEnabled()

        if (!cancelled && enabled !== config.startup.launchOnStartup) {
          updateConfig((current) => ({
            ...current,
            startup: { ...current.startup, launchOnStartup: enabled },
          }))
        }
      } catch {
        // Keep the local setting if the plugin is unavailable.
      }
    }

    // Run immediately, then poll the OS every 5s to keep the UI in sync
    void syncAutostartState()
    const intervalId = setInterval(() => {
      void syncAutostartState()
    }, 5000)

    return () => {
      cancelled = true
      clearInterval(intervalId)
    }
  }, [config.startup.launchOnStartup, updateConfig])

  useEffect(() => {
    if (!highlight) {
      return
    }

    const timer = setTimeout(() => setHighlight(null), HIGHLIGHT_MS)
    return () => clearTimeout(timer)
  }, [highlight])

  const searching = query.trim().length > 0
  const results = useMemo(() => searchSettings(query), [query])

  // While searching, the sidebar lists only the pages with a match.
  const navGroups = useMemo(() => {
    if (!searching) {
      return settingsNavGroups
    }

    const pages = new Set(results.map((entry) => entry.page))

    return settingsNavGroups
      .map((group) => ({ ...group, items: group.items.filter((item) => pages.has(item.id)) }))
      .filter((group) => group.items.length > 0)
  }, [results, searching])

  const openSection = (id: SettingsSectionId) => {
    setQuery("")
    setActiveId(id)
  }

  const openResult = (entry: SettingEntry) => {
    setQuery("")
    setActiveId(entry.page)
    setHighlight({ id: entry.id, nonce: Date.now() })
  }

  const activeItem = settingsSectionMap[activeId]

  return (
    <SettingsProvider value={{ config, updateConfig, highlight }}>
      <div className="flex h-full min-h-0 overflow-hidden">
        <SettingsSidebar
          activeId={searching ? null : activeId}
          query={query}
          onQueryChange={setQuery}
          onSubmitQuery={() => {
            if (results[0]) {
              openResult(results[0])
            }
          }}
          onSelectSection={openSection}
          groups={navGroups}
        />

        <div className="relative flex min-w-0 flex-1 overflow-hidden">
          <AnimatePresence>
            <motion.div
              key={searching ? "search" : activeItem.id}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              transition={{ duration: 0.1 }}
              className="absolute inset-0"
            >
              {/* The same scroll area as the mapping grid, rather than the
                  window's own scrollbar. */}
              <ScrollArea className="h-full">
                {/* A readable column, centred in whatever room the window
                    gives it, rather than rows stretched edge to edge. */}
                <div className="mx-auto w-full max-w-200 px-8 py-6">
                  {searching ? (
                    <SettingsSearchResults query={query} results={results} onOpen={openResult} />
                  ) : (
                    <activeItem.component />
                  )}
                </div>
              </ScrollArea>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </SettingsProvider>
  )
}
