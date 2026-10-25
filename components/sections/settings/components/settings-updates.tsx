"use client"

import { Fragment, useEffect, useState, type ReactNode } from "react"
import {
  RiArrowUpCircleLine,
  RiCheckboxCircleLine,
  RiCheckLine,
  RiCloseLine,
  RiDownload2Line,
  RiDownloadCloud2Line,
  RiErrorWarningLine,
  RiExternalLinkLine,
  RiLoader4Line,
  RiRefreshLine,
  RiRestartLine,
} from "@remixicon/react"

import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { openExternal, type UpdateDownloadState } from "@/lib/bridge-client"
import { describeAge, toast } from "@/lib/notifications"
import {
  cancelDownload,
  checkForUpdates,
  compareVersions,
  downloadUpdate,
  installNow,
  skipVersion,
  useUpdates,
  type UpdateResult,
} from "@/lib/updates"
import { cn } from "@/lib/utils"

import { useSettings } from "../settings-context"
import { SettingAction, SettingsCard, SettingsGroup, SettingsPage, SettingSwitch } from "./settings-primitives"

/** The current time, refreshed often enough for "checked 4m ago" to stay true. */
function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])

  return now
}

/** "3 days ago", or the date for anything older than a month. */
function describeReleased(iso: string, now: number) {
  const days = Math.floor((now - new Date(iso).getTime()) / 86_400_000)

  if (days < 1) {
    return "today"
  }

  if (days === 1) {
    return "yesterday"
  }

  if (days < 31) {
    return `${days} days ago`
  }

  return `on ${new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}`
}

/** Opens a release page in the browser, saying so if that doesn't work. */
function openRelease(url: string) {
  void openExternal(url).catch((error: unknown) => {
    const reason = error instanceof Error ? error.message : String(error)

    toast.error("Couldn't open the release page", {
      source: "app",
      detail: reason,
      event: {
        type: "action-failed",
        attempted: "Open the release page in your browser",
        reason,
        hint: "Copy the link and paste it into your browser instead.",
        target: { kind: "url", value: url },
      },
    })
  })
}

