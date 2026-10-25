"use client"

import { useState } from "react"
import { RiDeleteBin6Line, RiErrorWarningLine, RiEyeLine, RiLayout2Line } from "@remixicon/react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { CurveChart } from "@/components/sections/mapping/curve-control"
import { VolumeNumber } from "@/components/volume-number"
import { previewOverlay } from "@/lib/bridge-client"
import { useLatestControlPercent } from "@/lib/control-volume-store"
import { clearNotifications, toast, useNotificationCount } from "@/lib/notifications"
import { shapePosition } from "@/lib/volume-levels"

import { useSettings } from "../settings-context"
import {
  maxDeadzonePercent,
  maxDisplayTimeMs,
  maxOverlayCards,
  maxOverlayEdgeMargin,
  maxOverlayGap,
  maxOverlayScale,
  minDisplayTimeMs,
  minOverlayScale,
  notificationHistoryLimits,
} from "../settings-config"
import { setSetting } from "../settings-schema"
import { OverlayCornerPicker } from "./overlay-corner-picker"
import {
  formatPercent,
  formatSeconds,
  SettingAction,
  SettingDependents,
  SettingMasterSwitch,
  SettingRow,
  SettingSegmented,
  SettingSlider,
  SettingsCard,
  SettingsGroup,
  SettingsPage,
  SettingSwitch,
} from "./settings-primitives"

const isDevelopment = process.env.NODE_ENV !== "production"

export function AppearanceSection() {
  return (
    <SettingsPage id="appearance">
      <SettingsGroup title="Theme">
        <SettingSegmented
          path="appearance.theme"
          options={[
            { value: "system", label: "System" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
      </SettingsGroup>
      <SettingsGroup title="Motion">
        <SettingSwitch path="appearance.animatedNumbers" />
      </SettingsGroup>
      <SettingsGroup title="Sidebar">
        <SettingSwitch path="appearance.sidebarTooltips" />
      </SettingsGroup>
      <SettingsGroup title="Title bar">
        <SettingSwitch path="appearance.toolbarReadout" />
      </SettingsGroup>
    </SettingsPage>
  )
}

export function StartupSection() {
  return (
    <SettingsPage id="startup">
      <SettingsGroup title="Launch">
        <SettingSwitch
          path="startup.launchOnStartup"
          // Windows would be told to launch this exact executable, which in a
          // dev build is a throwaway.
          disabled={isDevelopment}
          disabledReason="Not available in development builds."
        />
      </SettingsGroup>
    </SettingsPage>
  )
}

export function BehaviourSection() {
  const { config } = useSettings()
  const closingQuits = !config.behaviour.closeToTray

  return (
    <SettingsPage id="behaviour">
      <SettingsGroup title="Opening Volcon">
        <SettingSwitch path="startup.openToTray" />
        <SettingSwitch path="startup.reopenLastSection" />
      </SettingsGroup>
      <SettingsGroup title="Closing the window">
        <SettingSwitch path="behaviour.closeToTray" />
        <SettingSwitch
          path="behaviour.askBeforeQuitting"
          disabled={!closingQuits}
          disabledReason="Only asks when closing the window quits Volcon."
        />
      </SettingsGroup>
      {/* Said here as well as when it happens: it's easy to forget. */}
      {closingQuits ? (
        <p
          role="note"
          className="flex items-start gap-2.5 border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-pretty text-amber-700 dark:text-amber-300"
        >
          <RiErrorWarningLine aria-hidden className="mt-px size-4 shrink-0" />
          <span>
            Closing Volcon&apos;s window quits it. Your controls stop changing volume until you open
            Volcon again - from the Start menu, or when Windows starts if Launch with Windows is on.
          </span>
        </p>
      ) : null}
    </SettingsPage>
  )
}

const percentMarks = [0, 25, 50, 75, 100]

const formatPixels = (pixels: number) => `${pixels}px`

/** A mark on every whole second from `min` to `max`, and on `min` itself. */
const secondMarks = (min: number, max: number) => {
  const marks = [min]

  for (let at = Math.ceil(min / 1000) * 1000; at <= max; at += 1000) {
    if (at !== min) {
      marks.push(at)
    }
  }

  return marks
}

export function OverlaySection() {
  const { config, updateConfig } = useSettings()
  // The page's own switch: with the overlay off, nothing else here applies.
  const off = !config.overlay.enabled

  const showOverlay = () => {
    void previewOverlay().catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error)

      toast.error("Couldn't show the overlay", {
        source: "settings",
        detail: reason,
        event: { type: "action-failed", attempted: "Show a preview of the overlay", reason },
      })
    })
  }

  return (
    <SettingsPage id="overlay">
      <SettingMasterSwitch
        path="overlay.enabled"
        icon={RiLayout2Line}
        offNote="The overlay is off, so none of this applies until it's back on."
      />
      <SettingsGroup title="Placement">
        <SettingRow
          id="overlay.position"
          disabled={off}
          control={(aria) => (
            <OverlayCornerPicker
              {...aria}
              value={config.overlay.position}
              avoidTaskbar={config.overlay.avoidTaskbar}
              maxCards={config.overlay.maxCards}
              cardGap={config.overlay.cardGap}
              edgeMargin={config.overlay.edgeMargin}
              scale={config.overlay.scale}
              disabled={off}
              onValueChange={(position) =>
                updateConfig((current) => setSetting(current, "overlay.position", position))
              }
            />
          )}
        />
        <SettingSwitch path="overlay.avoidTaskbar" disabled={off} />
        <SettingSlider
          path="overlay.edgeMargin"
          min={0}
          max={maxOverlayEdgeMargin}
          format={formatPixels}
          ends={{ from: "Edge", to: "Inset" }}
          marks={[0, 20, 40, 60, 80]}
          disabled={off}
        />
      </SettingsGroup>
      <SettingsGroup title="Size">
        <SettingSlider
          path="overlay.scale"
          min={minOverlayScale}
          max={maxOverlayScale}
          step={0.05}
          format={(scale) => `${Number(scale.toFixed(2))}×`}
          ends={{ from: "Smaller", to: "Larger" }}
          marks={[0.5, 0.75, 1, 1.25, 1.5]}
          disabled={off}
        />
      </SettingsGroup>
      <SettingsGroup title="Stacking">
        <SettingSlider
          path="overlay.maxCards"
          min={1}
          max={maxOverlayCards}
          format={(count) => String(count)}
          ends={{ from: "Fewer", to: "More" }}
          marks={Array.from({ length: maxOverlayCards }, (_, index) => index + 1)}
          disabled={off}
        />
        <SettingSlider
          path="overlay.cardGap"
          min={0}
          max={maxOverlayGap}
          format={formatPixels}
          ends={{ from: "Tight", to: "Loose" }}
          marks={[0, 8, 16, 24]}
          disabled={off}
        />
      </SettingsGroup>
      <SettingsGroup title="Timing">
        <SettingSlider
          path="overlay.fadeDelayMs"
          min={1000}
          max={5000}
          step={100}
          format={formatSeconds}
          ends={{ from: "Sooner", to: "Later" }}
          marks={secondMarks(1000, 5000)}
          disabled={off}
        />
      </SettingsGroup>
      <SettingsGroup title="Hover">
        <SettingSlider
          path="overlay.hoverOpacity"
          min={0}
          max={100}
          step={5}
          format={formatPercent}
          ends={{ from: "Hidden", to: "Solid" }}
          marks={percentMarks}
          disabled={off}
        />
      </SettingsGroup>
      <SettingsGroup title="Preview">
        <SettingAction id="overlay.preview" disabled={off}>
          <Button type="button" variant="outline" size="sm" disabled={off} onClick={showOverlay}>
            <RiEyeLine />
            Show overlay
          </Button>
        </SettingAction>
      </SettingsGroup>
    </SettingsPage>
  )
}

