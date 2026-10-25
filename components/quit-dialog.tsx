"use client"

import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"

import { getSettingsSnapshot, saveSettingsConfig } from "@/components/sections/settings/settings-config"
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
import { hasTauriRuntime } from "@/lib/tauri-runtime"

/**
 * Asked when closing the window would quit Volcon - Close to tray is off, on
 * Settings → Behaviour - since the controls stop working once it's gone. The
 * backend holds the window open and has this ask; closing the question itself
 * leaves Volcon as it was.
 */
export function QuitDialog() {
  const [open, setOpen] = useState(false)
  const [dontAskAgain, setDontAskAgain] = useState(false)

  useEffect(() => {
    if (!hasTauriRuntime()) {
      return
    }

    let stopListening: (() => void) | null = null
    let unmounted = false

    void listen("app:quit-requested", () => {
      setDontAskAgain(false)
      setOpen(true)
    })
      .then((unlisten) => {
        if (unmounted) {
          unlisten()
        } else {
          stopListening = unlisten
        }
      })
      .catch(() => {})

    return () => {
      unmounted = true
      stopListening?.()
    }
  }, [])

  const closeToTray = () => {
    setOpen(false)
    void invoke("hide_to_tray").catch(() => {})
  }

  const quit = async () => {
    if (dontAskAgain) {
      const config = getSettingsSnapshot()
      const behaviour = { ...config.behaviour, askBeforeQuitting: false }

      saveSettingsConfig({ ...config, behaviour })
      // Told now rather than left to the settings sync, since Volcon quits next.
      await invoke("set_close_behaviour", { ...behaviour }).catch(() => {})
    }

    await invoke("quit_app").catch(() => {})
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* The two answers, and Esc to change your mind; no third way out in the corner. */}
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Quit Volcon?</DialogTitle>
          <DialogDescription>
            Your controls stop changing volume once Volcon quits, until you open it again. To keep
            them working, close it to the tray instead.
          </DialogDescription>
        </DialogHeader>

        <label className="flex w-fit cursor-pointer items-center gap-2.5 text-sm select-none">
          <Checkbox
            checked={dontAskAgain}
            onCheckedChange={(checked) => setDontAskAgain(checked === true)}
          />
          Quit without asking next time
        </label>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={closeToTray}>
            Close to tray instead
          </Button>
          <Button type="button" variant="destructive" onClick={() => void quit()}>
            Quit Volcon
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
