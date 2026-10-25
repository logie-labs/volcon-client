import { useRef, type ReactNode } from "react"

import { Progress } from "@/components/ui/progress"
import { VolumeNumber } from "@/components/volume-number"
import type { ControlledApp } from "./preset-config"

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  RiArrowRightLine,
  RiBrainLine,
  RiComputerLine,
  RiDeleteBinLine,
  RiEditBoxLine,
  RiErrorWarningLine,
  RiEyeLine,
  RiFileAddLine,
  RiFileCopy2Line,
} from "@remixicon/react"
import { cn } from "@/lib/utils"

/** Another preset a mapping can be moved or copied to. */
export type PresetTarget = {
  id: string
  name: string
  /**
   * What that preset already calls this control, if it maps it. The apps join
   * that mapping rather than replacing it.
   */
  mergesInto?: string
}

interface MappingCardProps {
  control: number
  name: string
  controlledApps: ControlledApp[]
  value: number
  /**
   * Lost its control to another card in a relearn: its apps are kept, but
   * nothing moves them until it's relearned.
   */
  unbound?: boolean
  onView?: () => void
  onRename?: () => void
  /** Puts the card on a different control, by moving it. */
  onRelearn?: () => void
  onDelete?: () => void
  /** The other presets the mapping can go to. */
  presetTargets?: PresetTarget[]
  onMoveToPreset?: (presetId: string) => void
  onCopyToPreset?: (presetId: string) => void
  /** Makes a preset to send the mapping to, so there's always somewhere to go. */
  onMoveToNewPreset?: () => void
  onCopyToNewPreset?: () => void
}

/**
 * A hover menu of the presets a mapping can be sent to, with New Preset at the
 * bottom. Only greyed out if neither is on offer.
 */
function PresetSubmenu({
  label,
  icon,
  targets,
  onPick,
  onNewPreset,
}: {
  label: string
  icon: ReactNode
  targets: PresetTarget[]
  onPick?: (presetId: string) => void
  onNewPreset?: () => void
}) {
  const choices = onPick ? targets : []

  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger disabled={choices.length === 0 && !onNewPreset}>
        {icon} {label}
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="max-w-72">
        {choices.map((target) => (
          <ContextMenuItem key={target.id} onClick={() => onPick?.(target.id)}>
            <span className="truncate">{target.name}</span>
            {target.mergesInto ? (
              <ContextMenuShortcut className="max-w-32 truncate pl-4 tracking-normal">
                into {target.mergesInto}
              </ContextMenuShortcut>
            ) : null}
          </ContextMenuItem>
        ))}
        {choices.length > 0 && onNewPreset ? <ContextMenuSeparator /> : null}
        {onNewPreset ? (
          <ContextMenuItem onClick={onNewPreset}>
            <RiFileAddLine className="text-muted-foreground" /> New Preset…
          </ContextMenuItem>
        ) : null}
      </ContextMenuSubContent>
    </ContextMenuSub>
  )
}

