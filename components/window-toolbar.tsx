"use client"

import { useEffect, useState } from "react"

import { AnimatePresence, motion } from "framer-motion"
import { tauriWindow } from "../lib/tauri-window"
import { Dot } from "lucide-react"

import { Icon, type IconName } from "@/components/icon"
import { useActiveSection } from "@/components/sections/active-section-context"
import { useSettingsConfig } from "@/components/sections/settings/settings-config"
import { ToolbarToasts } from "@/components/toolbar-toasts"
import { useToolbarIndicator } from "@/components/window-toolbar-context"
import { useNotificationCount } from "@/lib/notifications"
import { TextMorph } from "./ui/text-morph"

type WindowToolbarProps = {
  title?: React.ReactNode
}

/** A caption button, drawn with the glyph Windows uses for it. */
function WindowControlButton({
  label,
  glyph,
  onClick,
  danger = false,
}: {
  label: string
  glyph: IconName
  onClick: () => Promise<void>
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={() => void onClick()}
      aria-label={label}
      title={label}
      className={[
        "inline-flex h-full w-11.25 items-center justify-center bg-transparent text-foreground transition-colors hover:bg-[color-mix(in_oklab,var(--foreground)_10%,transparent)] active:bg-[color-mix(in_oklab,var(--foreground)_14%,transparent)]",
        danger
          ? "hover:bg-red-600 hover:text-[oklch(0.98_0_0)] active:bg-[color-mix(in_oklab,var(--destructive)_92%,transparent)]"
          : "",
      ].join(" ")}
    >
      <Icon name={glyph} className="text-[10px]" />
    </button>
  )
}

export function WindowToolbar({ title = "tauri" }: WindowToolbarProps) {
  const [isMaximized, setIsMaximized] = useState(false)
  const { active } = useActiveSection()
  const { indicator } = useToolbarIndicator()
  // The readout a mapping's screen puts here, unless it's turned off in Settings.
  const showReadout = useSettingsConfig().appearance.toolbarReadout
  const notificationCount = useNotificationCount()

  useEffect(() => {
    let mounted = true

    const syncWindowState = async () => {
      const maximized = await tauriWindow.isMaximized()

      if (mounted) {
        setIsMaximized(maximized)
      }
    }

    void syncWindowState()
    const cleanupResize = tauriWindow.onResize(() => {
      void syncWindowState()
    })

    return () => {
      mounted = false
      cleanupResize()
    }
  }, [])

  return (
    // Window chrome, not page: it sits above anything portalled (dialogs and
    // menus are z-50), and pointer-events-auto keeps it working while a modal
    // has turned pointer events off for the rest of the page.
    <header
      data-window-toolbar=""
      className="pointer-events-auto absolute inset-x-0 top-0 z-60 grid h-(--window-toolbar-height) grid-cols-[1fr_auto] items-center select-none border-b bg-[color-mix(in_oklab,var(--background)_94%,var(--foreground)_6%)]"
    >
      {/* `relative` so the toast layer covers this cell and not the window
          buttons, and `overflow-hidden` because a leaving message slides down
          past the bottom of the bar. Messages draw above the centred
          indicator too, which is decoration, where they have something to say. */}
      <div className="relative flex h-full min-w-0 items-center gap-1 overflow-hidden px-3" data-tauri-drag-region>
        <span className="pointer-events-none font-heading text-xs uppercase tracking-[0.06em] text-[color-mix(in_oklab,var(--foreground)_78%,transparent)]">
          {title}
        </span>
        <Dot size={6} className="mx-1 opacity-50" />
        <TextMorph className="pointer-events-none font-heading text-[10px] text-muted-foreground font-semibold uppercase tracking-[0.06em]">
          {active}
        </TextMorph>
        {/* Its own element rather than part of the label, so a new message
            doesn't replay the label's morph. */}
        {active === "notifications" && notificationCount > 0 ? (
          <span className="pointer-events-none font-heading text-[10px] font-semibold tracking-[0.06em] text-muted-foreground/70 tabular-nums">
            ({notificationCount})
          </span>
        ) : null}

        <ToolbarToasts />
      </div>
      <div className="flex h-full items-stretch">
        <WindowControlButton label="Minimise" glyph="minimize" onClick={tauriWindow.minimize} />
        <WindowControlButton
          label={isMaximized ? "Restore" : "Maximise"}
          glyph={isMaximized ? "restore" : "maximize"}
          onClick={tauriWindow.toggleMaximize}
        />
        <WindowControlButton label="Close" glyph="close" onClick={tauriWindow.close} danger />
      </div>

      {/* Purely decorative overlay — absolutely positioned so it never takes up grid space or
          intercepts clicks/dragging; only exists to center the toolbar indicator over the bar. */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <AnimatePresence>
          {indicator && showReadout ? (
            <motion.div
              key="toolbar-indicator"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.18 }}
            >
              {indicator}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </header>
  )
}