/** "3.1 MB", or "640 KB" under a megabyte. */
function describeBytes(bytes: number) {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/** The backend's reasons start lowercase, to follow "couldn't …"; here one stands alone. */
function asSentence(reason: string) {
  const text = reason.trim()
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}${/[.!?]$/.test(text) ? "" : "."}`
}

/**
 * Where things stand, in a sentence or two, with what can be done about it:
 * download a newer version, watch it come in, install it, or skip it.
 */
function UpdateStatus({
  checking,
  result,
  checkedAt,
  download,
  skipped,
  now,
}: {
  checking: boolean
  result: UpdateResult | null
  checkedAt: number | null
  download: UpdateDownloadState
  skipped: string | null
  now: number
}) {
  let icon: ReactNode
  let tone: "plain" | "good" | "new" | "problem" = "plain"
  let headline: string
  let detail: string
  let action: ReactNode = null
  let progress: ReactNode = null
  const latest = result?.status === "available" ? result.latest : null

  if (download.phase === "downloading") {
    const percent =
      download.total > 0 ? Math.min(100, Math.floor((download.received / download.total) * 100)) : 0

    icon = <RiDownloadCloud2Line className="size-5" />
    tone = "new"
    headline = `Downloading Volcon ${download.version}…`
    detail = `${describeBytes(download.received)} of ${describeBytes(download.total)}. It's checked once it's here, then installs itself.`
    progress = (
      <div className="mt-3 flex items-center gap-3">
        <Progress value={percent} aria-label={`Downloading Volcon ${download.version}`} className="flex-1" />
        <span className="w-9 text-right font-mono text-xs text-muted-foreground tabular-nums">{percent}%</span>
      </div>
    )
    action = (
      <Button type="button" variant="outline" size="sm" onClick={cancelDownload}>
        <RiCloseLine />
        Cancel
      </Button>
    )
  } else if (download.phase === "ready") {
    icon = <RiCheckboxCircleLine className="size-5" />
    tone = "new"
    headline = `Volcon ${download.version} is ready to install`
    detail = download.failedAtLaunch
      ? "It didn't go in when Volcon last started. Try it now: Volcon closes for a moment and opens again, updated."
      : "It installs the next time Volcon starts. Or update now: Volcon closes for a moment and opens again, updated."
    action = (
      <>
        <Button type="button" size="sm" onClick={() => void installNow()}>
          <RiRestartLine />
          Update now
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => skipVersion(download.version)}>
          Skip this version
        </Button>
      </>
    )
  } else if (download.phase === "failed") {
    const release = latest?.version === download.version ? latest : null

    icon = <RiErrorWarningLine className="size-5" />
    tone = "problem"
    headline = `Couldn't download Volcon ${download.version}`
    detail = `${asSentence(download.reason)} Nothing was changed.`
    action = release ? (
      <>
        <Button type="button" size="sm" onClick={() => void downloadUpdate(release)}>
          <RiRefreshLine />
          Try again
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => openRelease(release.url)}>
          <RiExternalLinkLine />
          Download from GitHub
        </Button>
      </>
    ) : null
  } else if (checking) {
    icon = <RiLoader4Line className="size-5 animate-spin" />
    headline = "Checking for updates…"
    detail = "Asking GitHub for the newest release."
  } else if (!result) {
    icon = <RiDownloadCloud2Line className="size-5" />
    headline = "Not checked yet"
    detail = "Check to see whether there's a newer version of Volcon."
  } else if (result.status === "available") {
    const release = result.latest

    icon = <RiArrowUpCircleLine className="size-5" />
    headline = `Volcon ${release.version} is available`

    if (skipped === release.version) {
      detail = `You skipped this version, so it isn't offered when Volcon starts. You have ${result.installed}.`
      action = (
        <Button type="button" variant="outline" size="sm" onClick={() => void downloadUpdate(release)}>
          <RiDownload2Line />
          Download anyway
        </Button>
      )
    } else {
      tone = "new"
      detail = `You have ${result.installed}.${release.publishedAt ? ` It was released ${describeReleased(release.publishedAt, now)}.` : ""}${release.prerelease ? " It's a pre-release, ahead of the release for everyone." : ""}`
      action = (
        <>
          {release.installer ? (
            <Button type="button" size="sm" onClick={() => void downloadUpdate(release)}>
              <RiDownload2Line />
              Download and install
            </Button>
          ) : (
            <Button type="button" size="sm" onClick={() => openRelease(release.url)}>
              <RiExternalLinkLine />
              Download from GitHub
            </Button>
          )}
          <Button type="button" variant="ghost" size="sm" onClick={() => skipVersion(release.version)}>
            Skip this version
          </Button>
        </>
      )
    }
  } else if (result.status === "current") {
    icon = <RiCheckLine className="size-5" />
    tone = "good"
    headline = "You're up to date"
    detail =
      result.latest && compareVersions(result.installed, result.latest.version) > 0
        ? `You have ${result.installed}, which is newer than the latest release, ${result.latest.version}.`
        : `Volcon ${result.installed} is the latest version.`
  } else if (result.status === "unpublished") {
    icon = <RiDownloadCloud2Line className="size-5" />
    headline = "Nothing to check against yet"
    detail = `${result.reason} Checking will find new versions as soon as they're published.`
  } else {
    icon = <RiErrorWarningLine className="size-5" />
    tone = "problem"
    headline = "Couldn't check for updates"
    detail = result.reason
  }

  return (
    <div
      className={cn(
        "flex items-start gap-4 border p-4",
        tone === "new" ? "border-primary/40 bg-primary/10" : "bg-card"
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex size-10 shrink-0 items-center justify-center border",
          tone === "good" && "border-primary/40 bg-primary/10 text-primary",
          tone === "new" && "border-primary/40 bg-primary text-primary-foreground",
          tone === "problem" && "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
          tone === "plain" && "bg-muted text-muted-foreground"
        )}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium">{headline}</p>
        <p className="mt-0.5 text-xs text-pretty text-muted-foreground">{detail}</p>
        {progress}
        {checkedAt !== null && !checking && download.phase === "idle" ? (
          <p className="mt-2 font-mono text-[10px] tracking-widest text-muted-foreground/80 uppercase">
            Checked {describeAge(checkedAt, now)}
          </p>
        ) : null}
        {action ? <div className="mt-3 flex flex-wrap items-center gap-2">{action}</div> : null}
      </div>
    </div>
  )
}

