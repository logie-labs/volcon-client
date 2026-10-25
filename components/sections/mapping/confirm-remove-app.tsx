"use client"

import { useCallback, useState } from "react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  getSettingsSnapshot,
  loadSettingsConfig,
  saveSettingsConfig,
} from "@/components/sections/settings/settings-config"

import type { ControlledApp } from "./preset-config"

type Subject = { app: ControlledApp; control: number }

/**
 * Asks before an app is taken off a control, unless the person has said not to.
 *
 * `confirm` resolves true to go ahead and false to keep the app, so a caller
 * can wait for the answer before doing anything - the app's own window, for
 * one, only closes once the removal is agreed. With confirmation turned off it
 * resolves true straight away. Render `dialog` once, wherever the rows are.
 */
export function useRemoveAppConfirmation() {
  const [open, setOpen] = useState(false)
  // Kept after closing, so the dialog's text doesn't vanish while it fades out.
  const [subject, setSubject] = useState<Subject | null>(null)
  const [dontAskAgain, setDontAskAgain] = useState(false)
  const [settle, setSettle] = useState<((confirmed: boolean) => void) | null>(
    null
  )

  const confirm = useCallback((app: ControlledApp, control: number) => {
    if (!getSettingsSnapshot().mapping.confirmRemoveApp) {
      return Promise.resolve(true)
    }

    return new Promise<boolean>((resolve) => {
      setSubject({ app, control })
      setDontAskAgain(false)
      setSettle(() => resolve)
      setOpen(true)
    })
  }, [])

  const answer = (confirmed: boolean) => {
    // Only a removal that went ahead remembers "Don't ask again": ticking it
    // and then cancelling shouldn't change anything.
    if (confirmed && dontAskAgain) {
      const config = loadSettingsConfig()
      saveSettingsConfig({
        ...config,
        mapping: { ...config.mapping, confirmRemoveApp: false },
      })
    }

    settle?.(confirmed)
    setSettle(null)
    setOpen(false)
  }

  const dialog = (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          answer(false)
        }
      }}
    >
      {/* Cancel and Remove are the two answers; no third way out in the corner. */}
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>
            Remove {subject?.app.name ?? "this app"} from Control{" "}
            {subject?.control}?
          </DialogTitle>
          <DialogDescription>
            Control {subject?.control} will stop changing its volume, and it
            goes back to Windows at the level it&apos;s at now, unmuted. You can
            assign it again at any time.
          </DialogDescription>
        </DialogHeader>

        <label className="flex w-fit cursor-pointer items-center gap-2.5 text-sm select-none">
          <Checkbox
            checked={dontAskAgain}
            onCheckedChange={(checked) => setDontAskAgain(checked === true)}
          />
          Don&apos;t ask again
        </label>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => answer(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => answer(true)}
          >
            Remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  return { confirm, dialog }
}
