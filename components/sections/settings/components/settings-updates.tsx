"use client"

import { Fragment, useEffect, useState, type ReactNode } from "react"
import {
  RiArrowUpCircleLine,
  RiCheckLine,
  RiDownloadCloud2Line,
  RiErrorWarningLine,
  RiExternalLinkLine,
  RiLoader4Line,
  RiRefreshLine,
} from "@remixicon/react"

import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { openExternal } from "@/lib/bridge-client"
import { describeAge, toast } from "@/lib/notifications"
import { checkForUpdates, compareVersions, useUpdates, type UpdateResult } from "@/lib/updates"
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

/** Where things stand, in a sentence or two, with the way to the download when there's one. */
function UpdateStatus({
  checking,
  result,
  checkedAt,
  now,
}: {
  checking: boolean
  result: UpdateResult | null
  checkedAt: number | null
  now: number
}) {
  let icon: ReactNode
  let tone: "plain" | "good" | "new" | "problem" = "plain"
  let headline: string
  let detail: string
  let action: ReactNode = null

  if (checking) {
    icon = <RiLoader4Line className="size-5 animate-spin" />
    headline = "Checking for updates…"
    detail = "Asking GitHub for the newest release."
  } else if (!result) {
    icon = <RiDownloadCloud2Line className="size-5" />
    headline = "Not checked yet"
    detail = "Check to see whether there's a newer version of Volcon."
  } else if (result.status === "available") {
    icon = <RiArrowUpCircleLine className="size-5" />
    tone = "new"
    headline = `Volcon ${result.latest.version} is available`
    detail = `You have ${result.installed}.${result.latest.publishedAt ? ` It was released ${describeReleased(result.latest.publishedAt, now)}.` : ""}${result.latest.prerelease ? " It's a pre-release, ahead of the release for everyone." : ""}`
    action = (
      <Button type="button" size="sm" onClick={() => openRelease(result.latest.url)}>
        <RiExternalLinkLine />
        Download from GitHub
      </Button>
    )
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
        {checkedAt !== null && !checking ? (
          <p className="mt-2 font-mono text-[10px] tracking-widest text-muted-foreground/80 uppercase">
            Checked {describeAge(checkedAt, now)}
          </p>
        ) : null}
        {action ? <div className="mt-3">{action}</div> : null}
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
  const { checking, result, checkedAt } = useUpdates()
  const now = useNow()
  const latest = result && (result.status === "available" || result.status === "current") ? result.latest : null

  const check = () => void checkForUpdates({ prereleases: config.updates.prereleases })

  return (
    <SettingsPage id="updates">
      <UpdateStatus checking={checking} result={result} checkedAt={checkedAt} now={now} />

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
