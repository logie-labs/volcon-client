"use client"

import type { ReactNode } from "react"

import { RiCloseLine, RiVolumeMuteLine, RiVolumeUpLine } from "@remixicon/react"

import { LevelMeter } from "@/components/level-meter"
import { Button } from "@/components/ui/button"
import {
  MorphingDialogClose,
  MorphingDialogContent,
  MorphingDialogDescription,
  MorphingDialogShared,
  MorphingDialogSubtitle,
  MorphingDialogTitle,
  useMorphingDialog,
} from "@/components/ui/morphing-dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Slider } from "@/components/ui/slider"
import { VolumeNumber } from "@/components/volume-number"
import { cn } from "@/lib/utils"

import { AppIconContent, AppStatusLine } from "./assigned-app-parts"
import type { ControlledApp } from "./preset-config"

const TRIM_PRESETS = [0, 25, 50, 75, 100]

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h3 className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
      {children}
    </h3>
  )
}

/** One step on the way from the control's position to the mixer. */
function Stage({
  label,
  note,
  emphasis = false,
  children,
}: {
  label: string
  note?: string
  /** The step that lands in Windows, which is the one that matters. */
  emphasis?: boolean
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        "flex min-w-21 flex-1 flex-col gap-1.5 border px-3 py-2.5",
        emphasis ? "border-primary/40 bg-primary/10" : "bg-muted/40"
      )}
    >
      <span className="font-mono text-[9px] tracking-[0.2em] text-muted-foreground uppercase">
        {label}
      </span>
      <span
        className={cn(
          "font-mono text-base leading-none whitespace-nowrap tabular-nums",
          emphasis && "text-primary"
        )}
      >
        {children}
      </span>
      {note ? (
        <span className="truncate text-[10px] text-muted-foreground">
          {note}
        </span>
      ) : null}
    </div>
  )
}

function Operator({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden
      className="self-center font-mono text-xs text-muted-foreground"
    >
      {children}
    </span>
  )
}

/**
 * An assigned app with room to work: its level and live meters at full size,
 * trim on a long slider with quick settings, and the steps from the control's
 * position to what Windows is set to. Grows out of the app's row and shrinks
 * back into it.
 */
