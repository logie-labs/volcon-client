"use client"

import { useMemo } from "react"

import {
  RiCompass3Line,
  RiNotificationOffLine,
  RiEqualizer3Line,
  RiLayout2Line,
  RiPaintBrushLine,
  RiShutDownLine,
} from "@remixicon/react"

import {
  loadSettingsConfig,
  requestSettingsSection,
  saveSettingsConfig,
  type SettingsConfig,
} from "@/components/sections/settings/settings-config"
import { settingsSections } from "@/components/sections/settings/settings-registry"
import { sectionLabels, type SectionKey } from "@/components/sections/index"
import { clearNotifications } from "@/lib/notifications"

import type { CommandOption, CommandTokens, PaletteCommand } from "./types"

type AppCommandsInput = {
  setSection: (section: SectionKey) => void
}

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

/** Reads, edits and republishes the stored settings in one go. */
function editSettings(edit: (current: SettingsConfig) => SettingsConfig) {
  saveSettingsConfig(edit(loadSettingsConfig()))
}

const onOffOptions: CommandOption[] = [
  { id: "on", label: "On", group: "State" },
  { id: "off", label: "Off", group: "State" },
]

function isOn(tokens: CommandTokens, index: number) {
  return tokens[index]?.[0]?.id === "on"
}

/**
 * Commands that belong to the app as a whole rather than to one screen: moving
 * between screens, and the settings people reach for often enough that digging
 * through the settings tree for them is a chore.
 */
