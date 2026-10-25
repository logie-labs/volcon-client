"use client"

import { useRef, useState } from "react"
import {
  RiDeleteBin6Line,
  RiDownload2Line,
  RiLinkUnlinkM,
  RiResetLeftLine,
  RiUpload2Line,
} from "@remixicon/react"

import {
  resetAllAssignments,
  resetAllPresets,
  restorePresetConfig,
  savedAssignmentCount,
  type AssignmentCount,
} from "@/components/sections/mapping/mapping"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  discardUpdateDownload,
  revealInExplorer,
  saveSettingsBackup,
  setLaunchAtSignIn,
} from "@/lib/bridge-client"
import { toast } from "@/lib/notifications"

import { settingChanges } from "../setting-changes"
import { useSettings } from "../settings-context"
import {
  createDefaultSettingsConfig,
  justResetKey,
  normalizeSettingsConfig,
  saveSettingsConfig,
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

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`

type Confirming = "settings" | "assignments" | "everything"

export function BackupSection() {
  const { config, updateConfig } = useSettings()
  const fileInput = useRef<HTMLInputElement>(null)
  const [confirming, setConfirming] = useState<Confirming | null>(null)
  // Which question the dialog asks, kept while it closes so its words don't
  // vanish mid-fade.
  const [asking, setAsking] = useState<Confirming>("settings")
  const [assigned, setAssigned] = useState<AssignmentCount | null>(null)
  const [wiping, setWiping] = useState(false)
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
    setConfirming(null)
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

  const ask = (which: Confirming) => {
    setAsking(which)
    setConfirming(which)
  }

  /** Counted first, so the question can say what would go. */
  const askToResetAssignments = async () => {
    let count: AssignmentCount

    try {
      count = await savedAssignmentCount()
    } catch (error) {
      toast.error("Couldn't read your mappings", {
        source: "settings",
        detail: reason(error),
        event: { type: "action-failed", attempted: "Count the apps on your controls", reason: reason(error) },
      })
      return
    }

    if (count.apps === 0) {
      toast.info("Nothing to reset", {
        source: "settings",
        description: "No control has an app on it, on any preset.",
      })
      return
    }

    setAssigned(count)
    ask("assignments")
  }

  const resetAssignments = async () => {
    setConfirming(null)

    try {
      const { previous, count } = await resetAllAssignments()
      const apps = plural(count.apps, "app")
      const across = count.presets > 1 ? ` across ${plural(count.presets, "preset")}` : ""

      toast.success("Assignments reset", {
        source: "settings",
        description: `${apps} taken off ${plural(count.controls, "control")}${across}, and handed back to Windows.`,
        undo: () => {
          restorePresetConfig(previous)

          return {
            done: true,
            title: "Assignments put back",
            description: `${apps} back where ${count.apps === 1 ? "it was" : "they were"}.`,
          }
        },
      })
    } catch (error) {
      toast.error("Couldn't reset assignments", {
        source: "settings",
        detail: reason(error),
        event: { type: "action-failed", attempted: "Take every app off every control", reason: reason(error) },
      })
    }
  }

  /**
   * Back to a fresh install: no presets, every setting at its default, and
   * nothing remembered. Launch with Windows goes back to how Volcon ships, a
   * downloaded update goes, and Volcon reloads to start clean.
   */
  const resetEverything = async () => {
    setConfirming(null)
    setWiping(true)

    try {
      await resetAllPresets()

      if (process.env.NODE_ENV === "production") {
        await setLaunchAtSignIn(createDefaultSettingsConfig().startup.launchOnStartup).catch(() => {})
      }

      await discardUpdateDownload().catch(() => {})
      // Sent on to the overlay and the backend before what Volcon remembers is
      // cleared.
      saveSettingsConfig(createDefaultSettingsConfig())
      window.localStorage.clear()
      window.sessionStorage.setItem(justResetKey, "1")
      window.location.reload()
    } catch (error) {
      setWiping(false)
      toast.error("Couldn't reset everything", {
        source: "settings",
        detail: reason(error),
        event: { type: "action-failed", attempted: "Reset Volcon to a fresh install", reason: reason(error) },
      })
    }
  }

  const confirmation = {
    settings: {
      title: "Reset settings?",
      description:
        "Every setting goes back to how Volcon ships, including the controller curve, deadzone and startup options. Your mappings and presets stay as they are.",
      button: "Reset settings",
      run: resetAll,
    },
    assignments: {
      title: "Reset assignments?",
      description: assigned
        ? `This takes ${plural(assigned.apps, "app")} off ${plural(assigned.controls, "control")}${assigned.presets > 1 ? `, across ${plural(assigned.presets, "preset")}` : ""}, and hands them back to Windows. Your presets, and the controls you've learned, stay ready for new apps. You can undo it from the notification.`
        : "",
      button: "Reset assignments",
      run: () => void resetAssignments(),
    },
    everything: {
      title: "Reset everything?",
      description:
        "Volcon goes back to how it was when you installed it: every setting, preset and mapping, the notification history, and what it remembers about your apps. Launch with Windows goes back on, as after installing. This can't be undone, so export your settings first if you might want them back.",
      button: "Reset everything",
      run: () => void resetEverything(),
    },
  }[asking]

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
          disabledReason="Every setting is already at its default."
        >
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={pristine}
            onClick={() => ask("settings")}
          >
            <RiResetLeftLine />
            Reset settings…
          </Button>
        </SettingAction>
        <SettingAction id="backup.resetAssignments">
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => void askToResetAssignments()}
          >
            <RiLinkUnlinkM />
            Reset assignments…
          </Button>
        </SettingAction>
        <SettingAction id="backup.resetEverything">
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={wiping}
            onClick={() => ask("everything")}
          >
            <RiDeleteBin6Line />
            {wiping ? "Resetting…" : "Reset everything…"}
          </Button>
        </SettingAction>
      </SettingsGroup>

      <Dialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{confirmation.title}</DialogTitle>
            <DialogDescription>{confirmation.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirming(null)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={confirmation.run}>
              {confirmation.button}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsPage>
  )
}
