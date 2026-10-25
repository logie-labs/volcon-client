"use client"

import * as React from "react"
import {
  RiArrowGoBackLine,
  RiInformationLine,
  RiLockLine,
  RiResetLeftLine,
} from "@remixicon/react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { VolumeNumber } from "@/components/volume-number"
import { toast } from "@/lib/notifications"
import { cn } from "@/lib/utils"

import { SettingPreviewHint } from "./setting-previews"
import { settingChanges } from "../setting-changes"
import { useSettings } from "../settings-context"
import { undoSettingsChange } from "../settings-undo"
import {
  getSetting,
  getSettingEntry,
  isDefaultSetting,
  pageIsDefault,
  pagePaths,
  resetPage,
  resetSetting,
  setSetting,
  settingsPageMap,
  type SettingPath,
  type SettingValue,
  type SettingsSectionId,
} from "../settings-schema"

/** The settings whose value is a `V`, such as every on/off setting. */
type PathsOf<V> = { [P in SettingPath]: SettingValue<P> extends V ? P : never }[SettingPath]

/**
 * A page of settings: its title, what it covers, its groups, and - set apart at
 * the bottom - a way to put the whole page back to its defaults.
 */
export function SettingsPage({
  id,
  children,
}: {
  id: SettingsSectionId
  children: React.ReactNode
}) {
  const { config, updateConfig } = useSettings()
  const [confirming, setConfirming] = React.useState(false)
  const page = settingsPageMap[id]
  const paths = pagePaths(id)
  const changed = paths.length > 0 && !pageIsDefault(config, id)
  // What a reset would actually change, named in the confirmation.
  const changedLabels = paths
    .filter((path) => !isDefaultSetting(config, path))
    .map((path) => getSettingEntry(path).label)

  const reset = () => {
    const previous = config

    setConfirming(false)
    updateConfig((current) => resetPage(current, id))
    toast.success(`${page.title} settings reset`, {
      source: "settings",
      description: "Everything on the page is back to its default.",
      event: {
        type: "settings-changed",
        how: "page-reset",
        page: page.title,
        changes: settingChanges(previous, resetPage(previous, id), paths),
      },
      // Only this page's settings go back, so anything changed elsewhere since
      // stays changed; one on this page changed again since is asked about.
      undo: () =>
        undoSettingsChange({
          paths,
          before: previous,
          after: resetPage(previous, id),
          change: `the ${page.title} page reset`,
          afterLabel: "Reset to",
          undid: `the ${page.title} page was reset`,
          doneTitle: `${page.title} settings put back`,
        }),
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="font-heading text-lg font-semibold tracking-tight">{page.title}</h2>
        <p className="mt-1 text-sm text-pretty text-muted-foreground">{page.description}</p>
      </header>

      {children}

      {paths.length > 0 ? (
        <>
          <Separator className="mt-2" />
          <section className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <h3 className="text-sm font-medium">Reset this page</h3>
              <p className="mt-0.5 text-xs text-pretty text-muted-foreground">
                {changed
                  ? `Put every ${page.title} setting back to its default.`
                  : `Every ${page.title} setting is already at its default.`}
              </p>
            </div>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={!changed}
              onClick={() => setConfirming(true)}
            >
              <RiResetLeftLine />
              Reset this page…
            </Button>
          </section>

          <Dialog open={confirming} onOpenChange={setConfirming}>
            <DialogContent showCloseButton={false}>
              <DialogHeader>
                <DialogTitle>Reset {page.title} settings?</DialogTitle>
                <DialogDescription>
                  {changedLabels.length === 1
                    ? `${changedLabels[0]} goes back to its default.`
                    : `These go back to their defaults: ${changedLabels.join(", ")}.`}{" "}
                  Nothing on other pages changes.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
                <Button type="button" variant="destructive" onClick={reset}>
                  Reset this page
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      ) : null}
    </div>
  )
}

/**
 * Where a row sits: in a card of its own, as the setting a card is about, or
 * under that setting as one that depends on it.
 */
type RowPlace = "own-card" | "lead" | "dependent"

const RowPlaceContext = React.createContext<RowPlace>("own-card")

/**
 * A heading and the settings under it. Each setting is a card of its own -
 * only settings that depend on another share one, through `SettingsCard`. A
 * page that's one card throughout has no use for a heading, and leaves it out.
 */
export function SettingsGroup({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      {title ? (
        <h3 className="px-0.5 text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">
          {title}
        </h3>
      ) : null}
      <div className="flex flex-col gap-1.5">{children}</div>
    </section>
  )
}

/**
 * Rows that belong in one card. Mostly a setting and the settings that only
 * apply while it's on, so the hierarchy shows what turning it off switches
 * off: the first row is the one the rest depend on, and they go under it in
 * `SettingDependents`. Also facts that are read together, like versions.
 */
export function SettingsCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="divide-y border bg-card">
      <RowPlaceContext.Provider value="lead">{children}</RowPlaceContext.Provider>
    </div>
  )
}