export function useAppCommands({ setSection }: AppCommandsInput) {
  return useMemo<PaletteCommand[]>(
    () => [
      {
        id: "app.go",
        name: "Go",
        description: "Jump to a screen",
        keywords: ["navigate", "open", "switch", "screen", "section"],
        group: "Navigate",
        icon: <RiCompass3Line className="text-muted-foreground" />,
        args: [
          {
            name: "screen",
            placeholder: "Go where?",
            options: () => [
              ...Object.entries(sectionLabels).map<CommandOption>(([key, label]) => ({
                id: `section:${key}`,
                label: titleCase(label),
                group: "Screens",
              })),
              ...settingsSections.map<CommandOption>((section) => ({
                id: `settings:${section.id}`,
                label: section.title,
                hint: "Settings",
                keywords: [section.description],
                group: "Settings",
              })),
            ],
          },
        ],
        run: (tokens) => {
          const target = tokens[0]?.[0]?.id

          if (!target) {
            return
          }

          const [kind, id] = target.split(":")

          if (kind === "section") {
            setSection(id as SectionKey)
            return
          }

          // Shown straight away if Settings is open, and opened on if it isn't -
          // whether or not it would reopen the last page.
          requestSettingsSection(id)
          setSection("settings")
        },
      },
      {
        id: "app.clear-notifications",
        name: "Clear notifications",
        description: "Empty the notification log",
        keywords: ["notifications", "messages", "log", "history", "toasts", "dismiss"],
        group: "Notifications",
        icon: <RiNotificationOffLine className="text-muted-foreground" />,
        run: () => clearNotifications(),
      },
      {
        id: "settings.theme",
        name: "Theme",
        description: "Switch between light and dark",
        keywords: ["appearance", "dark", "light", "system", "colour", "color"],
        group: "Settings",
        icon: <RiPaintBrushLine className="text-muted-foreground" />,
        args: [
          {
            name: "theme",
            placeholder: "Which theme?",
            options: () =>
              (["system", "light", "dark"] as const).map((theme) => ({
                id: theme,
                label: titleCase(theme),
                hint: loadSettingsConfig().appearance.theme === theme ? "current" : undefined,
                group: "Theme",
              })),
          },
        ],
        run: (tokens) => {
          const theme = tokens[0]?.[0]?.id as SettingsConfig["appearance"]["theme"] | undefined

          if (!theme) {
            return
          }

          editSettings((current) => ({ ...current, appearance: { ...current.appearance, theme } }))
        },
      },
      {
        id: "settings.logarithmic",
        name: "Logarithmic",
        description: "Bend the controller response so the quiet end gets more travel",
        keywords: ["log", "curve", "sensitivity", "taper", "scale", "controller", "volume"],
        group: "Settings",
        icon: <RiEqualizer3Line className="text-muted-foreground" />,
        args: [
          {
            name: "state",
            placeholder: "Logarithmic response on or off?",
            options: () => {
              const { enabled } = loadSettingsConfig().controller.logarithmicSensitivity

              return onOffOptions.map((option) => ({
                ...option,
                hint: option.id === (enabled ? "on" : "off") ? "current" : undefined,
              }))
            },
          },
          {
            name: "strength",
            placeholder: "Strength, or Enter to keep the current one",
            optional: true,
            options: () => {
              const { strength } = loadSettingsConfig().controller.logarithmicSensitivity

              return [10, 25, 50, 75, 100].map<CommandOption>((value) => ({
                id: String(value),
                label: `${value}%`,
                hint: value === strength ? "current" : undefined,
                group: "Strength",
              }))
            },
            freeText: (value) => {
              const parsed = Number(value.replace("%", "").trim())

              if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
                return null
              }

              return {
                id: String(Math.round(parsed)),
                label: `${Math.round(parsed)}%`,
                group: "Strength",
              }
            },
          },
        ],
        run: (tokens) => {
          const enabled = isOn(tokens, 0)
          const rawStrength = tokens[1]?.[0]?.id

          editSettings((current) => ({
            ...current,
            controller: {
              ...current.controller,
              logarithmicSensitivity: {
                enabled,
                strength: rawStrength
                  ? Number(rawStrength)
                  : current.controller.logarithmicSensitivity.strength,
              },
            },
          }))
        },
      },
      {
        id: "settings.overlay-position",
        name: "Overlay",
        description: "Move the volume overlay to another corner",
        keywords: ["corner", "position", "hud", "popup"],
        group: "Settings",
        icon: <RiLayout2Line className="text-muted-foreground" />,
        args: [
          {
            name: "corner",
            placeholder: "Which corner?",
            options: () => {
              const current = loadSettingsConfig().overlay.position

              return (
                ["top-left", "top-right", "bottom-left", "bottom-right"] as const
              ).map<CommandOption>((position) => ({
                id: position,
                label: titleCase(position.replace("-", " ")),
                hint: position === current ? "current" : undefined,
                group: "Corner",
              }))
            },
          },
        ],
        run: (tokens) => {
          const position = tokens[0]?.[0]?.id as SettingsConfig["overlay"]["position"] | undefined

          if (!position) {
            return
          }

          editSettings((current) => ({ ...current, overlay: { ...current.overlay, position } }))
        },
      },
      {
        id: "settings.startup",
        name: "Startup",
        description: "Change how Volcon comes up",
        keywords: ["launch", "boot", "tray", "autostart", "reopen"],
        group: "Settings",
        icon: <RiShutDownLine className="text-muted-foreground" />,
        args: [
          {
            name: "behaviour",
            placeholder: "Which startup behaviour?",
            options: () => {
              const { startup } = loadSettingsConfig()

              return [
                {
                  id: "launchOnStartup",
                  label: "Launch on startup",
                  on: startup.launchOnStartup,
                },
                { id: "openToTray", label: "Open to tray", on: startup.openToTray },
                {
                  id: "reopenLastSection",
                  label: "Reopen last screen",
                  on: startup.reopenLastSection,
                },
              ].map<CommandOption>((entry) => ({
                id: entry.id,
                label: entry.label,
                hint: entry.on ? "on" : "off",
                group: "Startup",
              }))
            },
          },
          {
            name: "state",
            placeholder: "On or off?",
            options: () => onOffOptions,
          },
        ],
        run: (tokens) => {
          const key = tokens[0]?.[0]?.id as keyof SettingsConfig["startup"] | undefined

          if (!key) {
            return
          }

          const enabled = isOn(tokens, 1)

          editSettings((current) => ({
            ...current,
            startup: { ...current.startup, [key]: enabled },
          }))
        },
      },
    ],
    [setSection],
  )
}
