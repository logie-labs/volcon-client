"use client"

import { useRef, useState } from "react"
import { RiDownload2Line, RiResetLeftLine, RiUpload2Line } from "@remixicon/react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { revealInExplorer, saveSettingsBackup } from "@/lib/bridge-client"
import { toast } from "@/lib/notifications"

import { settingChanges } from "../setting-changes"
import { useSettings } from "../settings-context"
import {
  createDefaultSettingsConfig,
  normalizeSettingsConfig,
  type SettingsConfig,
} from "../settings-config"
import { allDefault, allSettingPaths } from "../settings-schema"
import { undoSettingsChange } from "../settings-undo"
import { SettingAction, SettingsGroup, SettingsPage } from "./settings-primitives"

const settingsSections = [
  "appearance",
  "overlay",
  "notifications",
  "mapping",
  "startup",
  "controller",
  "diagnostics",
] as const

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * The settings in a backup: the `settings` of a file exported from here, or a
 * bare settings object. Anything without a single section Volcon knows is not
 * settings at all.
 */
function settingsIn(parsed: unknown): Partial<SettingsConfig> | null {
  const candidate = isRecord(parsed) && isRecord(parsed.settings) ? parsed.settings : parsed

  if (!isRecord(candidate) || !settingsSections.some((key) => isRecord(candidate[key]))) {
    return null
  }

  return candidate as Partial<SettingsConfig>
}

/** Today as YYYY-MM-DD, in local time - what the file name should say. */
function today() {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, "0")

  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function BackupSection() {
  const { config, updateConfig } = useSettings()
  const fileInput = useRef<HTMLInputElement>(null)
  const [confirmingReset, setConfirmingReset] = useState(false)
  const pristine = allDefault(config)

  const exportSettings = async () => {
    const contents = JSON.stringify(
      { app: "volcon", exportedAt: new Date().toISOString(), settings: config },
      null,
      2
    )

    try {
      const path = await saveSettingsBackup(`volcon-settings-${today()}.json`, contents)
      const name = path.split(/[\\/]/).pop() ?? path

      toast.success("Settings exported", {
        source: "settings",
        description: `Saved as ${name} in Downloads.`,
        detail: path,
        event: { type: "file-saved", file: name, path },
        action: {
          label: "Show in folder",
          onClick: () => {
            void revealInExplorer(path).catch((error: unknown) => {
              toast.error("Couldn't show the backup", {
                source: "settings",
                detail: reason(error),
                event: {
                  type: "action-failed",
                  attempted: "Show the backup in its folder",
                  reason: reason(error),
                  hint: "It may have been moved or deleted since it was saved.",
                  target: { kind: "path", value: path },
                },
              })
            })
          },
        },
      })
    } catch (error) {
      toast.error("Couldn't export settings", {
        source: "settings",
        detail: reason(error),
        event: {
          type: "action-failed",
          attempted: "Save a backup of your settings to Downloads",
          reason: reason(error),
        },
      })
    }
  }

  const importSettings = async (file: File) => {
    let parsed: unknown

    try {
      parsed = JSON.parse(await file.text())
    } catch {
      toast.error("Couldn't import settings", {
        source: "settings",
        description: `${file.name} isn't a settings backup.`,
        detail: "The file isn't valid JSON.",
        event: {
          type: "action-failed",
          attempted: "Import settings from a backup",
          reason: "The file isn't valid JSON, so it can't be a backup Volcon made.",
          hint: "Pick a file exported from Settings → Backup & reset. Nothing was changed.",
          target: { kind: "file", value: file.name },
        },
      })
      return
    }

    const imported = settingsIn(parsed)

    if (!imported) {
      toast.error("Couldn't import settings", {
        source: "settings",
        description: `${file.name} doesn't contain Volcon settings.`,
        event: {
          type: "action-failed",
          attempted: "Import settings from a backup",
          reason: "The file is readable, but none of what's in it is Volcon settings.",
          hint: "Pick a file exported from Settings → Backup & reset. Nothing was changed.",
          target: { kind: "file", value: file.name },
        },
      })
      return
    }

    const previous = config
    // Made whole like stored settings are: anything missing or out of range in
    // the file takes its default, and older names are carried over.
    const next = normalizeSettingsConfig(imported)

    updateConfig(() => next)
    toast.success("Settings imported", {
      source: "settings",
      description: `Your settings now match ${file.name}.`,
      event: { type: "settings-changed", how: "imported", file: file.name, changes: settingChanges(previous, next) },
      undo: () =>
        undoSettingsChange({
          paths: allSettingPaths(),
          before: previous,
          after: next,
          change: `importing ${file.name}`,
          afterLabel: "Imported",
          undid: `${file.name} was imported`,
          doneTitle: "Settings put back",
        }),
    })
  }

  const resetAll = () => {
    const previous = config
    const next = createDefaultSettingsConfig()

    updateConfig(() => next)
    setConfirmingReset(false)
    toast.success("Settings reset", {
      source: "settings",
      description: "Every setting is back to how Volcon ships.",
      event: { type: "settings-changed", how: "reset", changes: settingChanges(previous, next) },
      undo: () =>
        undoSettingsChange({
          paths: allSettingPaths(),
          before: previous,
          after: next,
          change: "the reset",
          afterLabel: "Reset to",
          undid: "every setting was reset",
          doneTitle: "Settings put back",
        }),
    })
  }

  return (
    <SettingsPage id="backup">
      <SettingsGroup title="Backup">
        <SettingAction id="backup.export">
          <Button type="button" variant="outline" size="sm" onClick={() => void exportSettings()}>
            <RiDownload2Line />
            Export
          </Button>
        </SettingAction>
        <SettingAction id="backup.import">
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              // So choosing the same file again still counts as a choice.
              event.target.value = ""

              if (file) {
                void importSettings(file)
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInput.current?.click()}
          >
            <RiUpload2Line />
            Import…
          </Button>
        </SettingAction>
      </SettingsGroup>
      <SettingsGroup title="Reset">
        <SettingAction
          id="backup.resetAll"
          disabled={pristine}
          disabledReason="Everything is already at its default."
        >
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={pristine}
            onClick={() => setConfirmingReset(true)}
          >
            <RiResetLeftLine />
            Reset all…
          </Button>
        </SettingAction>
      </SettingsGroup>

      <Dialog open={confirmingReset} onOpenChange={setConfirmingReset}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Reset all settings?</DialogTitle>
            <DialogDescription>
              Every setting goes back to how Volcon ships, including the controller curve,
              deadzone and startup options. Your mappings and presets stay as they are.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmingReset(false)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={resetAll}>
              Reset all settings
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsPage>
  )
}
