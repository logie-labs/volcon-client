"use client"

import { useMemo } from "react"
import { Dot } from "lucide-react"

import { VolumeNumber } from "@/components/volume-number"
import { useSetToolbarIndicator } from "@/components/window-toolbar-context"
import { useControlPercent } from "@/lib/control-volume-store"

interface MappingToolbarIndicatorProps {
    name: string
    control: number
    /** Level to show until the control reports a live position. */
    fallbackPercent: number
}

/**
 * Subscribes to the control itself so a moving knob updates the toolbar readout
 * without re-rendering the section that publishes it.
 */
export function MappingToolbarIndicator({ name, control, fallbackPercent }: MappingToolbarIndicatorProps) {
    const percent = useControlPercent(control, fallbackPercent)

    return (
        <div className="flex select-none items-center gap-1 leading-none">
            <span className="max-w-32 truncate font-heading text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                {name}
            </span>
            <Dot size={6} className="opacity-50" />
            <span className="flex items-baseline gap-0.5">
                <VolumeNumber value={percent} className="font-heading text-xs font-semibold tabular-nums" />
                <span className="text-[10px] text-muted-foreground">%</span>
            </span>
        </div>
    )
}

/**
 * Puts the open mapping's name and level in the middle of the title bar, or
 * clears it when no mapping is open. A hook of its own, taking plain values,
 * so it's only remade when what it shows changes.
 */
export function useMappingToolbarIndicator(name: string, control: number | undefined, fallbackPercent: number) {
    const indicator = useMemo(
        () =>
            control !== undefined ? (
                <MappingToolbarIndicator name={name} control={control} fallbackPercent={fallbackPercent} />
            ) : null,
        [name, control, fallbackPercent],
    )

    useSetToolbarIndicator(indicator)
}
