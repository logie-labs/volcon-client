"use client"

import { useEffect, useRef, useState } from "react"
import { animate, motion, useMotionValue, useTransform } from "motion/react"

import { RiGlobalLine } from "@remixicon/react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { VolumeNumber } from "@/components/volume-number"
import {
  loadSettingsConfig,
  saveSettingsConfig,
  type SettingsConfig,
} from "@/components/sections/settings/settings-config"
import { useControlPercent } from "@/lib/control-volume-store"
import { cn } from "@/lib/utils"
import { shapePosition, useActiveCurve, type VolumeCurve } from "@/lib/volume-levels"

type CurveSetting = SettingsConfig["controller"]["logarithmicSensitivity"]

const CHART_SAMPLES = 32

/**
 * The response curve, drawn rather than described: the dashed diagonal is a
 * straight line from control to level, and the solid line is the curve. Two
 * markers share the control's position: one on the diagonal for the control
 * itself, one on the curve for the volume it sets, so the gap between them is
 * what the curve is doing.
 */
export function CurveChart({
  curve,
  percent,
  width,
  height,
}: {
  curve: VolumeCurve
  percent: number
  width: number
  height: number
}) {
  // The curve as drawn, by its strength: no strength is the straight line, so
  // "off" is just a strength of 0. Turning it on or off bends the line into
  // place; dragging the strength follows at once.
  const target = curve.enabled ? curve.strength : 0
  const strength = useMotionValue(target)
  const position = useMotionValue(percent / 100)
  const wasEnabled = useRef(curve.enabled)

  useEffect(() => {
    if (wasEnabled.current === curve.enabled) {
      strength.set(target)
      return
    }

    wasEnabled.current = curve.enabled
    const bending = animate(strength, target, { duration: 0.4, ease: [0.4, 0, 0.2, 1] })
    return () => bending.stop()
  }, [curve.enabled, target, strength])

  useEffect(() => {
    position.set(percent / 100)
  }, [percent, position])

  // Worked out from the motion values as they change, rather than on render,
  // so the bend plays out without re-rendering the chart each frame.
  const shaped = (at: number) => shapePosition(at, { enabled: true, strength: strength.get() })
  const line = useTransform(() =>
    Array.from({ length: CHART_SAMPLES + 1 }, (_, index) => {
      const at = index / CHART_SAMPLES
      return `${at * width},${(1 - shaped(at)) * height}`
    }).join(" ")
  )
  const volumeY = useTransform(() => (1 - shaped(position.get())) * height)
  const volumeMarkerY = useTransform(() => volumeY.get() - 2.5)

  const control = { x: (percent / 100) * width, y: (1 - percent / 100) * height }

  return (
    <svg
      aria-hidden
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="overflow-visible"
    >
      <polyline points={`0,0 0,${height} ${width},${height}`} fill="none" className="stroke-border" />
      <line
        x1={0}
        y1={height}
        x2={width}
        y2={0}
        strokeDasharray="3 3"
        className="stroke-muted-foreground/40"
      />
      <motion.polyline
        points={line}
        fill="none"
        strokeWidth={1.5}
        className={cn(
          "transition-[stroke] duration-300",
          curve.enabled ? "stroke-primary" : "stroke-muted-foreground/70"
        )}
      />
      <motion.line
        x1={control.x}
        y1={control.y}
        x2={control.x}
        y2={volumeY}
        strokeDasharray="2 2"
        className="stroke-muted-foreground/60"
      />
      <rect
        x={control.x - 2.5}
        y={control.y - 2.5}
        width={5}
        height={5}
        className="fill-foreground"
      />
      <motion.rect
        x={control.x - 2.5}
        y={volumeMarkerY}
        width={5}
        height={5}
        className={cn(
          "transition-[fill] duration-300",
          curve.enabled ? "fill-primary" : "fill-muted-foreground"
        )}
      />
    </svg>
  )
}