export function NavigationSection() {
  return (
    <SettingsPage id="navigation">
      <SettingsGroup title="Back and forward">
        <SettingSwitch path="navigation.mouseButtons" />
        <SettingSwitch path="navigation.altArrows" />
      </SettingsGroup>
    </SettingsPage>
  )
}

export function MappingSection() {
  return (
    <SettingsPage id="mapping">
      <SettingsGroup title="Removing apps">
        <SettingSwitch path="mapping.confirmRemoveApp" />
      </SettingsGroup>
      <SettingsGroup title="Level meters">
        <SettingSwitch path="mapping.levelMeters" />
      </SettingsGroup>
    </SettingsPage>
  )
}

/**
 * Each display time with how long an ordinary message stays at it, worked out
 * by the same function that times the title bar, so the two can't disagree.
 */

export function NotificationsSection() {
  const { config } = useSettings()
  const logged = useNotificationCount()
  const [confirmingClear, setConfirmingClear] = useState(false)
  const titleBarOff = !config.notifications.titleBar
  const needsTitleBar = "Turn on Show in title bar to change this."

  return (
    <SettingsPage id="notifications">
      <SettingsGroup title="Title bar">
        <SettingsCard>
          <SettingSwitch path="notifications.titleBar" />
          <SettingDependents>
            <SettingSegmented
              path="notifications.titleBarLevel"
              disabled={titleBarOff}
              disabledReason={needsTitleBar}
              options={[
                { value: "all", label: "All" },
                { value: "warnings", label: "Warnings" },
                { value: "errors", label: "Errors" },
              ]}
            />
            <SettingSlider
              path="notifications.displayTimeMs"
              min={minDisplayTimeMs}
              max={maxDisplayTimeMs}
              step={100}
              format={formatSeconds}
              ends={{ from: "Shorter", to: "Longer" }}
              marks={secondMarks(minDisplayTimeMs, maxDisplayTimeMs)}
              disabled={titleBarOff}
              disabledReason={needsTitleBar}
            />
          </SettingDependents>
        </SettingsCard>
      </SettingsGroup>
      <SettingsGroup title="Sidebar">
        <SettingSwitch path="notifications.unreadBadge" />
      </SettingsGroup>
      <SettingsGroup title="History">
        <SettingSwitch path="notifications.keepHistory" />
        <SettingSegmented
          path="notifications.historyLimit"
          options={notificationHistoryLimits.map((limit) => ({
            value: limit,
            label: String(limit),
          }))}
        />
        <SettingSwitch path="notifications.groupRepeats" />
        <SettingAction
          id="notifications.clear"
          disabled={logged === 0}
          disabledReason="The log is already empty."
        >
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={logged === 0}
            onClick={() => setConfirmingClear(true)}
          >
            <RiDeleteBin6Line />
            Clear…
          </Button>
        </SettingAction>
      </SettingsGroup>
      <SettingsGroup title="Alerts">
        <SettingSwitch path="notifications.deviceAlerts" />
      </SettingsGroup>

      <Dialog open={confirmingClear} onOpenChange={setConfirmingClear}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Clear notification history?</DialogTitle>
            <DialogDescription>
              {logged === 1
                ? "The one notification in the log will be removed."
                : `All ${logged} notifications in the log will be removed.`}{" "}
              This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmingClear(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                clearNotifications()
                setConfirmingClear(false)
              }}
            >
              Clear history
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsPage>
  )
}