/** The settings that depend on the one above them, indented beneath it. */
export function SettingDependents({ children }: { children: React.ReactNode }) {
  return (
    <div className="divide-y">
      <RowPlaceContext.Provider value="dependent">{children}</RowPlaceContext.Provider>
    </div>
  )
}

type RowAria = {
  "aria-labelledby": string
  "aria-describedby": string
}

type SettingRowProps = {
  /** The setting's entry in the schema, which names and describes it. */
  id: string
  /** What sits on the right. Given the ids that name and describe it. */
  control?: React.ReactNode | ((aria: RowAria) => React.ReactNode)
  disabled?: boolean
  /** Why it's disabled, said under the description while it is. */
  disabledReason?: string
  /** What a click anywhere else on the row does, for a row that's one switch. */
  onActivate?: () => void
  /** Anything wider than a control, under the row. */
  children?: React.ReactNode
  /**
   * The switch a whole page hangs off: louder than the rows it governs, with
   * the page's icon, and marked along its edge while it's on.
   */
  master?: { icon: React.ComponentType<{ className?: string }>; on: boolean }
}

/** Clicks on these are the control's, not the row's. */
const ownClicks =
  "button, a, input, select, textarea, label, [role=switch], [role=slider], [role=radio], [role=group]"

/**
 * One setting: its name and description from the schema, and its control. A
 * setting that's been changed can be put back to its default from the button
 * that appears on hover, or from its context menu.
 */