export function AssignedAppDialog({
  app,
  control,
  controlName,
  controlPercent,
  levelPercent,
  mixerPercent,
  trimPercent,
  curve,
  conflictControls,
  onTrimDrag,
  onTrimRelease,
  onTrimSet,
  onMuteToggle,
  onRemove,
}: {
  app: ControlledApp
  control: number
  controlName: string
  controlPercent: number
  levelPercent: number
  mixerPercent: number
  trimPercent: number
  curve: { enabled: boolean; strength: number }
  conflictControls: number[]
  /** While the slider is being dragged, for live feedback without saving. */
  onTrimDrag: (trim: number) => void
  /** When it's let go, to save. */
  onTrimRelease: (trim: number) => void
  /** A quick setting, applied and saved in one go. */
  onTrimSet: (trim: number) => void
  onMuteToggle: (muted: boolean) => void
  onRemove: () => void
}) {
  const { setIsOpen } = useMorphingDialog()

  return (
    <MorphingDialogContent className="flex max-h-full w-[min(46rem,100%)] flex-col border bg-card shadow-2xl">
      <MorphingDialogClose label={`Close ${app.name}`} />

      <div className="flex shrink-0 items-center gap-4 border-b p-5 pr-14">
        <MorphingDialogShared
          name="icon"
          className="flex size-14 shrink-0 items-center justify-center overflow-hidden border bg-muted"
        >
          <AppIconContent app={app} iconClassName="size-7" />
        </MorphingDialogShared>

        <div className="min-w-0">
          <MorphingDialogTitle
            className={cn(
              "truncate font-heading text-2xl font-semibold",
              app.muted && "text-muted-foreground"
            )}
          >
            {app.name}
          </MorphingDialogTitle>
          <MorphingDialogSubtitle>
            <AppStatusLine
              app={app}
              suffix={`${controlName} · Control ${control}`}
            />
          </MorphingDialogSubtitle>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <MorphingDialogDescription className="space-y-6 p-5">
          <section className="space-y-5">
            <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
              {/* A fixed width, so nothing beside it moves between 9%, 28% and 100%. */}
              <div className="w-44 shrink-0">
                <SectionLabel>Level</SectionLabel>
                <div className="mt-2 flex items-start gap-1 leading-none">
                  <VolumeNumber
                    value={levelPercent}
                    className={cn(
                      "text-7xl tabular-nums",
                      app.muted && "text-muted-foreground/50"
                    )}
                  />
                  <span className="text-lg text-muted-foreground">%</span>
                </div>
              </div>

              <div className="flex min-w-0 flex-1 basis-80 items-stretch gap-1.5">
                <Stage label="Control" note={controlName}>
                  <VolumeNumber value={Math.round(controlPercent)} />%
                </Stage>
                <Operator>×</Operator>
                <Stage label="Trim" note="this app's share">
                  <VolumeNumber value={trimPercent} />%
                </Stage>
                <Operator>→</Operator>
                <Stage
                  label="Curve"
                  note={curve.enabled ? "logarithmic" : "straight through"}
                >
                  {curve.enabled ? `${Math.round(curve.strength)}%` : "Off"}
                </Stage>
                <Operator>→</Operator>
                <Stage label="Mixer" note="in Windows" emphasis>
                  {app.muted ? (
                    <span className="text-destructive">Muted</span>
                  ) : (
                    <>
                      <VolumeNumber
                        value={mixerPercent}
                        decimals={curve.enabled ? 2 : undefined}
                      />
                      %
                    </>
                  )}
                </Stage>
              </div>
            </div>

            <LevelMeter
              apps={app.sourceApps}
              gain={mixerPercent / 100}
              muted={app.muted}
              orientation="horizontal"
            />
          </section>

          <section className="space-y-3 border-t pt-5">
            <div className="flex items-baseline justify-between gap-4">
              <SectionLabel>Trim</SectionLabel>
              <span className="font-mono text-sm tabular-nums">
                <VolumeNumber value={trimPercent} />%
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              How much of Control {control}&apos;s position {app.name} gets.
              Lower it to sit this app below the others on the same control.
            </p>
            <Slider
              aria-label={`Trim for ${app.name}`}
              value={trimPercent}
              min={0}
              max={100}
              step={1}
              onValueChange={(value) =>
                onTrimDrag((typeof value === "number" ? value : value[0]) / 100)
              }
              onValueCommitted={(value) =>
                onTrimRelease(
                  (typeof value === "number" ? value : value[0]) / 100
                )
              }
            />
            <div className="flex flex-wrap gap-2">
              {TRIM_PRESETS.map((percent) => (
                <Button
                  key={percent}
                  type="button"
                  size="sm"
                  variant={percent === trimPercent ? "default" : "outline"}
                  onClick={() => onTrimSet(percent / 100)}
                >
                  {percent}%
                </Button>
              ))}
            </div>
          </section>

          {conflictControls.length > 0 ? (
            <div className="border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              Also controlled by Control {conflictControls.join(", Control ")}{" "}
              on this preset.
            </div>
          ) : null}
        </MorphingDialogDescription>
      </ScrollArea>

      {/* Pinned under the scrolling part, on its own background. Its buttons
          fade in and out with the rest of the window rather than flying over
          from the row: the remove tile would cross the whole window to reach
          the far side, and land well after everything else. Done stands the
          same height as the tiles. */}
      <div className="shrink-0 border-t bg-[color-mix(in_oklab,var(--card)_55%,var(--muted))] p-3">
        <MorphingDialogDescription className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${app.name} from Control ${control}`}
            title={`Remove from Control ${control}`}
            className="group flex size-10 items-center justify-center border bg-muted outline-none transition-colors hover:bg-destructive/10 focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <RiCloseLine className="size-5 text-muted-foreground transition-colors group-hover:text-destructive" />
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-pressed={app.muted}
              onClick={() => onMuteToggle(!app.muted)}
              aria-label={app.muted ? `Unmute ${app.name}` : `Mute ${app.name}`}
              title={app.muted ? "Unmute" : "Mute"}
              className={cn(
                "flex size-10 items-center justify-center border outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
                app.muted
                  ? "border-destructive/40 bg-destructive/10 hover:bg-destructive/20"
                  : "bg-muted hover:bg-muted/60"
              )}
            >
              {app.muted ? (
                <RiVolumeMuteLine className="size-5 text-destructive" />
              ) : (
                <RiVolumeUpLine className="size-5 text-muted-foreground" />
              )}
            </button>

            <Button
              type="button"
              className="h-10 px-4"
              onClick={() => setIsOpen(false)}
            >
              Done
            </Button>
          </div>
        </MorphingDialogDescription>
      </div>
    </MorphingDialogContent>
  )
}