/**
 * The response curve as it's set right now, with the marker on whichever
 * control was turned last - so the setting can be judged by the knob in your
 * hand rather than by its number.
 */
function CurvePreview() {
  const { config } = useSettings()
  const curve = config.controller.logarithmicSensitivity
  const position = useLatestControlPercent(50)
  const level = Math.round(shapePosition(position / 100, curve) * 100)

  return (
    <div className="flex items-center gap-6 bg-muted/20 px-4 py-4">
      <CurveChart curve={curve} percent={position} width={200} height={80} />
      <div className="flex min-w-0 flex-col gap-3">
        {/* A key for the chart's two markers, in the same colours. */}
        <dl className="grid w-fit grid-cols-[auto_auto] gap-x-6 gap-y-1 font-mono text-[10px] tracking-[0.2em] uppercase">
          <dt className="flex items-center gap-2 text-muted-foreground">
            <span aria-hidden className="size-1.5 bg-foreground" />
            Control
          </dt>
          <dd className="text-right tabular-nums">
            <VolumeNumber value={position} />%
          </dd>
          <dt className="flex items-center gap-2 text-muted-foreground">
            <span
              aria-hidden
              className={curve.enabled ? "size-1.5 bg-primary" : "size-1.5 bg-muted-foreground"}
            />
            Volume
          </dt>
          <dd className={curve.enabled ? "text-right text-primary tabular-nums" : "text-right tabular-nums"}>
            <VolumeNumber value={level} />%
          </dd>
        </dl>
        <p className="text-xs text-pretty text-muted-foreground">
          Turn a control to see where it lands. The dashed line is no curve at all, so the gap
          between the two markers is what the curve takes off.
        </p>
      </div>
    </div>
  )
}

export function ControllerSection() {
  const { config } = useSettings()
  const curveOff = !config.controller.logarithmicSensitivity.enabled

  return (
    <SettingsPage id="controller">
      <SettingsGroup title="Response curve">
        <SettingsCard>
          <SettingSwitch path="controller.logarithmicSensitivity.enabled" />
          <SettingDependents>
            <SettingSlider
              path="controller.logarithmicSensitivity.strength"
              min={0}
              max={100}
              format={formatPercent}
              ends={{ from: "Subtle", to: "Strong" }}
              marks={percentMarks}
              disabled={curveOff}
              disabledReason="Turn on Logarithmic response to change this."
            />
          </SettingDependents>
          <CurvePreview />
        </SettingsCard>
      </SettingsGroup>
      <SettingsGroup title="Deadzone">
        <SettingSlider
          path="controller.deadzone"
          min={0}
          max={maxDeadzonePercent}
          format={(deadzone) => (deadzone === 0 ? "Off" : `${deadzone}%`)}
          ends={{ from: "Sensitive", to: "Steady" }}
          marks={Array.from({ length: maxDeadzonePercent / 2 + 1 }, (_, index) => index * 2)}
        />
      </SettingsGroup>
    </SettingsPage>
  )
}