export function MappingCard({
  control,
  name,
  controlledApps,
  value,
  unbound = false,
  onView,
  onRename,
  onRelearn,
  onDelete,
  presetTargets = [],
  onMoveToPreset,
  onCopyToPreset,
  onMoveToNewPreset,
  onCopyToNewPreset,
}: MappingCardProps) {
  const suppressNextViewClickRef = useRef(false)
  const visibleApps = [...controlledApps]
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
    .slice(0, controlledApps.length <= 3 ? controlledApps.length : 2)
  const extraCount = Math.max(0, controlledApps.length - visibleApps.length)
  const percent = Math.max(0, Math.min(100, value))

  const runContextAction = (action?: () => void) => {
    // Context-menu item selection can emit a trailing click on the trigger.
    suppressNextViewClickRef.current = true
    window.setTimeout(() => {
      suppressNextViewClickRef.current = false
    }, 0)

    action?.()
  }

  const handleCardClick = () => {
    if (suppressNextViewClickRef.current) {
      suppressNextViewClickRef.current = false
      return
    }

    onView?.()
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <button
            type="button"
            aria-label={unbound ? `${name}, not on a control` : `${name} control ${control}`}
            onClick={handleCardClick}
            className={cn(
              "border bg-muted/30 flex w-full flex-col gap-2 text-left transition-colors hover:bg-muted/40 active:bg-muted/50 active:duration-0",
              unbound && "border-amber-500/40"
            )}
          />
        }
      >
          <div className="border-b flex justify-between items-center gap-2 p-1 px-1.5">
            <span className="min-w-0 truncate text-muted-foreground text-xs">{name}</span>
            {unbound ? (
              // Clear of the top-right corner, where the drag grip sits.
              <span className="mr-6 flex shrink-0 items-center gap-1 font-mono text-[10px] tracking-widest text-amber-600 uppercase dark:text-amber-400">
                <RiErrorWarningLine className="size-3" /> No control
              </span>
            ) : null}
          </div>
          <div className="flex flex-col gap-6 p-2">
            <div className="flex flex-row justify-between gap-4">
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="flex flex-row gap-2">
                  {controlledApps.length === 0 ? (
                    <div className="flex h-10 items-center rounded-md border border-dashed px-3 text-xs text-muted-foreground">
                      No controlled apps yet
                    </div>
                  ) : (
                    <>
                      {visibleApps.map((app) => (
                        <div
                          key={app.id}
                          className="bg-muted size-10 p-2 flex items-center justify-center aspect-square relative select-none"
                        >
                          {/* Nothing while it's playing; amber when it's open with no
                              audio session; red when it isn't running at all. */}
                          <div className={`w-full bottom-0 absolute transition-all ${app.available ? 'h-0!' : app.running ? 'bg-amber-500 h-0.5' : 'bg-destructive h-0.5'}` } />
                          {app.iconSrc ? (
                            <img src={app.iconSrc} alt={app.iconAlt} className={`size-fit select-none ${!app.running ? 'grayscale' : ''}`} />
                          ) : (
                            <RiComputerLine className="size-5 text-muted-foreground" />
                          )}
                        </div>
                      ))}

                      {extraCount > 0 ? (
                        <div className="bg-muted size-10 p-2 flex items-center justify-center select-none aspect-square">
                          + {extraCount}
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              </div>

              {unbound ? null : (
                <div className="flex flex-row items-start leading-none select-none gap-1">
                  <VolumeNumber value={percent} className="text-4xl" />
                  <span className="text-muted-foreground">%</span>
                </div>
              )}
            </div>

            {unbound ? (
              <div className="flex items-center gap-1.5 border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-700 dark:text-amber-300">
                <RiErrorWarningLine className="size-3.5 shrink-0" />
                Not on a control. Relearn it to use these apps again.
              </div>
            ) : (
              <Progress className="h-1" value={percent} />
            )}
          </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => onView?.()}><RiEyeLine className="text-muted-foreground" /> View</ContextMenuItem>
        <ContextMenuItem onClick={() => runContextAction(onRename)}>
          <RiEditBoxLine className="text-muted-foreground" /> Rename
          <ContextMenuShortcut className="tracking-normal">F2</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem disabled={!onRelearn} onClick={() => runContextAction(onRelearn)}>
          <RiBrainLine className="text-muted-foreground" /> {unbound ? "Learn a Control…" : "Relearn Control…"}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <PresetSubmenu
          label="Move to Preset"
          icon={<RiArrowRightLine className="text-muted-foreground" />}
          targets={presetTargets}
          onPick={onMoveToPreset && ((presetId) => runContextAction(() => onMoveToPreset(presetId)))}
          onNewPreset={onMoveToNewPreset && (() => runContextAction(onMoveToNewPreset))}
        />
        <PresetSubmenu
          label="Copy to Preset"
          icon={<RiFileCopy2Line className="text-muted-foreground" />}
          targets={presetTargets}
          onPick={onCopyToPreset && ((presetId) => runContextAction(() => onCopyToPreset(presetId)))}
          onNewPreset={onCopyToNewPreset && (() => runContextAction(onCopyToNewPreset))}
        />
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onClick={() => runContextAction(onDelete)}><RiDeleteBinLine /> Delete</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}