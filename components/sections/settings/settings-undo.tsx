"use client"

import { useState, useSyncExternalStore } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { UndoOutcome } from "@/lib/notifications"

import { formatSettingValue, settingChanges } from "./setting-changes"
import { loadSettingsConfig, saveSettingsConfig, type SettingsConfig } from "./settings-config"
import { getSetting, getSettingEntry, settingsPages, setSetting, type SettingPath } from "./settings-schema"

/*
 * Undo for settings changed in bulk - a page reset, everything reset, a backup
 * imported - that minds what's happened since. A setting still as the change
 * left it goes back without a word. One that's been changed again since isn't
 * quietly thrown away: Undo asks whether to put it back too, or keep it.
 */

/** A setting changed again since, with what it was, what it was changed to, and what it is now. */
type Conflict = {
  path: SettingPath
  label: string
  page: string
  before: string
  after: string
  now: string
}

type Choice = "all" | "unchanged" | "cancel"

type Question = {
  /** What's being undone, as a noun: "the Appearance page reset". */
  change: string
  /** What the change made each setting, as a column heading: "Reset to". */
  afterLabel: string
  conflicts: Conflict[]
  /** How many settings go back whatever the answer. */
  others: number
  answer: (choice: Choice) => void
}

let question: Question | null = null
const listeners = new Set<() => void>()

function announce() {
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Asks what to do about the conflicts, one question at a time. */
function ask(details: Omit<Question, "answer">) {
  // A second Undo while one is being asked about cancels the first.
  question?.answer("cancel")

  return new Promise<Choice>((resolve) => {
    const asked: Question = {
      ...details,
      answer: (choice) => {
        if (question === asked) {
          question = null
          announce()
        }

        resolve(choice)
      },
    }

    question = asked
    announce()
  })
}

const pageTitles = new Map(settingsPages.map((page) => [page.id, page.title]))

/** "1 setting is", "3 settings are". */
const settingsAre = (count: number) => (count === 1 ? "1 setting is" : `${count} settings are`)

/**
 * Puts the settings at `paths` back to how they were `before` a bulk change
 * that left them as `after`, asking first about any changed again since.
 */
export async function undoSettingsChange({
  paths,
  before,
  after,
  change,
  afterLabel,
  undid,
  doneTitle,
}: {
  paths: readonly SettingPath[]
  before: SettingsConfig
  after: SettingsConfig
  /** The change, as a noun, for the question: "the Appearance page reset". */
  change: string
  /** What the change made each setting, as a column heading: "Reset to". */
  afterLabel: string
  /** What it goes back to before, for the record: "the Appearance page was reset". */
  undid: string
  /** The title bar's line once it's done: "Appearance settings put back". */
  doneTitle: string
}): Promise<UndoOutcome> {
  const now = loadSettingsConfig()
  const untouched: SettingPath[] = []
  const conflicts: Conflict[] = []

  for (const path of paths) {
    const was = getSetting(before, path)
    const became = getSetting(after, path)
    const is = getSetting(now, path)

    if (Object.is(is, was)) {
      // Already back as it was.
      continue
    }

    if (Object.is(is, became)) {
      untouched.push(path)
      continue
    }

    const entry = getSettingEntry(path)

    conflicts.push({
      path,
      label: entry.label,
      page: pageTitles.get(entry.page) ?? entry.page,
      before: formatSettingValue(path, was),
      after: formatSettingValue(path, became),
      now: formatSettingValue(path, is),
    })
  }

  if (untouched.length === 0 && conflicts.length === 0) {
    return { done: false, reason: "Everything it changed is already back as it was." }
  }

  let putBack = untouched

  if (conflicts.length > 0) {
    const choice = await ask({ change, afterLabel, conflicts, others: untouched.length })

    if (choice === "cancel") {
      return { done: false }
    }

    if (choice === "all") {
      putBack = [...untouched, ...conflicts.map((conflict) => conflict.path)]
    }
  }

  if (putBack.length === 0) {
    return { done: false }
  }

  // Read again: the question may have been open a while.
  const current = loadSettingsConfig()
  const restored = putBack.reduce(
    (next, path) => setSetting(next, path, getSetting(before, path)),
    current
  )
  const kept = conflicts.length - (putBack.length - untouched.length)

  saveSettingsConfig(restored)

  return {
    done: true,
    title: doneTitle,
    description:
      kept > 0
        ? `${settingsAre(putBack.length)} back as before; ${kept === 1 ? "1 newer change was" : `${kept} newer changes were`} kept.`
        : `${settingsAre(putBack.length)} back as before.`,
    event: {
      type: "settings-changed",
      how: "undone",
      undid,
      kept,
      changes: settingChanges(current, restored, putBack),
    },
  }
}

/**
 * The question, when there is one. Lives with the app rather than on the
 * Settings screen, since an Undo can be pressed from anywhere: the title bar,
 * or the Notifications screen.
 */
export function SettingsUndoDialog() {
  const asking = useSyncExternalStore(subscribe, () => question, () => null)
  // Kept while the dialog closes, so its contents don't vanish mid-animation.
  const [shown, setShown] = useState<Question | null>(null)

  if (asking && asking !== shown) {
    setShown(asking)
  }

  const conflicts = shown?.conflicts ?? []
  const others = shown?.others ?? 0
  const one = conflicts.length === 1

  return (
    <Dialog
      open={asking !== null}
      onOpenChange={(open) => {
        if (!open) {
          asking?.answer("cancel")
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{one ? "This setting has changed since" : "Some settings have changed since"}</DialogTitle>
          <DialogDescription>
            Since {shown?.change}, {one ? "this setting was" : `these ${conflicts.length} settings were`} changed
            again. Undo can put {one ? "it" : "them"} back to how {one ? "it was" : "they were"} before, or leave{" "}
            {one ? "it" : "them"} as {one ? "it is" : "they are"} now.
          </DialogDescription>
        </DialogHeader>

        <div className="border text-xs">
          <div className="grid grid-cols-[minmax(0,1fr)_repeat(3,5.5rem)] gap-3 border-b bg-muted/30 px-3 py-1.5 font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
            <span>Setting</span>
            <span>Before</span>
            <span>{shown?.afterLabel}</span>
            <span>Now</span>
          </div>
          {conflicts.map((conflict) => (
            <div
              key={conflict.path}
              className="grid grid-cols-[minmax(0,1fr)_repeat(3,5.5rem)] items-center gap-3 border-b px-3 py-2 last:border-b-0"
            >
              <span className="min-w-0">
                <span className="block truncate">{conflict.label}</span>
                <span className="block truncate text-[10px] text-muted-foreground">{conflict.page}</span>
              </span>
              <span className="truncate font-mono text-[11px] text-primary">{conflict.before}</span>
              <span className="truncate font-mono text-[11px] text-muted-foreground line-through decoration-muted-foreground/50">
                {conflict.after}
              </span>
              <span className="truncate font-mono text-[11px]">{conflict.now}</span>
            </div>
          ))}
        </div>

        {others > 0 ? (
          <p className="text-xs text-muted-foreground">
            {others === 1 ? "The other setting" : `The other ${others} settings`} it changed{" "}
            {others === 1 ? "hasn't" : "haven't"} been touched since, and will go back either way.
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => asking?.answer("cancel")}>
            Cancel
          </Button>
          {others > 0 ? (
            <Button variant="outline" onClick={() => asking?.answer("unchanged")}>
              Keep newer changes
            </Button>
          ) : null}
          <Button onClick={() => asking?.answer("all")}>
            {others > 0 ? "Put everything back" : one ? "Put it back" : "Put them back"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
