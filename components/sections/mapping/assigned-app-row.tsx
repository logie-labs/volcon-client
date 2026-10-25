"use client"

import { useState } from "react"

import { AnimatePresence, motion } from "motion/react"
import {
  RiCloseLine,
  RiDraggable,
  RiEqualizer2Line,
  RiExpandDiagonalLine,
  RiVolumeMuteLine,
  RiVolumeUpLine,
} from "@remixicon/react"

import { LevelMeter } from "@/components/level-meter"
import { Button } from "@/components/ui/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  MORPHING_DIALOG_IGNORE,
  MorphingDialog,
  MorphingDialogContainer,
  MorphingDialogShared,
  MorphingDialogSubtitle,
  MorphingDialogTitle,
  MorphingDialogTrigger,
} from "@/components/ui/morphing-dialog"
import { Slider } from "@/components/ui/slider"
import { VolumeNumber } from "@/components/volume-number"
import { useControlPercent, useControlValue } from "@/lib/control-volume-store"
import { resolveLevelPercent, useActiveCurve } from "@/lib/volume-levels"

import { AssignedAppDialog } from "./assigned-app-dialog"
import { AppIconContent, AppStatusLine, LevelBars } from "./assigned-app-parts"
import type { ControlledApp } from "./preset-config"

/** Long enough for the window to shrink back into its row before the row goes. */
const CLOSE_BEFORE_REMOVE_MS = 250

/** Spread onto a control inside the row, so pressing it doesn't open the app's window. */
const ownPresses = { [MORPHING_DIALOG_IGNORE]: "" }

interface AssignedAppRowProps {
  app: ControlledApp
  control: number
  /** What the mapping is called, for the app's window. */
  controlName: string
  /** Level to show before the control has reported a live position. */
  fallbackPercent: number
  conflictControls: number[]
  /**
   * Where the list's drag-to-reorder grip attaches. Given, the row draws a grip
   * at its left edge; left out, it has none.
   */
  dragHandleRef?: (element: Element | null) => void
  onTrimChange: (trim: number) => void
  onTrimCommit: (trim: number) => void
  onMuteToggle: (muted: boolean) => void
  /**
   * Asks whether to go ahead before the app is removed, resolving true to go
   * ahead. Left out, removing doesn't ask.
   */
  confirmRemove?: () => Promise<boolean>
  onRemove: () => void
}

