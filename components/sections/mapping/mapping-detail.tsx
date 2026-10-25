"use client"

import { useState, type ReactNode } from "react"

import { RestrictToVerticalAxis } from "@dnd-kit/abstract/modifiers"
import { DragDropProvider } from "@dnd-kit/react"
import { isSortable, useSortable } from "@dnd-kit/react/sortable"

import {
  RiAddLine,
  RiArrowLeftLine,
  RiBrainLine,
  RiDeleteBinLine,
  RiErrorWarningLine,
} from "@remixicon/react"

import { Button } from "@/components/ui/button"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { VolumeNumber } from "@/components/volume-number"
import { useControlPercent } from "@/lib/control-volume-store"
import { cn } from "@/lib/utils"
import { AssignedAppRow } from "./assigned-app-row"
import { useRemoveAppConfirmation } from "./confirm-remove-app"
import { CurveControl } from "./curve-control"
import { describeControl, isUnboundControl, type ControlledApp } from "./preset-config"
import { useRenameKey } from "./rename-key"

interface MappingDetailProps {
  control: number
  name: string
  /** Puts this mapping on a different control, by moving it. */
  onRelearn: () => void
  /** Level to show until the control reports a live position. */
  fallbackPercent: number
  /** MIDI port this preset listens to, shown so it's obvious what to reach for. */
  controllerId: string
  controllerConnected: boolean
  apps: ControlledApp[]
  conflictsFor: (app: ControlledApp) => number[]
  onBack: () => void
  onRename: (name: string) => void
  /** Asks to delete this mapping; the caller confirms first. */
  onDelete: () => void
  onAssignApp: () => void
  onRemoveApp: (app: ControlledApp) => void
  /** Moves the app at `from` to `to` in the list. */
  onReorderApps: (from: number, to: number) => void
  onTrimChange: (app: ControlledApp, trim: number) => void
  onTrimCommit: (app: ControlledApp, trim: number) => void
  onMuteToggle: (app: ControlledApp, muted: boolean) => void
}

/** The apps on a control are a list, so they're only dragged up and down. */
const verticalOnly = [RestrictToVerticalAxis]

/**
 * One app row's place in the list, picked up by the grip at its left edge and
 * dropped somewhere else. Hands the grip's ref to the row, which draws it.
 */
function SortableAppRow({
  id,
  index,
  children,
}: {
  id: string
  index: number
  children: (handleRef: (element: Element | null) => void) => ReactNode
}) {
  const { ref, handleRef, isDragSource } = useSortable({
    id,
    index,
    // Animated while dragging only: the drop has already put each row where it
    // belongs, so animating again on save would replay the shuffle.
    transition: {
      duration: 200,
      easing: "cubic-bezier(0.25, 1, 0.5, 1)",
      idle: false,
    },
  })

  return (
    <div ref={ref} className={cn("relative", isDragSource && "z-10 shadow-xl")}>
      {children(handleRef)}
    </div>
  )
}

/**
 * The control's live position, as a number and as a bar. Each subscribes to the
 * control on its own so a moving knob re-renders these and the app rows only,
 * rather than the whole screen — and neither is draggable: the level here is
 * whatever the controller last said it was.
 */
function ControlReadout({
  control,
  fallbackPercent,
}: {
  control: number
  fallbackPercent: number
}) {
  const percent = useControlPercent(control, fallbackPercent)

  return (
    <div className="flex items-start justify-end gap-1 leading-none">
      <VolumeNumber value={percent} className="text-6xl tabular-nums" />
      <span className="pt-1 text-xl text-muted-foreground">%</span>
    </div>
  )
}

function ControlMeter({
  control,
  fallbackPercent,
  hasApps,
}: {
  control: number
  fallbackPercent: number
  hasApps: boolean
}) {
  const percent = useControlPercent(control, fallbackPercent)

  // A readout, not a control: Progress has no thumb and nothing to grab, which is
  // the point — only the controller moves this.
  return (
    <Progress
      value={percent}
      aria-label={`${describeControl(control)} level`}
      className={`mt-6 ${hasApps ? "" : "opacity-40"}`}
    />
  )
}

