"use client"

import { createContext, useContext } from "react"

import type { SettingsConfig, SettingsConfigUpdate } from "./settings-config"

export type SettingsHighlight = {
  /** The setting to bring into view and flash. */
  id: string
  /** Changes each time, so picking the same result twice flashes it twice. */
  nonce: number
}

export type SettingsContextValue = {
  config: SettingsConfig
  updateConfig: SettingsConfigUpdate
  highlight: SettingsHighlight | null
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

export const SettingsProvider = SettingsContext.Provider

/** The settings being edited on the settings screen, and how to change them. */
export function useSettings() {
  const context = useContext(SettingsContext)

  if (!context) {
    throw new Error("useSettings must be used inside the settings screen")
  }

  return context
}
