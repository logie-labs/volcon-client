import type { SettingChange } from "@/lib/notification-events"

import type { SettingsConfig } from "./settings-config"
import { getSetting, settingEntries, settingsPages, type SettingPath } from "./settings-schema"

/** The words Settings uses for each choice, where a value isn't a word already. */
const choiceLabels: Partial<Record<SettingPath, Record<string, string>>> = {
  "appearance.theme": { system: "System", light: "Light", dark: "Dark" },
  "overlay.position": {
    "top-left": "Top left",
    "top-right": "Top right",
    "bottom-left": "Bottom left",
    "bottom-right": "Bottom right",
  },
  "notifications.titleBarLevel": { all: "All", warnings: "Warnings", errors: "Errors" },
  "diagnostics.logLevel": { error: "Errors", warn: "Warnings", info: "Info", debug: "Debug" },
}

const pixels = (value: number) => `${value}px`
const percent = (value: number) => `${Math.round(value)}%`
const seconds = (milliseconds: number) => `${Number((milliseconds / 1000).toFixed(1))} s`

/** How Settings writes each number beside its slider. */
const numberFormats: Partial<Record<SettingPath, (value: number) => string>> = {
  "overlay.edgeMargin": pixels,
  "overlay.cardGap": pixels,
  "overlay.scale": (scale) => `${Number(scale.toFixed(2))}×`,
  "overlay.fadeDelayMs": seconds,
  "overlay.hoverOpacity": percent,
  "notifications.displayTimeMs": seconds,
  "controller.logarithmicSensitivity.strength": percent,
  "controller.deadzone": (deadzone) => (deadzone === 0 ? "Off" : `${deadzone}%`),
}

/** A setting's value as Settings shows it: "On", "Top left", "1.5 s", "120%". */
export function formatSettingValue(path: SettingPath, value: unknown): string {
  if (typeof value === "boolean") {
    return value ? "On" : "Off"
  }

  if (typeof value === "number") {
    return numberFormats[path]?.(value) ?? String(value)
  }

  if (typeof value === "string") {
    return choiceLabels[path]?.[value] ?? value
  }

  return String(value)
}

const pageTitles = new Map(settingsPages.map((page) => [page.id, page.title]))

/**
 * The settings that differ between `before` and `after`, in the order Settings
 * lists them - only those in `paths`, when given.
 */
export function settingChanges(
  before: SettingsConfig,
  after: SettingsConfig,
  paths?: readonly SettingPath[]
): SettingChange[] {
  const wanted = paths ? new Set(paths) : null

  return settingEntries.flatMap((entry) => {
    const path = entry.path

    if (!path || (wanted && !wanted.has(path))) {
      return []
    }

    const from = getSetting(before, path)
    const to = getSetting(after, path)

    if (Object.is(from, to)) {
      return []
    }

    return [
      {
        label: entry.label,
        page: pageTitles.get(entry.page) ?? entry.page,
        before: formatSettingValue(path, from),
        after: formatSettingValue(path, to),
      },
    ]
  })
}