export function MappingDetail({
  control,
  name,
  onRelearn,
  fallbackPercent,
  controllerId,
  controllerConnected,
  apps,
  conflictsFor,
  onBack,
  onRename,
  onDelete,
  onAssignApp,
  onRemoveApp,
  onReorderApps,
  onTrimChange,
  onTrimCommit,
  onMuteToggle,
}: MappingDetailProps) {
  const [isEditingName, setIsEditingName] = useState(false)
  const [draftName, setDraftName] = useState(name)
  const removal = useRemoveAppConfirmation()

  const mutedCount = apps.filter((app) => app.muted).length
  const deviceLabel = controllerId || "no controller selected"
  // Lost its control to another mapping: its apps wait here, unmoved.
  const unbound = isUnboundControl(control)
  const target = unbound ? "this mapping" : `Control ${control}`

  const startRenaming = () => {
    setDraftName(name)
    setIsEditingName(true)
  }

  const commitName = () => {
    const nextName = draftName.trim()
    onRename(nextName || (unbound ? name : `Control ${control}`))
    setIsEditingName(false)
  }

  // F2 renames, as it does in Windows.
  useRenameKey(startRenaming)

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex w-full items-center gap-2 border-b p-4">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <RiArrowLeftLine />
          Mapping
        </Button>
        <span aria-hidden className="text-muted-foreground">
          /
        </span>
        {isEditingName ? (
          <input
            value={draftName}
            autoFocus
            // Starts out selected, so typing replaces the name.
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setDraftName(event.target.value)}
            onBlur={commitName}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                commitName()
              }

              if (event.key === "Escape") {
                setDraftName(name)
                setIsEditingName(false)
              }
            }}
            aria-label="Mapping name"
            className="min-w-0 flex-1 border-b border-primary bg-transparent text-sm font-medium outline-hidden"
          />
        ) : (
          <button
            type="button"
            onClick={startRenaming}
            className="min-w-0 truncate border-b border-transparent text-sm font-medium transition-colors hover:border-border"
            title="Rename this mapping (F2)"
          >
            {name}
          </button>
        )}

        <Button
          variant="ghost"
          size="sm"
          onClick={onRelearn}
          className="ml-auto shrink-0"
          title="Put this mapping on a different control"
        >
          <RiBrainLine />
          {unbound ? "Learn a control" : "Relearn"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          className="shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <RiDeleteBinLine />
          Delete
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-6 p-4">
          {unbound ? (
            <div className="flex flex-wrap items-center gap-3 border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
              <RiErrorWarningLine className="size-4 shrink-0" />
              <span className="min-w-0 flex-1">
                Another mapping took over this one&apos;s control, so nothing moves these apps.
                Learn a control to use them again.
              </span>
              <Button size="sm" variant="outline" onClick={onRelearn}>
                <RiBrainLine />
                Learn a control
              </Button>
            </div>
          ) : null}

          <div className="flex gap-4">
            <section className="min-w-0 flex-1 border bg-card p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <p
                    className={cn(
                      "truncate font-mono text-[10px] tracking-[0.2em] uppercase",
                      unbound ? "text-amber-600 dark:text-amber-400" : "text-primary"
                    )}
                  >
                    {describeControl(control)} · {deviceLabel}
                    {controllerId && !controllerConnected ? (
                      <span className="text-destructive"> · disconnected</span>
                    ) : null}
                  </p>
                  <h2 className="mt-2 truncate font-heading text-4xl font-semibold">
                    {name}
                  </h2>
                </div>

                <div className="ml-auto text-right">
                  <p className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
                    Live level
                  </p>
                  <div className="mt-1">
                    {/* No control, no level: whatever it last read is history. */}
                    {unbound ? (
                      <span className="text-6xl leading-none text-muted-foreground">-</span>
                    ) : (
                      <ControlReadout
                        control={control}
                        fallbackPercent={fallbackPercent}
                      />
                    )}
                  </div>
                </div>
              </div>

              <ControlMeter
                control={control}
                fallbackPercent={fallbackPercent}
                hasApps={apps.length > 0 && !unbound}
              />
            </section>

            <CurveControl control={control} fallbackPercent={fallbackPercent} />
          </div>

          <section className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-heading text-lg font-semibold">
                  Assigned apps
                </h3>
                <p className="text-sm text-muted-foreground">
                  {unbound
                    ? `Kept for when this mapping is on a control again.`
                    : apps.length === 0
                      ? `Control ${control} isn't set to move anything yet.`
                      : `Control ${control} sets the volume of ${apps.length} app${apps.length === 1 ? "" : "s"}. Trim balances them against each other.`}
                </p>
              </div>

              <Button onClick={onAssignApp}>
                <RiAddLine />
                Assign app
              </Button>
            </div>

            <div className="space-y-2">
              {/* Dragged into a new order by each row's grip. The list is
                  reordered as a row moves, so the drop only has to say where it
                  ended up. */}
              <DragDropProvider
                modifiers={verticalOnly}
                onDragEnd={(event) => {
                  if (event.canceled) {
                    return
                  }

                  const { source } = event.operation

                  if (
                    isSortable(source) &&
                    source.initialIndex !== source.index
                  ) {
                    onReorderApps(source.initialIndex, source.index)
                  }
                }}
              >
                <div className="flex flex-col gap-2">
                  {apps.map((app, index) => (
                    <SortableAppRow key={app.id} id={app.id} index={index}>
                      {(handleRef) => (
                        <AssignedAppRow
                          app={app}
                          control={control}
                          controlName={name}
                          fallbackPercent={fallbackPercent}
                          conflictControls={conflictsFor(app)}
                          dragHandleRef={handleRef}
                          onTrimChange={(trim) => onTrimChange(app, trim)}
                          onTrimCommit={(trim) => onTrimCommit(app, trim)}
                          onMuteToggle={(muted) => onMuteToggle(app, muted)}
                          confirmRemove={() => removal.confirm(app, control)}
                          onRemove={() => onRemoveApp(app)}
                        />
                      )}
                    </SortableAppRow>
                  ))}
                </div>
              </DragDropProvider>

              <button
                type="button"
                onClick={onAssignApp}
                className="flex w-full items-center justify-center gap-2 border border-dashed p-4 text-sm text-muted-foreground transition-colors hover:border-border hover:bg-accent hover:text-foreground"
              >
                <RiAddLine className="size-4" />
                {apps.length === 0 ? `Assign an app to ${target}` : `Assign another app to ${target}`}
              </button>
            </div>
          </section>
        </div>
      </ScrollArea>

      <div className="flex items-center justify-center gap-4 border-t px-4 py-2 font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">
        <span>{apps.length} assigned</span>
        <span aria-hidden>
          {" "}
          <div className="size-0.5 bg-muted-foreground/50" />{" "}
        </span>
        <span className={mutedCount > 0 ? "text-destructive" : undefined}>
          {mutedCount} muted
        </span>
      </div>

      {removal.dialog}
    </div>
  )
}
