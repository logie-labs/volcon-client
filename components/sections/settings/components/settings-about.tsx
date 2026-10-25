"use client"

import { useEffect, useState, type ReactNode } from "react"
import { RiFireLine, RiGithubFill } from "@remixicon/react"

import PixelBlast from "@/components/PixelBlast"
import { Button } from "@/components/ui/button"
import { getDiagnosticsInfo, openExternal, type DiagnosticsInfo, type SourceState } from "@/lib/bridge-client"
import { buildInfo, describeBuildTime, describeCommit } from "@/lib/build-info"
import { toast } from "@/lib/notifications"
import { commitUrl, repositoryUrl } from "@/lib/project"
import { useUpdates } from "@/lib/updates"
import { cn } from "@/lib/utils"
import { appVersion } from "@/lib/version"

import { requestSettingsSection } from "../settings-config"
import { CreditsDialog, ReportProblemDialog, ShortcutsDialog } from "./about-dialogs"
import { webViewVersion } from "./settings-diagnostics"
import { SettingAction, SettingRow, SettingsCard, SettingsGroup } from "./settings-primitives"

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="flex min-w-0 items-center gap-2 truncate font-mono text-xs select-text">{value ?? "-"}</span>
    </div>
  )
}

/**
 * When this was built and from which commit - the commit linking to it on
 * GitHub - so one build can be told from the next.
 */
function BuildDetails({ source }: { source?: SourceState | null }) {
  const { builtAt, development } = buildInfo
  const { commit, shortCommit, changed } = describeCommit(source)

  if (!commit && !builtAt) {
    return "-"
  }

  return (
    <>
      {builtAt ? <span>{describeBuildTime(builtAt)}</span> : null}
      {commit && shortCommit ? (
        <button
          type="button"
          title={`Commit ${commit}, on GitHub`}
          onClick={() => {
            void openExternal(commitUrl(commit)).catch(() => {
              // The hash is there to read and copy either way.
            })
          }}
          className="text-primary underline-offset-2 hover:underline"
        >
          {shortCommit}
        </button>
      ) : null}
      {changed ? (
        <span className="text-amber-600 dark:text-amber-400" title="The code has changes that aren't committed yet">
          + changes
        </span>
      ) : null}
      {development ? <span className="text-muted-foreground">dev</span> : null}
    </>
  )
}

/** Where the update check stands, in a word or two. */
function UpdateSummary() {
  const { checking, result, download, skipped } = useUpdates()

  const [text, tone] = download.phase === "downloading"
    ? [`Downloading ${download.version}, ${download.total > 0 ? Math.floor((download.received / download.total) * 100) : 0}%`, "new"]
    : download.phase === "ready"
    ? [`${download.version} ready to install`, "new"]
    : download.phase === "failed"
    ? [`Couldn't download ${download.version}`, "problem"]
    : checking
    ? ["Checking…", "muted"]
    : result?.status === "available" && skipped === result.latest.version
    ? [`Skipped ${result.latest.version}`, "muted"]
    : !result
      ? ["Not checked yet", "muted"]
      : result.status === "available"
        ? [`${result.latest.version} available`, "new"]
        : result.status === "current"
          ? ["Up to date", "good"]
          : result.status === "unpublished"
            ? ["No releases yet", "muted"]
            : ["Couldn't check", "problem"]

  return (
    <span
      className={cn(
        "font-mono text-xs",
        tone === "new" && "text-primary",
        tone === "good" && "text-foreground",
        tone === "muted" && "text-muted-foreground",
        tone === "problem" && "text-amber-600 dark:text-amber-400"
      )}
    >
      {text}
    </span>
  )
}

export function AboutSection() {
  const [info, setInfo] = useState<DiagnosticsInfo | null>(null)
  const [version, setVersion] = useState<string | null>(null)
  // Only ever rendered in the browser, after the settings have loaded.
  const [webView] = useState(webViewVersion)

  useEffect(() => {
    let cancelled = false

    // The app's own version comes back even from a backend too old to report
    // the rest.
    void appVersion()
      .then((next) => !cancelled && setVersion(next))
      .catch(() => {})
    void getDiagnosticsInfo()
      .then((next) => !cancelled && setInfo(next))
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [])

  const openSource = () => {
    void openExternal(repositoryUrl).catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error)

      toast.error("Couldn't open the link", {
        source: "settings",
        detail: reason,
        event: {
          type: "action-failed",
          attempted: "Open Volcon's source code in your browser",
          reason,
          hint: "Copy the link and paste it into your browser instead.",
          target: { kind: "url", value: repositoryUrl },
        },
      })
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="relative h-40 overflow-hidden border bg-card">
        <div aria-hidden className="absolute inset-0">
          <PixelBlast
            className="opacity-25"
            variant="square"
            pixelSize={4}
            color="#7ccf00"
            patternScale={1.25}
            patternDensity={1}
            pixelSizeJitter={0}
            enableRipples={false}
            liquid
            liquidStrength={0.12}
            liquidRadius={1.2}
            liquidWobbleSpeed={5}
            speed={0.5}
            edgeFade={0}
            transparent
          />
        </div>
        <div className="relative flex h-full items-end gap-4 bg-linear-to-t from-card via-card/60 to-transparent p-5">
          <span className="flex size-14 shrink-0 items-center justify-center bg-primary text-primary-foreground">
            <RiFireLine className="size-7" />
          </span>
          <div className="min-w-0">
            <h2 className="font-heading text-2xl font-semibold tracking-tight">Volcon</h2>
            <p className="text-sm text-muted-foreground">Volume control made simple.</p>
          </div>
        </div>
      </div>

      <SettingsGroup title="Version">
        {/* Read together, so they share a card. */}
        <SettingsCard>
          <SettingRow
            id="about.version"
            control={
              <span className="font-mono text-xs select-text">
                {info?.appVersion ?? version ?? "-"}
              </span>
            }
          />
          <InfoRow label="Build" value={<BuildDetails source={info?.source} />} />
          <InfoRow label="Tauri" value={info?.tauriVersion} />
          <InfoRow label="WebView2" value={webView} />
          <InfoRow label="Windows" value={info?.os} />
        </SettingsCard>
        {/* The check itself, and its settings, are on their own page. */}
        <SettingAction id="about.updates">
          <UpdateSummary />
          <Button type="button" variant="outline" size="sm" onClick={() => requestSettingsSection("updates")}>
            Open Updates
          </Button>
        </SettingAction>
      </SettingsGroup>

      <SettingsGroup title="Help">
        <SettingsCard>
          <SettingAction id="about.shortcuts">
            <ShortcutsDialog />
          </SettingAction>
          <SettingAction id="about.report">
            <ReportProblemDialog />
          </SettingAction>
        </SettingsCard>
      </SettingsGroup>

      <SettingsGroup title="Links">
        <SettingsCard>
          <SettingAction id="about.source">
            <Button type="button" variant="outline" size="sm" onClick={openSource}>
              <RiGithubFill />
              GitHub
            </Button>
          </SettingAction>
          <SettingAction id="about.credits">
            <CreditsDialog />
          </SettingAction>
        </SettingsCard>
      </SettingsGroup>
    </div>
  )
}