/** A line of Markdown as plain text: links as their words, and no stars or backticks. */
function plainText(line: string) {
  return line
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|\*|_|`)/g, "")
    .trim()
}

type NotesBlock =
  | { kind: "heading"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "paragraph"; text: string }

/**
 * Release notes as written on GitHub, in Markdown, read for the parts release
 * notes use - headings, lists, paragraphs - and shown as text.
 */
function readNotes(notes: string): NotesBlock[] {
  const blocks: NotesBlock[] = []

  for (const raw of notes.replace(/\r/g, "").split("\n")) {
    const line = raw.trim()
    const last = blocks[blocks.length - 1]

    if (!line) {
      blocks.push({ kind: "paragraph", text: "" })
      continue
    }

    const heading = /^#{1,6}\s+(.*)$/.exec(line)
    const item = /^(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line)

    if (heading) {
      blocks.push({ kind: "heading", text: plainText(heading[1]) })
    } else if (item) {
      if (last?.kind === "list") {
        last.items.push(plainText(item[1]))
      } else {
        blocks.push({ kind: "list", items: [plainText(item[1])] })
      }
    } else if (last?.kind === "paragraph" && last.text) {
      last.text = `${last.text} ${plainText(line)}`
    } else {
      blocks.push({ kind: "paragraph", text: plainText(line) })
    }
  }

  return blocks.filter((block) => block.kind !== "paragraph" || block.text)
}

function ReleaseNotes({ notes }: { notes: string }) {
  const blocks = readNotes(notes)

  if (blocks.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground">No notes were written for this release.</p>
  }

  return (
    <div className="flex flex-col gap-3 p-4 text-sm">
      {blocks.map((block, index) => (
        <Fragment key={index}>
          {block.kind === "heading" ? (
            <h4 className="font-mono text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
              {block.text}
            </h4>
          ) : block.kind === "list" ? (
            <ul className="flex flex-col gap-1">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex} className="flex gap-2 text-foreground/90">
                  <span aria-hidden className="mt-2 size-1 shrink-0 bg-muted-foreground/60" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-foreground/90">{block.text}</p>
          )}
        </Fragment>
      ))}
    </div>
  )
}

export function UpdatesSection() {
  const { config } = useSettings()
  const { checking, result, checkedAt, download, skipped } = useUpdates()
  const now = useNow()
  const latest = result && (result.status === "available" || result.status === "current") ? result.latest : null

  const check = () => void checkForUpdates({ prereleases: config.updates.prereleases })

  return (
    <SettingsPage id="updates">
      <UpdateStatus
        checking={checking}
        result={result}
        checkedAt={checkedAt}
        download={download}
        skipped={skipped}
        now={now}
      />

      <SettingsGroup title="Version">
        <SettingAction id="updates.check">
          <Button type="button" variant="outline" size="sm" onClick={check} disabled={checking}>
            {checking ? <RiLoader4Line className="animate-spin" /> : <RiRefreshLine />}
            {checking ? "Checking…" : "Check now"}
          </Button>
        </SettingAction>
      </SettingsGroup>

      {latest ? (
        <SettingsGroup title={`What's new in ${latest.version}`}>
          {/* The viewport has the height cap, so long notes scroll inside the card. */}
          <ScrollArea className="border bg-card *:data-[slot=scroll-area-viewport]:max-h-80">
            <ReleaseNotes notes={latest.notes} />
          </ScrollArea>
        </SettingsGroup>
      ) : null}

      <SettingsGroup title="Checking">
        <SettingsCard>
          <SettingSwitch path="updates.autoCheck" />
          <SettingSwitch path="updates.prereleases" />
        </SettingsCard>
      </SettingsGroup>
    </SettingsPage>
  )
}
