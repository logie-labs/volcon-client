"use client"

import { RiFileCopyLine, RiFolderOpenLine } from "@remixicon/react"

import { Button } from "@/components/ui/button"
import { getDiagnosticsInfo, listInputs, openLogsFolder } from "@/lib/bridge-client"
import { getNotifications, toast, type Notification } from "@/lib/notifications"

import { useSettings } from "../settings-context"
import type { SettingsConfig } from "../settings-config"
import { logLevels } from "../settings-config"
import {
  SettingAction,
  SettingSegmented,
  SettingsGroup,
  SettingsPage,
  SettingSwitch,
} from "./settings-primitives"

const logLevelLabels: Record<(typeof logLevels)[number], string> = {
  error: "Errors",
  warn: "Warnings",
  info: "Info",
  debug: "Debug",
}

/** The WebView2 runtime's version, from the user agent it reports. */
export function webViewVersion() {
  if (typeof navigator === "undefined") {
    return null
  }

  return navigator.userAgent.match(/Edg\/([\d.]+)/)?.[1] ?? null
}

/** A path with the Windows user folder swapped for its variable, for sharing. */
function withoutUserName(path: string) {
  return path.replace(/^[a-z]:\\users\\[^\\]+/i, "%USERPROFILE%")
}

function describeError(entry: Notification) {
  const when = new Date(entry.at).toISOString()
  const summary = entry.description ? ` - ${entry.description}` : ""
  const detail = entry.detail ? `\n    ${entry.detail.replace(/\n/g, "\n    ")}` : ""

  return `- ${when} [${entry.source}] ${entry.title}${summary}${detail}`
}

/**
 * Everything a bug report should start with, as plain text: versions, the
 * controller, the settings, and whatever went wrong lately. Comes with a list
 * of what's in it, for the notification saying it was copied.
 */
async function collectDiagnostics(config: SettingsConfig) {
  const [info, inputs] = await Promise.all([
    getDiagnosticsInfo().catch(() => null),
    listInputs().catch(() => null),
  ])
  const errors = getNotifications()
    .filter((entry) => entry.kind === "error")
    .slice(0, 10)

  const midi = !inputs
    ? ["- couldn't list them"]
    : inputs.inputs.length === 0
      ? ["- none connected"]
      : inputs.inputs.map((name) => `- ${name}${name === inputs.selected ? " (in use)" : ""}`)

  const text = [
    `Volcon ${info?.appVersion ?? "unknown"}`,
    `Tauri ${info?.tauriVersion ?? "unknown"}`,
    `WebView2 ${webViewVersion() ?? "unknown"}`,
    `OS ${info?.os ?? "unknown"}`,
    `Logs ${info?.logDir ? withoutUserName(info.logDir) : "unknown"}`,
    `Logging ${config.diagnostics.logLevel}${config.diagnostics.verboseLogging ? ", verbose" : ""}`,
    "",
    "MIDI inputs:",
    ...midi,
    "",
    "Recent errors:",
    ...(errors.length > 0 ? errors.map(describeError) : ["- none"]),
    "",
    "Settings:",
    JSON.stringify(config, null, 2),
  ].join("\n")

  const inputCount = inputs?.inputs.length ?? 0
  const contents = [
    "The versions of Volcon, Tauri, WebView2 and Windows",
    "Where the logs are kept, with your user name left out, and how much they record",
    !inputs
      ? "A note that the MIDI inputs couldn't be listed"
      : `The MIDI inputs Volcon can see: ${inputCount === 0 ? "none" : inputCount}`,
    errors.length === 0
      ? "A note that nothing has gone wrong lately"
      : `The last ${errors.length === 1 ? "error" : `${errors.length} errors`}, with what each said`,
    "Every setting",
  ]

  return { text, contents }
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return
  } catch {
    // Some webviews only allow the clipboard from a text field.
  }

  const field = document.createElement("textarea")
  field.value = text
  field.style.position = "fixed"
  field.style.opacity = "0"
  document.body.append(field)
  field.select()

  const copied = document.execCommand("copy")
  field.remove()

  if (!copied) {
    throw new Error("The clipboard isn't available.")
  }
}

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function DiagnosticsSection() {
  const { config } = useSettings()

  const openLogs = () => {
    void openLogsFolder().catch((error: unknown) => {
      toast.error("Couldn't open the log folder", {
        source: "settings",
        detail: reason(error),
        event: { type: "action-failed", attempted: "Open the folder Volcon keeps its logs in", reason: reason(error) },
      })
    })
  }

  const copyInfo = async () => {
    try {
      const { text, contents } = await collectDiagnostics(config)
      await copyText(text)
      toast.success("Diagnostic info copied", {
        source: "settings",
        description: "Paste it into your bug report.",
        event: { type: "copied", what: "Diagnostic info", contents },
      })
    } catch (error) {
      toast.error("Couldn't copy diagnostic info", {
        source: "settings",
        detail: reason(error),
        event: {
          type: "action-failed",
          attempted: "Copy diagnostic info to the clipboard",
          reason: reason(error),
          hint: "Another app may be holding the clipboard. Try again in a moment.",
        },
      })
    }
  }

  return (
    <SettingsPage id="diagnostics">
      <SettingsGroup title="Logging">
        <SettingSegmented
          path="diagnostics.logLevel"
          options={logLevels.map((level) => ({ value: level, label: logLevelLabels[level] }))}
        />
        <SettingSwitch path="diagnostics.verboseLogging" />
        <SettingAction id="diagnostics.openLogs">
          <Button type="button" variant="outline" size="sm" onClick={openLogs}>
            <RiFolderOpenLine />
            Open folder
          </Button>
        </SettingAction>
      </SettingsGroup>
      <SettingsGroup title="Support">
        <SettingAction id="diagnostics.copyInfo">
          <Button type="button" variant="outline" size="sm" onClick={() => void copyInfo()}>
            <RiFileCopyLine />
            Copy
          </Button>
        </SettingAction>
      </SettingsGroup>
    </SettingsPage>
  )
}