/**
 * The logarithmic response in a box of its own beside the level, so the
 * readout changing width never pushes it about. Clicking it opens the setting,
 * which is global: the same one as in Settings, applied to every control.
 */
export function CurveControl({
  control,
  fallbackPercent,
}: {
  control: number
  fallbackPercent: number
}) {
  // The curve the backend confirms it's applying, not the setting as typed:
  // the box describes what you hear.
  const curve = useActiveCurve()
  const percent = useControlPercent(control, fallbackPercent)
  const [open, setOpen] = useState(false)
  const [setting, setSetting] = useState<CurveSetting | null>(null)
  // What the setting was when the dialog opened, for Cancel to put back.
  const [original, setOriginal] = useState<CurveSetting | null>(null)

  // Changes apply as you make them, so you can hear the curve while you set it.
  const update = (next: CurveSetting) => {
    setSetting(next)

    const config = loadSettingsConfig()
    saveSettingsConfig({
      ...config,
      controller: { ...config.controller, logarithmicSensitivity: next },
    })
  }

  const cancel = () => {
    if (
      original &&
      setting &&
      (original.enabled !== setting.enabled || original.strength !== setting.strength)
    ) {
      update(original)
    }

    setOpen(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          // Escape, the close button and a click outside all count as Cancel:
          // only Done keeps a change.
          cancel()
          return
        }

        // Read the stored setting fresh each time, in case Settings or the
        // command palette changed it since.
        const current = loadSettingsConfig().controller.logarithmicSensitivity
        setSetting(current)
        setOriginal(current)
        setOpen(true)
      }}
    >
      <DialogTrigger
        render={
          <button
            type="button"
            aria-label={`Logarithmic response: ${curve.enabled ? `${Math.round(curve.strength)}% strength` : "off"}`}
            className="flex shrink-0 flex-col justify-between gap-3 border bg-card p-4 text-left transition-colors hover:bg-muted/40 data-popup-open:bg-muted/40"
          />
        }
      >
        <div className="flex items-baseline justify-between gap-3 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          <span>Curve</span>
          <span className={curve.enabled ? "text-primary" : undefined}>
            {curve.enabled ? (
              <>
                <VolumeNumber value={Math.round(curve.strength)} />%
              </>
            ) : (
              "Off"
            )}
          </span>
        </div>
        <CurveChart curve={curve} percent={percent} width={104} height={64} />
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Logarithmic curve</DialogTitle>
          <DialogDescription>Gives the quiet end of each control more travel.</DialogDescription>
        </DialogHeader>

        <div className="flex items-start gap-2 border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          <RiGlobalLine className="mt-px size-3.5 shrink-0" />
          <span>Global setting: it changes every control on every preset.</span>
        </div>

        {setting ? (
          <>
            {/* Drawn from the setting as you drag, ahead of the backend confirming it. */}
            <div className="flex justify-center border bg-muted/20 py-3">
              <CurveChart curve={setting} percent={percent} width={240} height={80} />
            </div>

            {/* The same switch as in Settings, for the same setting. */}
            <label className="flex cursor-pointer items-center justify-between gap-3">
              <span className="text-sm font-medium">Logarithmic response</span>
              <Switch
                checked={setting.enabled}
                onCheckedChange={(enabled) => update({ ...setting, enabled })}
              />
            </label>

            <div className={setting.enabled ? undefined : "opacity-50"}>
              <div className="mb-2 flex justify-between font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                <span>Strength</span>
                <span className="tabular-nums">
                  <VolumeNumber value={setting.strength} />%
                </span>
              </div>
              <Slider
                aria-label="Logarithmic strength"
                value={setting.strength}
                min={0}
                max={100}
                step={1}
                disabled={!setting.enabled}
                onValueChange={(next) =>
                    update({ ...setting, strength: (typeof next === "number" ? next : next[0]) ?? setting.strength })
                }
              />
            </div>
          </>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={cancel}>
            Cancel
          </Button>
          <Button type="button" onClick={() => setOpen(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