export function AssignedAppRow({
  app,
  control,
  controlName,
  fallbackPercent,
  conflictControls,
  dragHandleRef,
  onTrimChange,
  onTrimCommit,
  onMuteToggle,
  confirmRemove,
  onRemove,
}: AssignedAppRowProps) {
  const controlPercent = useControlPercent(control, fallbackPercent)
  const controlValue = useControlValue(control, fallbackPercent)
  const curve = useActiveCurve()
  const [open, setOpen] = useState(false)

  // While a trim drag is in flight the slider follows the pointer rather than the
  // committed value, so the row can't stutter on a round trip through the config.
  const [draggingTrim, setDraggingTrim] = useState<number | null>(null)

  const trim = draggingTrim ?? app.trim
  const trimPercent = Math.round(trim * 100)
  // Two figures, because with a curve in force they differ. The level is the one
  // that makes sense on its own: the control's position scaled by this app's
  // trim, so a control at 50% with full trim reads 50%. The mixer figure is what
  // Windows is actually set to once the curve has had its say. A mute leaves
  // the mixer level where it is and sets the mute flag alongside it.
  //
  // The mixer figure carries two decimals: a strong curve pushes the bottom of a
  // control well under 1%, which a whole number would just call 0%. It's worked
  // from the raw position, as the backend does, rather than the rounded percent.
  const levelPercent = Math.round(controlPercent * trim)
  const mixerPercent =
    Math.round(
      resolveLevelPercent(
        (controlValue / 127) * 100,
        { trim, muted: false },
        curve
      ) * 100
    ) / 100
  const levelExplained =
    `Control ${control} at ${Math.round(controlPercent)}% × ${trimPercent}% trim = ${levelPercent}%. ` +
    (curve.enabled
      ? `With the logarithmic curve, the Windows mixer is set to ${mixerPercent.toFixed(2)}%.`
      : "The Windows mixer is set to the same.") +
    (app.muted ? " Muted in the mixer." : "")

  const dragTrim = (next: number) => {
    setDraggingTrim(next)
    onTrimChange(next)
  }

  const releaseTrim = (next: number) => {
    setDraggingTrim(null)
    onTrimCommit(next)
  }

  // From the right-click menu or a quick setting: applied and saved in one go,
  // as releasing the slider would.
  const setTrim = (next: number) => {
    onTrimChange(next)
    onTrimCommit(next)
  }

  // Asks first where that's wanted; the answer decides whether anything happens.
  const remove = async () => {
    if (!confirmRemove || (await confirmRemove())) {
      onRemove()
    }
  }

  // From the app's own window: asked over the window, which stays open if the
  // answer is no. If yes, it closes first, so it can shrink back into the row
  // before the row disappears.
  const removeFromWindow = async () => {
    if (confirmRemove && !(await confirmRemove())) {
      return
    }

    setOpen(false)
    window.setTimeout(onRemove, CLOSE_BEFORE_REMOVE_MS)
  }

  return (
    <MorphingDialog open={open} onOpenChange={setOpen}>
      <ContextMenu>
        <ContextMenuTrigger className="relative block">
          {/* Holds the row's place while it's open in its own window: the row
              itself has grown into the window, and an empty gap would read as
              the app having been removed. Sits behind the row, which shows
              again over the top of it as the window shrinks back. */}
          <AnimatePresence>
            {open ? (
              <motion.div
                key="placeholder"
                aria-hidden
                className="absolute inset-0 flex items-center gap-2 border border-dashed bg-[repeating-linear-gradient(135deg,transparent_0_8px,color-mix(in_oklab,var(--muted)_45%,transparent)_8px_9px)] px-4 font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase"
                initial={{ opacity: 0 }}
                // No timing of its own: it fades in on the same spring the
                // window grows on, so the two finish together.
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.1 } }}
              >
                <RiExpandDiagonalLine className="size-3.5" />
                {app.name} is open
              </motion.div>
            ) : null}
          </AnimatePresence>

          <MorphingDialogTrigger
            aria-label={`Open ${app.name}`}
            className="border bg-card text-left transition-colors hover:bg-muted/25"
          >
            <div className="relative flex flex-wrap items-center gap-x-4 gap-y-3 p-3">
              {dragHandleRef ? (
                // The grip moves the row, so pressing it never opens the app.
                <button
                  ref={dragHandleRef}
                  type="button"
                  {...ownPresses}
                  aria-label={`Drag ${app.name} to reorder`}
                  title="Drag to reorder"
                  className="-mx-1 flex h-10 w-5 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground/60 transition-colors hover:text-foreground active:cursor-grabbing"
                >
                  <RiDraggable className="size-4" />
                </button>
              ) : null}

              <div className="flex min-w-0 flex-1 basis-44 items-center gap-3">
                <MorphingDialogShared
                  name="icon"
                  className="flex size-10 shrink-0 items-center justify-center overflow-hidden border bg-muted"
                >
                  <AppIconContent app={app} />
                </MorphingDialogShared>

                <div className="min-w-0">
                  <MorphingDialogTitle
                    className={`truncate font-medium ${app.muted ? "text-muted-foreground" : ""}`}
                  >
                    {app.name}
                  </MorphingDialogTitle>
                  <MorphingDialogSubtitle>
                    <AppStatusLine app={app} />
                  </MorphingDialogSubtitle>
                </div>
              </div>

              <div
                {...ownPresses}
                className="order-last flex basis-full cursor-default items-center gap-3 sm:order-none sm:basis-auto"
              >
                <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
                  Trim
                </span>
                {/* Sized by the wrapper: the slider fills whatever it's in, so a
                    width on the slider itself is overruled and it overflows. */}
                <div className="w-32 min-w-24 flex-1 sm:w-40 sm:flex-none">
                  <Slider
                    aria-label={`Trim for ${app.name}`}
                    value={trimPercent}
                    min={0}
                    max={100}
                    step={1}
                    onValueChange={(value) =>
                      dragTrim(
                        (typeof value === "number" ? value : value[0]) / 100
                      )
                    }
                    onValueCommitted={(value) =>
                      releaseTrim(
                        (typeof value === "number" ? value : value[0]) / 100
                      )
                    }
                  />
                </div>
                <span className="min-w-10 shrink-0 text-right font-mono text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                  <VolumeNumber value={trimPercent} />%
                </span>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <div
                  className="flex w-24 flex-col items-end gap-1 leading-none"
                  title={levelExplained}
                >
                  <div className="flex items-baseline gap-0.5">
                    <VolumeNumber
                      value={levelPercent}
                      className={`text-2xl tabular-nums ${app.muted ? "text-muted-foreground/50" : ""}`}
                    />
                    <span className="text-xs text-muted-foreground">%</span>
                  </div>
                  <div className="font-mono text-[10px] tracking-[0.1em] whitespace-nowrap text-muted-foreground uppercase">
                    {app.muted ? (
                      <span className="text-destructive">Muted</span>
                    ) : (
                      <>
                        Mixer{" "}
                        <VolumeNumber
                          value={mixerPercent}
                          decimals={2}
                          className="text-foreground/80"
                        />
                        %
                      </>
                    )}
                  </div>
                </div>

                {/* Live left and right, beside the level they're playing at. */}
                <LevelMeter
                  apps={app.sourceApps}
                  gain={mixerPercent / 100}
                  muted={app.muted}
                  className="mx-2"
                />

                {/* The same size as the app's icon tile, so the row reads as one set.
                    Colours only transition: a button's usual transition-all
                    would carry the row being hidden too, and leave these two
                    showing for a moment after the rest of it has gone. */}
                <div {...ownPresses} className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    aria-label={
                      app.muted ? `Unmute ${app.name}` : `Mute ${app.name}`
                    }
                    aria-pressed={app.muted}
                    onClick={() => onMuteToggle(!app.muted)}
                    className={`size-10 border p-0 transition-colors ${
                      app.muted
                        ? "border-destructive/40 bg-destructive/10 hover:bg-destructive/20"
                        : "bg-muted hover:bg-muted/60"
                    }`}
                  >
                    {app.muted ? (
                      <RiVolumeMuteLine className="size-5 text-destructive" />
                    ) : (
                      <RiVolumeUpLine className="size-5 text-muted-foreground" />
                    )}
                  </Button>

                  <Button
                    variant="ghost"
                    aria-label={`Remove ${app.name} from Control ${control}`}
                    onClick={() => void remove()}
                    className="size-10 border bg-muted p-0 transition-colors hover:bg-muted/60"
                  >
                    <RiCloseLine className="size-5 text-muted-foreground" />
                  </Button>
                </div>
              </div>

              <LevelBars
                levelPercent={levelPercent}
                mixerPercent={mixerPercent}
                muted={app.muted}
                className="absolute bottom-0 left-0"
              />
            </div>

            {conflictControls.length > 0 ? (
              <div className="border-t border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                Also controlled by Control {conflictControls.join(", Control ")}{" "}
                on this preset.
              </div>
            ) : null}
          </MorphingDialogTrigger>
        </ContextMenuTrigger>

        <ContextMenuContent className="w-52">
          <ContextMenuItem onClick={() => setOpen(true)}>
            <RiExpandDiagonalLine className="text-muted-foreground" /> Open
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => onMuteToggle(!app.muted)}>
            {app.muted ? (
              <>
                <RiVolumeUpLine className="text-muted-foreground" /> Unmute
              </>
            ) : (
              <>
                <RiVolumeMuteLine className="text-muted-foreground" /> Mute
              </>
            )}
          </ContextMenuItem>
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <RiEqualizer2Line className="text-muted-foreground" /> Trim
              <span className="font-mono text-xs text-muted-foreground">
                {trimPercent}%
              </span>
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuRadioGroup
                value={String(trimPercent)}
                onValueChange={(value) => setTrim(Number(value) / 100)}
              >
                {[100, 75, 50, 25].map((percent) => (
                  <ContextMenuRadioItem key={percent} value={String(percent)}>
                    {percent}%
                  </ContextMenuRadioItem>
                ))}
              </ContextMenuRadioGroup>
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onClick={() => void remove()}>
            <RiCloseLine /> Remove from Control {control}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <MorphingDialogContainer>
        <AssignedAppDialog
          app={app}
          control={control}
          controlName={controlName}
          controlPercent={controlPercent}
          levelPercent={levelPercent}
          mixerPercent={mixerPercent}
          trimPercent={trimPercent}
          curve={curve}
          conflictControls={conflictControls}
          onTrimDrag={dragTrim}
          onTrimRelease={releaseTrim}
          onTrimSet={setTrim}
          onMuteToggle={onMuteToggle}
          onRemove={() => void removeFromWindow()}
        />
      </MorphingDialogContainer>
    </MorphingDialog>
  )
}
