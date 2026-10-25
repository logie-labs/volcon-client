"use client"

import { Fragment } from "react"
import { RiArrowRightSLine } from "@remixicon/react"
import { SearchXIcon } from "lucide-react"

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"

import { settingsSectionMap, type SettingsSectionId } from "../settings-registry"
import type { SettingEntry } from "../settings-schema"

/** `text` with each of `words` marked where it appears. */
function Marked({ text, words }: { text: string; words: string[] }) {
  if (words.length === 0) {
    return text
  }

  const escaped = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  const parts = text.split(new RegExp(`(${escaped.join("|")})`, "gi"))

  return parts.map((part, index) =>
    // Split with a capture group puts the matches at the odd indices.
    index % 2 === 1 ? (
      <mark key={index} className="bg-primary/25 text-foreground">
        {part}
      </mark>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    )
  )
}

/**
 * Settings matching a search, under the pages they're on - the page with the
 * best match first. Picking one opens its page with the setting lit up.
 */
export function SettingsSearchResults({
  query,
  results,
  onOpen,
}: {
  query: string
  results: SettingEntry[]
  onOpen: (entry: SettingEntry) => void
}) {
  const words = query.trim().split(/\s+/).filter(Boolean)

  if (results.length === 0) {
    return (
      <Empty className="mt-16">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <SearchXIcon />
          </EmptyMedia>
          <EmptyTitle>No settings match</EmptyTitle>
          <EmptyDescription>
            Nothing is called &ldquo;{query.trim()}&rdquo;. Try a word like theme, corner or
            deadzone.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  // Results arrive best first; each page is placed where its best one falls.
  const byPage = new Map<SettingsSectionId, SettingEntry[]>()

  for (const entry of results) {
    byPage.set(entry.page, [...(byPage.get(entry.page) ?? []), entry])
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="font-heading text-lg font-semibold tracking-tight">Search</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {results.length} {results.length === 1 ? "setting matches" : "settings match"}{" "}
          &ldquo;{query.trim()}&rdquo;. Press Enter to open the first.
        </p>
      </header>

      {[...byPage].map(([pageId, entries]) => {
        const page = settingsSectionMap[pageId]

        return (
          <section key={pageId} className="flex flex-col gap-2">
            <h3 className="flex items-center gap-1.5 px-0.5 text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">
              <page.icon className="size-3.5" />
              {page.title}
            </h3>
            <div className="divide-y border bg-card">
              {entries.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => onOpen(entry)}
                  className="group/result flex w-full items-center gap-4 px-4 py-3 text-left transition-colors outline-none hover:bg-muted/40 focus-visible:bg-muted/40"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">
                      <Marked text={entry.label} words={words} />
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-xs text-pretty text-muted-foreground">
                      {entry.description}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{entry.group}</span>
                  <RiArrowRightSLine className="size-4 shrink-0 text-muted-foreground transition-transform group-hover/result:translate-x-0.5" />
                </button>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