export function SettingRow({
  id,
  control,
  disabled,
  disabledReason,
  onActivate,
  children,
  master,
}: SettingRowProps) {
  const { config, updateConfig, highlight } = useSettings()
  const entry = getSettingEntry(id)
  const path = entry.path
  const changed = path ? !isDefaultSetting(config, path) : false
  const rowRef = React.useRef<HTMLDivElement>(null)
  const flashRef = React.useRef<HTMLSpanElement>(null)
  const labelId = React.useId()
  const descriptionId = React.useId()
  const reasonId = React.useId()
  const flash = highlight?.id === id ? highlight.nonce : null
  const showReason = Boolean(disabled && disabledReason)
  const place = React.useContext(RowPlaceContext)

  // Picked from a search: brought into view and lit up for a moment, so it's
  // obvious which row the result was.
  React.useEffect(() => {
    const row = rowRef.current
    const tint = flashRef.current

    if (flash === null || !row || !tint) {
      return
    }

    row.scrollIntoView({ block: "center", behavior: "smooth" })
    // A layer of the accent over the row, faded right down to nothing.
    // Opacity always eases smoothly, where blending one colour into another
    // can jump half way.
    tint.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 1800, easing: "ease-out" })
  }, [flash])

  const reset = () => {
    if (path) {
      updateConfig((current) => resetSetting(current, path))
    }
  }

  const aria: RowAria = {
    "aria-labelledby": labelId,
    "aria-describedby": showReason ? `${descriptionId} ${reasonId}` : descriptionId,
  }

  const activate =
    onActivate && !disabled
      ? (event: React.MouseEvent<HTMLDivElement>) => {
          if (!(event.target as HTMLElement).closest(ownClicks)) {
            onActivate()
          }
        }
      : undefined

  // A dependent is held back by the setting above it; anything else that's
  // unavailable just says why.
  const ReasonIcon = place === "dependent" ? RiLockLine : RiInformationLine

  const body = (
    <>
      {/* Lit up when the row is picked from search; at rest, not there. */}
      <span
        ref={flashRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-primary/20 opacity-0"
      />
      {/* A rule down the indent, tying a dependent to the setting it hangs
          off. Each row draws its own, so it stays beside that row's words. */}
      {place === "dependent" ? (
        <span aria-hidden className="absolute inset-y-3 left-6 w-px bg-border" />
      ) : null}
      <div
        className={cn(
          "flex items-center gap-4 pr-4",
          master ? "py-4" : "py-3",
          place === "dependent" ? "pl-11" : "pl-4"
        )}
      >
        {master ? (
          <span
            aria-hidden
            className={cn(
              "flex size-9 shrink-0 items-center justify-center border transition-colors",
              master.on ? "border-primary/40 bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
            )}
          >
            <master.icon className="size-4.5" />
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className={cn("transition-opacity", disabled && "opacity-50")}>
            {/* A ? after the name, for a setting with a picture of what it does. */}
            <span className="flex items-center gap-1.5">
              <span
                id={labelId}
                className={cn("font-medium", master ? "text-[15px] font-semibold" : "text-sm")}
              >
                {entry.label}
              </span>
              <SettingPreviewHint id={id} label={entry.label} />
            </span>
            <p id={descriptionId} className="mt-0.5 text-xs text-pretty text-muted-foreground">
              {entry.description}
            </p>
          </div>
          {showReason ? (
            <p
              id={reasonId}
              className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground"
            >
              <ReasonIcon className="size-3 shrink-0" />
              {disabledReason}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* The reset button's place is kept whether it's there or not, so
              changing a setting doesn't shove its row about. */}
          {path ? (
            <span className="flex size-7 shrink-0 items-center justify-center">
              {changed ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  title="Reset to default"
                  aria-label={`Reset ${entry.label} to its default`}
                  className="text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100"
                  onClick={reset}
                >
                  <RiArrowGoBackLine />
                </Button>
              ) : null}
            </span>
          ) : null}
          {typeof control === "function" ? control(aria) : control}
        </div>
      </div>
      {children}
    </>
  )

  const rowProps = {
    ref: rowRef,
    "data-setting-id": id,
    className: cn(
      "group/row relative select-none",
      place === "own-card" && "border bg-card",
      // A master switch is marked down its edge while it's on.
      master && "border-l-2 transition-colors",
      master && (master.on ? "border-l-primary" : "border-l-border"),
      activate && "cursor-pointer"
    ),
    onClick: activate,
  }

  if (!path) {
    return <div {...rowProps}>{body}</div>
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger {...rowProps}>
        {body}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem disabled={!changed} onClick={reset}>
          <RiArrowGoBackLine />
          Reset to default
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

type SettingControlProps = {
  disabled?: boolean
  disabledReason?: string
}

/** An on/off setting. The whole row is the switch. */
export function SettingSwitch({ path, disabled, disabledReason }: SettingControlProps & {
  path: PathsOf<boolean>
}) {
  const { config, updateConfig } = useSettings()
  const checked = getSetting(config, path)
  const set = (next: boolean) => updateConfig((current) => setSetting(current, path, next))

  return (
    <SettingRow
      id={path}
      disabled={disabled}
      disabledReason={disabledReason}
      onActivate={() => set(!checked)}
      control={(aria) => (
        <Switch {...aria} checked={checked} disabled={disabled} onCheckedChange={set} />
      )}
    />
  )
}

/**
 * The switch a whole page hangs off, set apart above a separator from the
 * settings it governs. They stay where they are rather than nesting under
 * it; while it's off they're greyed out, and one line here says why, instead
 * of every row repeating it.
 */
export function SettingMasterSwitch({
  path,
  icon,
  offNote,
}: {
  path: PathsOf<boolean>
  icon: React.ComponentType<{ className?: string }>
  /** What being off means for the rest of the page. */
  offNote: string
}) {
  const { config, updateConfig } = useSettings()
  const on = getSetting(config, path)
  const set = (next: boolean) => updateConfig((current) => setSetting(current, path, next))

  return (
    <div className="flex flex-col gap-5">
      <SettingRow
        id={path}
        master={{ icon, on }}
        onActivate={() => set(!on)}
        control={(aria) => <Switch {...aria} checked={on} onCheckedChange={set} />}
      />
      <Separator />
      {!on ? (
        <p className="-mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          <RiInformationLine className="size-3.5 shrink-0" />
          {offNote}
        </p>
      ) : null}
    </div>
  )
}

export type SegmentOption<P extends SettingPath> = {
  value: SettingValue<P>
  label: string
}

/** A setting with a few choices, all of them in view. */
export function SettingSegmented<P extends SettingPath>({
  path,
  options,
  disabled,
  disabledReason,
}: SettingControlProps & {
  path: P
  options: ReadonlyArray<SegmentOption<P>>
}) {
  const { config, updateConfig } = useSettings()
  const value = String(getSetting(config, path))

  return (
    <SettingRow
      id={path}
      disabled={disabled}
      disabledReason={disabledReason}
      control={(aria) => (
        <ToggleGroup
          {...aria}
          variant="outline"
          size="sm"
          spacing={0}
          value={[value]}
          disabled={disabled}
          onValueChange={(next) => {
            // Pressing the chosen one again would leave nothing chosen.
            const picked = options.find((option) => String(option.value) === next[0])

            if (picked) {
              updateConfig((current) => setSetting(current, path, picked.value))
            }
          }}
        >
          {options.map((option) => (
            <ToggleGroupItem
              key={String(option.value)}
              value={String(option.value)}
              className="aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:bg-primary/90 aria-pressed:hover:text-primary-foreground"
            >
              {option.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      )}
    />
  )
}

/**
 * A slider's value as its format writes it - "50%", "1.2 s", "1.25×" - with
 * the number rolling to each new value like the volume figures do, and the
 * unit left as it is. Anything that isn't a number to start with, such as
 * "Off", is shown as written.
 */
function AnimatedReadout({ text }: { text: string }) {
  const match = /^(-?\d+(?:\.(\d+))?)(.*)$/.exec(text)

  if (!match) {
    return text
  }

  return (
    <>
      <VolumeNumber value={Number(match[1])} decimals={match[2]?.length} />
      {match[3]}
    </>
  )
}

/** What moving a slider each way does, in a word for each end. */
export type SliderEnds = {
  /** The left end, such as "Clear". */
  from: string
  /** The right end, such as "Opaque". */
  to: string
}

type ScaleMark = {
  /** Where it sits along the track, 0 to 100. */
  position: number
  text: string
  active: boolean
  onPick: () => void
}

/**
 * A slider laid out the same way everywhere: what each end means above the
 * track, the track with its value beside it, and the increments below - each
 * number centred under a tick at exactly its place along the track.
 */
function SliderLayout({
  ends,
  scale,
  readout,
  disabled,
  children,
}: {
  ends: SliderEnds
  scale?: ScaleMark[]
  readout: React.ReactNode
  disabled?: boolean
  /** The slider itself. */
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[15rem_3.5rem] items-center gap-x-3 gap-y-1.5",
        disabled && "opacity-50"
      )}
    >
      <div className="flex justify-between text-[11px] leading-none text-muted-foreground">
        <span>{ends.from}</span>
        <span>{ends.to}</span>
      </div>
      <span aria-hidden />

      {/* Base UI's slider stretches to fill its parent, so it gets one of its
          own. */}
      <div className="min-w-0">{children}</div>
      <span className="text-right text-xs leading-none tabular-nums">
        {typeof readout === "string" ? <AnimatedReadout text={readout} /> : readout}
      </span>

      {scale ? (
        // Inset by half a thumb: a thumb's centre stops that far short of
        // either end, so that's where the ticks for the ends belong.
        <div className="px-1.5">
          <div className="relative h-6">
            {scale.map((mark) => (
              <button
                key={mark.position}
                type="button"
                // The slider is the way in from the keyboard; these are a
                // shortcut for the mouse.
                tabIndex={-1}
                disabled={disabled}
                onClick={mark.onPick}
                style={{ left: `${mark.position}%` }}
                className={cn(
                  "absolute top-0 flex -translate-x-1/2 flex-col items-center gap-1 text-[11px] leading-none whitespace-nowrap tabular-nums transition-colors disabled:pointer-events-none",
                  mark.active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <span
                  aria-hidden
                  className={cn("h-1.5 w-px", mark.active ? "bg-primary" : "bg-border")}
                />
                {mark.text}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

/**
 * A setting along a range: what each end means, the value beside the track,
 * and optionally numbered increments below it.
 */
export function SettingSlider({
  path,
  min,
  max,
  step = 1,
  format,
  ends,
  marks,
  disabled,
  disabledReason,
}: SettingControlProps & {
  path: PathsOf<number>
  min: number
  max: number
  step?: number
  format: (value: number) => string
  ends: SliderEnds
  /** Values to number along the track. */
  marks?: ReadonlyArray<number>
}) {
  const { config, updateConfig } = useSettings()
  const value = getSetting(config, path)
  const set = (next: number) => updateConfig((current) => setSetting(current, path, next))

  return (
    <SettingRow
      id={path}
      disabled={disabled}
      disabledReason={disabledReason}
      control={(aria) => (
        <SliderLayout
          ends={ends}
          disabled={disabled}
          readout={format(value)}
          scale={marks?.map((mark) => ({
            position: ((mark - min) / (max - min)) * 100,
            text: format(mark),
            active: mark === value,
            onPick: () => set(mark),
          }))}
        >
          <Slider
            aria-labelledby={aria["aria-labelledby"]}
            value={value}
            min={min}
            max={max}
            step={step}
            disabled={disabled}
            getAriaValueText={(_, current) => format(current)}
            onValueChange={(next) => {
              const picked = typeof next === "number" ? next : next[0]

              if (typeof picked === "number") {
                set(picked)
              }
            }}
          />
        </SliderLayout>
      )}
    />
  )
}

/** A row that does something rather than holding a value. */
export function SettingAction({
  id,
  disabled,
  disabledReason,
  children,
}: SettingControlProps & {
  id: string
  children: React.ReactNode
}) {
  return (
    <SettingRow id={id} disabled={disabled} disabledReason={disabledReason} control={children} />
  )
}

export const formatPercent = (value: number) => `${Math.round(value)}%`

/** "1.2 s", "5 s": to a tenth, without a trailing ".0". */
export const formatSeconds = (milliseconds: number) =>
  `${Number((milliseconds / 1000).toFixed(1))} s`
