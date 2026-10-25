"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react"

import { AnimatePresence, motion } from "framer-motion"
import {
    RiAddLine,
    RiApps2AddLine,
    RiBrainLine,
    RiDeleteBinLine,
    RiDraggable,
    RiEditBoxLine,
    RiFileAddLine,
    RiSettings2Line,
    RiStackLine,
    RiTerminalBoxLine,
} from "@remixicon/react"
import { invoke } from "@tauri-apps/api/core"
import { DragDropProvider } from "@dnd-kit/react"
import { isSortable, useSortable } from "@dnd-kit/react/sortable"

import { Button } from "@/components/ui/button"
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuRadioGroup,
    ContextMenuRadioItem,
    ContextMenuSeparator,
    ContextMenuShortcut,
    ContextMenuSub,
    ContextMenuSubContent,
    ContextMenuSubTrigger,
    ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
    Empty,
    EmptyContent,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
} from "@/components/ui/empty"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import {
    Drawer,
    DrawerContent,
    DrawerDescription,
    DrawerFooter,
    DrawerHeader,
    DrawerTitle,
} from "@/components/ui/drawer"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectSeparator,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { listen } from "@tauri-apps/api/event"
import { toast, type NotificationSource } from "@/lib/notifications"
import type { EventApp, NotificationEvent } from "@/lib/notification-events"

import ControllerStatus from "./controller-status"
import { MappingCard, type PresetTarget } from "./mapping-card"
import { MappingDetail } from "./mapping-detail"
import { useMappingToolbarIndicator } from "./mapping-toolbar-indicator"
import { ASSIGN_COMMAND_ID, useMappingCommands, type AssignEntry } from "./mapping-commands"
import {
    useCommandPalette,
    useRegisterCommands,
} from "@/components/command-palette/command-palette-context"
import { useSectionReselect } from "@/components/sections/active-section-context"
import { usePageInHistory } from "@/lib/navigation-history"
import {
    clearPendingMappingView,
    mappingViewRequestEvent,
    pendingMappingView,
} from "./mapping-navigation"
import { useRenameKey } from "./rename-key"
import { requestAppIcons, useAppDirectory } from "@/lib/app-icons"
import { sessionValue, setSessionValue } from "@/lib/session-state"
import {
    assignmentTrim,
    copyMappingToPreset,
    createEmptyPreset,
    createPresetId,
    buildControlledAppsFromAssignments,
    describeControl,
    getPresetAssignmentConflicts,
    isUnboundControl,
    relearnMapping,
    groupProcessesByApp,
    initialPresetConfig,
    rememberPresetConfig,
    removeMappingFromPreset,
    removePresetAssignment,
    upsertPresetAssignment,
    normalizeAppName,
    type ControlledApp,
    type MappingCardData,
    type PresetConfig,
    type PresetAssignment,
} from "./preset-config"
import { hasTauriRuntime } from "@/lib/tauri-runtime"
import { fireSideCannons } from "@/lib/celebrate"
import {
    activatePreset,
    beginLearn,
    pollLearn,
    releaseApps,
    selectInput,
    setAppLevels,
} from "@/lib/bridge-client"
import { useAudioSessions, useAudioSessionsLoaded, useMidiInputs, useRunningApps } from "@/context/volcon-context"
import {
    getControlPercents,
    getControlPosition,
    seedControlPosition,
    subscribeToControls,
    useControlPercent,
} from "@/lib/control-volume-store"
import { Dot } from "lucide-react"

let presetConfigCache = initialPresetConfig

/** A preset as it is now - the screen open or not - for an Undo to check before acting. */
function presetNow(presetId: string) {
    return presetConfigCache.presets.find((preset) => preset.id === presetId) ?? null
}

/** "1 app", "3 apps". */
function appCount(count: number) {
    return `${count} app${count === 1 ? "" : "s"}`
}

/** The open Mapping screen's own way to change its presets; null while it's closed. */
let changeOpenConfig: ((updater: (current: PresetConfig) => PresetConfig) => void) | null = null

/**
 * Changes the presets whether the Mapping screen is open or not. An Undo can be
 * pressed long after the screen that offered it has closed - from the
 * Notifications screen, say - and still has to land: with the screen closed,
 * the change is saved, and handed to the backend for the preset in use, so the
 * screen opens on it next time.
 */
function changePresetConfig(updater: (current: PresetConfig) => PresetConfig) {
    if (changeOpenConfig) {
        changeOpenConfig(updater)
        return
    }

    const next = updater(presetConfigCache)

    if (next === presetConfigCache) {
        return
    }

    presetConfigCache = next
    rememberPresetConfig(next)

    if (!hasTauriRuntime()) {
        return
    }

    void invoke("save_preset_config", { config: next }).catch(() => {
        // The screen loads whatever was saved last; nothing better to do here.
    })

    const active = next.presets.find((preset) => preset.id === next.activePresetId)

    if (active) {
        void activatePreset(active.id, active.controllerId, active.assignments).catch(() => {})
    }
}

/** The presets as saved, read fresh: a reset mustn't work from a stale copy. */
async function loadSavedPresetConfig() {
    const saved = hasTauriRuntime() ? await invoke<PresetConfig>("load_preset_config") : presetConfigCache
    presetConfigCache = saved
    return saved
}

/** Hands the apps on the preset in use back to Windows. */
function releaseActiveApps(config: PresetConfig) {
    const active = config.presets.find((preset) => preset.id === config.activePresetId)
    const apps = Array.from(new Set(active?.assignments.map((assignment) => assignment.app) ?? []))

    if (apps.length > 0 && hasTauriRuntime()) {
        void releaseApps(apps).catch(() => {})
    }
}

/** How many apps on how many controls, across how many presets. */
export type AssignmentCount = { apps: number; controls: number; presets: number }

export function countAssignments(config: PresetConfig): AssignmentCount {
    const withApps = config.presets.filter((preset) => preset.assignments.length > 0)

    return {
        apps: withApps.reduce((total, preset) => total + preset.assignments.length, 0),
        controls: withApps.reduce(
            (total, preset) => total + new Set(preset.assignments.map((assignment) => assignment.control)).size,
            0,
        ),
        presets: withApps.length,
    }
}

/** What a reset would take away, read from the presets as saved. */
export async function savedAssignmentCount() {
    return countAssignments(await loadSavedPresetConfig())
}

/**
 * Takes every app off every control, on every preset. The presets, their
 * controllers, and the controls learned on them stay. Answers what was there,
 * to put back with `restorePresetConfig`.
 */
export async function resetAllAssignments() {
    const previous = await loadSavedPresetConfig()

    changePresetConfig((current) => ({
        ...current,
        presets: current.presets.map((preset) => ({
            ...preset,
            assignments: [],
            mappings: preset.mappings.map((mapping) => ({ ...mapping, controlledApps: [] })),
        })),
    }))
    releaseActiveApps(previous)

    return { previous, count: countAssignments(previous) }
}

/** Every preset gone, as on a fresh install. */
export async function resetAllPresets() {
    const previous = await loadSavedPresetConfig()

    changePresetConfig(() => initialPresetConfig)
    releaseActiveApps(previous)

    // No preset in use any more: nothing for a control to move, and no
    // controller to listen to.
    if (hasTauriRuntime()) {
        void activatePreset("", "", []).catch(() => {})
    }
}

/** Puts the presets back as they were before a reset. */
export function restorePresetConfig(config: PresetConfig) {
    changePresetConfig(() => config)
}

const clampPercent = (value: number) => Math.max(0, Math.min(100, Math.round(value)))

function applyProgressSnapshotToConfig(config: PresetConfig, progressByControl: Record<number, number>) {
    const activePresetIndex = config.presets.findIndex((preset) => preset.id === config.activePresetId)

    if (activePresetIndex === -1) {
        return config
    }

    const activePreset = config.presets[activePresetIndex]
    let changed = false

    const nextMappings = activePreset.mappings.map((mapping) => {
        const nextValue = progressByControl[mapping.control]

        if (typeof nextValue !== "number") {
            return mapping
        }

        const clampedValue = clampPercent(nextValue)

        if (mapping.value === clampedValue) {
            return mapping
        }

        changed = true

        return {
            ...mapping,
            value: clampedValue,
        }
    })

    if (!changed) {
        return config
    }

    const nextPresets = [...config.presets]
    nextPresets[activePresetIndex] = {
        ...activePreset,
        mappings: nextMappings,
    }

    return {
        ...config,
        presets: nextPresets,
    }
}

function hasUnsavedProgress(config: PresetConfig, progressByControl: Record<number, number>) {
    return applyProgressSnapshotToConfig(config, progressByControl) !== config
}

/** A mapping's name, or its control if it was never given one. */
function mappingLabel(mapping: { control: number; name: string }) {
    return mapping.name.trim() || describeControl(mapping.control)
}

function LiveMappingCard({
    mapping,
    controlledApps,
    presetTargets,
    onView,
    onRename,
    onRelearn,
    onDelete,
    onMoveToPreset,
    onCopyToPreset,
    onMoveToNewPreset,
    onCopyToNewPreset,
}: {
    mapping: { control: number; name: string; value: number }
    controlledApps: ControlledApp[]
    presetTargets?: PresetTarget[]
    onView?: () => void
    onRename?: () => void
    onRelearn?: () => void
    onDelete?: () => void
    onMoveToPreset?: (presetId: string) => void
    onCopyToPreset?: (presetId: string) => void
    onMoveToNewPreset?: () => void
    onCopyToNewPreset?: () => void
}) {
    const percent = useControlPercent(mapping.control, mapping.value)

    return (
        <MappingCard
            control={mapping.control}
            name={mapping.name}
            controlledApps={controlledApps}
            value={percent}
            unbound={isUnboundControl(mapping.control)}
            presetTargets={presetTargets}
            onView={onView}
            onRename={onRename}
            onRelearn={onRelearn}
            onDelete={onDelete}
            onMoveToPreset={onMoveToPreset}
            onCopyToPreset={onCopyToPreset}
            onMoveToNewPreset={onMoveToNewPreset}
            onCopyToNewPreset={onCopyToNewPreset}
        />
    )
}

/**
 * One card's place in the grid, picked up by the grip in its top-right corner
 * and dropped somewhere else. Only the grip starts a drag, so the rest of the
 * card still opens on a click and still scrolls the grid on a touchpad.
 *
 * The grip sits over the card's header rather than inside it: the card is a
 * button, and a grip inside it would open the card every time it was let go.
 *
 * Takes a `ref` because AnimatePresence hands one down to measure the card as
 * it leaves; it has to reach the same element the sortable does.
 */
function SortableMappingItem({
    id,
    index,
    ref,
    children,
}: {
    id: string
    index: number
    ref?: Ref<HTMLDivElement>
    children: ReactNode
}) {
    const { ref: sortableRef, handleRef, isDragSource } = useSortable({
        id,
        index,
        // Animated while dragging only. The drop has already put every card where
        // it belongs, so animating again when the new order is saved would just
        // replay the shuffle.
        transition: { duration: 200, easing: "cubic-bezier(0.25, 1, 0.5, 1)", idle: false },
    })

    const setRef = useCallback(
        (element: HTMLDivElement | null) => {
            sortableRef(element)

            if (typeof ref === "function") {
                ref(element)
            } else if (ref) {
                ref.current = element
            }
        },
        [sortableRef, ref],
    )

    return (
        <motion.div
            ref={setRef}
            // For F2 to find the card it's pressed on.
            data-mapping-id={id}
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.18 }}
            // The card's own fill is see-through, which is right on the page and
            // wrong held over other cards. While it's carried it sits on the
            // page's colour, so it looks exactly as it did, only solid.
            className={`relative ${isDragSource ? "z-10 bg-background shadow-xl" : ""}`}
        >
            {children}
            <button
                ref={handleRef}
                type="button"
                aria-label="Drag to reorder"
                title="Drag to reorder"
                className="absolute top-px right-px flex h-6 w-7 cursor-grab touch-none items-center justify-center text-muted-foreground/60 transition-colors select-none hover:bg-muted/60 hover:text-foreground active:cursor-grabbing"
            >
                <RiDraggable className="size-3.5" />
            </button>
        </motion.div>
    )
}

export default function MappingSection() {
    const [config, setConfig] = useState<PresetConfig>(() => presetConfigCache)
    const availableControllers = useMidiInputs()
    // Opens on a mapping's own screen when history asked for one before the
    // screen was open; otherwise wherever it was left since Volcon opened - a
    // mapping's screen, or the grid.
    const [selectedMappingId, setSelectedMappingId] = useState<string | null>(() => {
        const requested = pendingMappingView()
        return requested !== undefined ? requested : (sessionValue<string | null>("mapping.view") ?? null)
    })

    useEffect(() => {
        setSessionValue("mapping.view", selectedMappingId)
    }, [selectedMappingId])
    // The grid and each mapping's screen are places to go back to.
    usePageInHistory("mapping", selectedMappingId)
    /** The mapping the rename and delete dialogs act on. */
    const [actionMappingId, setActionMappingId] = useState<string | null>(null)
    const [pendingPresetName, setPendingPresetName] = useState("")
    const [pendingPresetRename, setPendingPresetRename] = useState("")
    const [pendingMappingRename, setPendingMappingRename] = useState("")
    const [isCreatePresetOpen, setIsCreatePresetOpen] = useState(false)
    /** Set when the create dialog was opened to give a mapping somewhere to go. */
    const [pendingTransfer, setPendingTransfer] = useState<{
        mapping: MappingCardData
        mode: "move" | "copy"
    } | null>(null)
    const [isRenamePresetOpen, setIsRenamePresetOpen] = useState(false)
    const [isRenameMappingOpen, setIsRenameMappingOpen] = useState(false)
    const [isPresetSettingsOpen, setIsPresetSettingsOpen] = useState(false)
    const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false)
    const [isDeleteMappingConfirmOpen, setIsDeleteMappingConfirmOpen] = useState(false)
    const [isHydrated, setIsHydrated] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [learnDialogOpen, setLearnDialogOpen] = useState(false)
    const [learnDialogState, setLearnDialogState] = useState<{
        phase: "learning" | "learnt"
        control?: number
        /** Set when an existing mapping is being moved to another control. */
        relearning?: string
        /** What happened, said in the dialog once it's done. */
        outcome?: string
    }>({
        phase: "learning",
    })
    /**
     * A relearn that landed on a control another mapping already has, waiting
     * on whether to take it over.
     */
    const [relearnConflict, setRelearnConflict] = useState<{
        mappingId: string
        control: number
        occupantId: string
    } | null>(null)
    const learnSessionIdRef = useRef(0)
    const learnPollTimerRef = useRef<number | null>(null)
    const progressSaveTimerRef = useRef<number | null>(null)
    const configSaveTimerRef = useRef<number | null>(null)
    const latestConfigRef = useRef(config)
    const runningProcesses = useAudioSessions()
    const runningApps = useRunningApps()
    // The list waits for the first look at the audio sessions, so it doesn't
    // flash up while icons and processes warm. Ready once that look is done,
    // even if it found nothing; on its own in a browser there's nothing to
    // wait for.
    const isSessionReady = useAudioSessionsLoaded() || !hasTauriRuntime()
    const { open: openPalette } = useCommandPalette()
    // Where each app lives and how it looks, for apps that aren't running.
    const knownApps = useAppDirectory()
    const groupedProcesses = useMemo(() => groupProcessesByApp(runningProcesses, knownApps), [runningProcesses, knownApps])

    const activePreset = config.presets.find((preset) => preset.id === config.activePresetId) ?? config.presets[0]
    const selectedMapping = activePreset?.mappings.find((mapping) => mapping.id === selectedMappingId) ?? null
    const actionMapping = activePreset?.mappings.find((mapping) => mapping.id === actionMappingId) ?? null
    const hasPresets = config.presets.length > 0
    const isMappingDetailOpen = Boolean(selectedMapping)

    const mappingDisplayName = selectedMapping
        ? selectedMapping.name.trim() || `Control ${selectedMapping.control}`
        : ""

    useMappingToolbarIndicator(mappingDisplayName, selectedMapping?.control, selectedMapping?.value ?? 0)

    const activeControllerId = activePreset?.controllerId
    const controllerChoices = useMemo(() => {
        const choices = [...availableControllers]

        if (activeControllerId && !choices.includes(activeControllerId)) {
            choices.unshift(activeControllerId)
        }

        return choices
    }, [availableControllers, activeControllerId])

    const controllerState: "connected" | "busy" | "disconnected" | "waiting" = useMemo(() => {
        if (!activePreset || !activePreset.controllerId) {
            return "waiting"
        }

        const isAvailable = availableControllers.includes(activePreset.controllerId)
        if (!isAvailable) {
            return "disconnected"
        }

        return "connected"
    }, [activePreset, availableControllers, config.presets])

    const syncActivePreset = async (nextAssignments = activePreset?.assignments ?? []) => {
        if (!hasTauriRuntime() || !activePreset) {
            return
        }

        try {
            await activatePreset(activePreset.id, activePreset.controllerId, nextAssignments)
        } catch (caught) {
            reportError("Couldn't apply the preset", caught, "Unable to apply the preset.", {
                source: "presets",
                key: "preset-apply-error",
                fields: [{ label: "Preset", value: activePreset.name }],
                event: (reason) => ({ type: "preset-apply-failed", preset: activePreset.name, reason }),
            })
        }
    }

    /**
     * A failure: shown on the banner above the grid, and kept in the
     * notification log with whatever the backend actually said.
     */
    const reportError = (
        title: string,
        caught: unknown,
        fallback: string,
        options: {
            source?: NotificationSource
            key?: string
            fields?: Array<{ label: string; value: string }>
            /** What was going on, given the reason it went wrong. */
            event?: (reason: string) => NotificationEvent
        } = {},
    ) => {
        // Tauri commands reject with the backend's message as a plain string.
        const message =
            caught instanceof Error ? caught.message : typeof caught === "string" && caught ? caught : fallback

        setError(message)
        toast.error(title, {
            source: options.source ?? "mapping",
            key: options.key,
            description: message,
            detail: caught instanceof Error && caught.stack ? caught.stack : undefined,
            fields: options.fields,
            event: options.event?.(message),
        })
    }

    /** A problem the person can fix themselves: the banner, plus a warning. */
    const reportProblem = (
        title: string,
        description: string,
        source: NotificationSource = "mapping",
        event?: NotificationEvent,
    ) => {
        setError(description)
        toast.warning(title, { source, description, event })
    }

    /** The apps behind some assignments, once each, as a notification keeps them. */
    const eventApps = (apps: string[]): EventApp[] => {
        const seen = new Set<string>()

        return apps.flatMap((app) => {
            const key = normalizeAppName(app)

            if (seen.has(key)) {
                return []
            }

            seen.add(key)
            return [{ app, name: knownApps.name(app) ?? app.replace(/\.exe$/i, "") }]
        })
    }

    /** Puts the active preset's cards in a new order. */
    const reorderMappings = (from: number, to: number) => {
        setConfig((current) => ({
            ...current,
            presets: current.presets.map((preset) => {
                if (preset.id !== current.activePresetId || from === to) {
                    return preset
                }

                const mappings = [...preset.mappings]
                const [moved] = mappings.splice(from, 1)

                if (!moved) {
                    return preset
                }

                mappings.splice(to, 0, moved)

                return { ...preset, mappings }
            }),
        }))
    }

    const applyPresetSelection = (presetId: string) => {
        if (!presetId) {
            return
        }

        if (presetId === "new") {
            setPendingPresetName("")
            setIsCreatePresetOpen(true)
            return
        }

        setConfig((current) => ({
            ...current,
            activePresetId: presetId,
        }))
    }

    const activePresetAssignments = activePreset ? activePreset.assignments : []
    const selectedMappingControlledApps = selectedMapping
        ? buildControlledAppsFromAssignments(activePresetAssignments, selectedMapping.control, runningProcesses, knownApps, runningApps)
        : []

    useEffect(() => {
        let cancelled = false

        const loadConfig = async () => {
            try {
                // On its own in a browser there's no saved config, so the
                // starting one stands.
                const loadedConfig = hasTauriRuntime()
                    ? await invoke<PresetConfig>("load_preset_config")
                    : initialPresetConfig

                if (!cancelled) {
                    setConfig(loadedConfig)
                }
            } catch {
                if (!cancelled) {
                    setConfig(initialPresetConfig)
                }
            } finally {
                if (!cancelled) {
                    setIsHydrated(true)
                }
            }
        }

        void loadConfig()

        return () => {
            cancelled = true
        }
    }, [])

    // An Undo pressed elsewhere goes through this screen while it's open.
    useEffect(() => {
        changeOpenConfig = setConfig

        return () => {
            changeOpenConfig = null
        }
    }, [])

    useEffect(() => {
        presetConfigCache = config
        latestConfigRef.current = config

        // Once it's the real thing, for the Notifications screen to read.
        if (isHydrated) {
            rememberPresetConfig(config)
        }
    }, [config, isHydrated])

    // Seed each mapping with the level it was left at, so a control that hasn't been
    // touched since launch shows its real position rather than zero.
    useEffect(() => {
        for (const mapping of activePreset?.mappings ?? []) {
            seedControlPosition(mapping.control, mapping.value)
        }
    }, [activePreset?.id, activePreset?.mappings])

    // NOTE: rendering of a loading UI is done later to avoid changing hook call order.

    useEffect(() => {
        if (!hasTauriRuntime()) {
            return
        }

        let unlisten = () => {}

        void listen<{ presetId?: string }>("volcon:preset-selected", (event) => {
            const presetId = event.payload?.presetId
            if (typeof presetId === "string") {
                applyPresetSelection(presetId)
            }
        }).then((cleanup) => {
            unlisten = cleanup
        })

        return () => {
            unlisten()
        }
    }, [])

    // Every assigned app's icon, read from its executable: where it was last
    // seen running, or where it was when it was assigned. One that can't be
    // read keeps the last icon it was seen with.
    useEffect(() => {
        requestAppIcons(
            config.presets.flatMap((preset) =>
                preset.assignments.map((assignment) => ({ app: assignment.app, path: assignment.path })),
            ),
        )
    }, [config.presets])

    // Keep process groups collapsed by default — user requested trees closed by default.

    useEffect(() => {
        if (!hasTauriRuntime() || !activePreset) {
            return
        }

        void activatePreset(activePreset.id, activePreset.controllerId, activePreset.assignments)
    }, [activePreset?.id, activePreset?.controllerId, activePreset?.assignments])

    // Fold the live positions back into the config on a debounce. This subscribes to
    // the position store rather than depending on it through React, so a knob sweep
    // costs one timer reset per frame instead of a re-render per MIDI message.
    useEffect(() => {
        if (!hasTauriRuntime()) {
            return
        }

        const scheduleProgressSave = () => {
            if (progressSaveTimerRef.current !== null) {
                return
            }

            progressSaveTimerRef.current = window.setTimeout(() => {
                progressSaveTimerRef.current = null

                if (!hasUnsavedProgress(latestConfigRef.current, getControlPercents())) {
                    return
                }

                setConfig((current) => applyProgressSnapshotToConfig(current, getControlPercents()))
            }, 600)
        }

        const unsubscribe = subscribeToControls(scheduleProgressSave)

        return () => {
            unsubscribe()

            if (progressSaveTimerRef.current !== null) {
                window.clearTimeout(progressSaveTimerRef.current)
                progressSaveTimerRef.current = null
            }
        }
    }, [])

    // Debounced so a trim drag doesn't rewrite the config file on every pointer move.
    useEffect(() => {
        if (!isHydrated || !hasTauriRuntime()) {
            return
        }

        if (configSaveTimerRef.current !== null) {
            window.clearTimeout(configSaveTimerRef.current)
        }

        configSaveTimerRef.current = window.setTimeout(() => {
            configSaveTimerRef.current = null
            void invoke("save_preset_config", { config })
        }, 400)

        return () => {
            if (configSaveTimerRef.current !== null) {
                window.clearTimeout(configSaveTimerRef.current)
                configSaveTimerRef.current = null
            }
        }
    }, [config, isHydrated])

    useEffect(() => {
        const flushProgress = async () => {
            if (!hasTauriRuntime()) {
                return
            }

            const nextConfig = applyProgressSnapshotToConfig(latestConfigRef.current, getControlPercents())
            const hasPendingSave = configSaveTimerRef.current !== null

            if (nextConfig === latestConfigRef.current && !hasPendingSave) {
                return
            }

            presetConfigCache = nextConfig

            try {
                await invoke("save_preset_config", { config: nextConfig })
            } catch {
                // Ignore teardown-time failures; the next load will hydrate from the last saved file.
            }
        }

        const handleBeforeUnload = () => {
            void flushProgress()
        }

        window.addEventListener("beforeunload", handleBeforeUnload)

        return () => {
            window.removeEventListener("beforeunload", handleBeforeUnload)

            if (progressSaveTimerRef.current !== null) {
                window.clearTimeout(progressSaveTimerRef.current)
                progressSaveTimerRef.current = null
            }

            void flushProgress()

            if (configSaveTimerRef.current !== null) {
                window.clearTimeout(configSaveTimerRef.current)
                configSaveTimerRef.current = null
            }
        }
    }, [])

    const createPreset = () => {
        const presetName = pendingPresetName.trim()

        if (!presetName) {
            return
        }

        // Opened from a card's Move or Copy menu: the new preset is somewhere to
        // send that mapping, not a preset to switch to.
        if (pendingTransfer) {
            sendMappingToNewPreset(pendingTransfer.mapping, pendingTransfer.mode, presetName)
            setPendingTransfer(null)
            setPendingPresetName("")
            setIsCreatePresetOpen(false)
            return
        }

        const controllerId = controllerChoices[0] ?? ""
        // Worked out before the update, as when sending a mapping to a new
        // preset, so the notification can find the preset again later.
        const nextId = createPresetId(presetName, config.presets.map((preset) => preset.id))

        setConfig((current) => ({
            ...current,
            activePresetId: nextId,
            presets: [...current.presets, createEmptyPreset(nextId, presetName, controllerId)],
        }))

        toast.success(`Created ${presetName}`, {
            source: "presets",
            description: controllerId
                ? `Listening to ${controllerId}. Learn a control to start mapping.`
                : "Pick a controller in its settings, then learn a control.",
            event: { type: "preset-created", preset: presetName, presetId: nextId, device: controllerId || undefined },
        })

        setPendingPresetName("")
        setIsCreatePresetOpen(false)
    }

    const openCreatePresetDialog = () => {
        setPendingTransfer(null)
        setPendingPresetName("")
        setIsCreatePresetOpen(true)
    }

    const openCreatePresetFor = (mapping: MappingCardData, mode: "move" | "copy") => {
        setPendingTransfer({ mapping, mode })
        setPendingPresetName("")
        setIsCreatePresetOpen(true)
    }

    const openMappingDetail = (mappingId: string) => {
        setSelectedMappingId(mappingId)
    }

    const closeMappingDetail = () => {
        setSelectedMappingId(null)
    }

    // Clicking Mapping in the sidebar while already here goes back to the grid.
    useSectionReselect("mapping", closeMappingDetail)

    // Going back or forward to the grid or a mapping's screen while this one is
    // open. The request that opened it has done its job either way.
    useEffect(() => {
        clearPendingMappingView()

        const handleViewRequest = (event: Event) => {
            clearPendingMappingView()
            setSelectedMappingId((event as CustomEvent<string | null>).detail ?? null)
        }

        window.addEventListener(mappingViewRequestEvent, handleViewRequest)
        return () => window.removeEventListener(mappingViewRequestEvent, handleViewRequest)
    }, [])

    // The rename and delete dialogs act on a mapping of their own rather than the
    // open one, so using them from a card's menu doesn't open that card.
    const openRenameMappingDialog = (mapping: MappingCardData) => {
        setActionMappingId(mapping.id)
        setPendingMappingRename(mapping.name)
        setIsRenameMappingOpen(true)
    }

    // F2 on the grid renames a card, as it renames a file in Windows: the one
    // that has keyboard focus, or else the one under the pointer. A mapping's
    // own screen renames in place instead.
    useRenameKey(() => {
        if (isMappingDetailOpen) {
            return
        }

        const focused = document.activeElement?.matches(":focus-visible")
            ? document.activeElement.closest("[data-mapping-id]")
            : null
        const card = focused ?? document.querySelector("[data-mapping-id]:hover")
        const mapping = activePreset?.mappings.find(
            (candidate) => candidate.id === card?.getAttribute("data-mapping-id"),
        )

        if (mapping) {
            openRenameMappingDialog(mapping)
        }
    })

    const openDeleteMappingDialog = (mappingId: string) => {
        setActionMappingId(mappingId)
        setIsDeleteMappingConfirmOpen(true)
    }

    const openRenamePresetDialog = () => {
        if (!activePreset) {
            return
        }

        setPendingPresetRename(activePreset.name)
        setIsRenamePresetOpen(true)
    }

    const renameActivePreset = () => {
        const nextName = pendingPresetRename.trim()

        if (!activePreset || !nextName) {
            return
        }

        setConfig((current) => ({
            ...current,
            presets: current.presets.map((preset) =>
                preset.id === current.activePresetId
                    ? {
                        ...preset,
                        name: nextName,
                    }
                    : preset,
            ),
        }))

        setIsRenamePresetOpen(false)
    }

    const deleteActivePreset = () => {
        if (!activePreset) {
            return
        }

        setIsDeleteConfirmOpen(true)
    }

    const renameSelectedMappingTo = (nextName: string) => {
        if (!activePreset || !selectedMapping) {
            return
        }

        setConfig((current) => ({
            ...current,
            presets: current.presets.map((preset) =>
                preset.id === current.activePresetId
                    ? {
                        ...preset,
                        mappings: preset.mappings.map((mapping) =>
                            mapping.id === selectedMapping.id
                                ? {
                                    ...mapping,
                                    name: nextName,
                                }
                                : mapping,
                        ),
                        assignments: preset.assignments.map((assignment) =>
                            assignment.control === selectedMapping.control
                                ? {
                                    ...assignment,
                                    label: nextName,
                                }
                                : assignment,
                        ),
                    }
                    : preset,
            ),
        }))
    }

    const renameActionMapping = () => {
        if (!activePreset || !actionMapping) {
            return
        }

        const nextName = pendingMappingRename.trim()
        if (!nextName) {
            return
        }

        setConfig((current) => ({
            ...current,
            presets: current.presets.map((preset) =>
                preset.id === current.activePresetId
                    ? {
                        ...preset,
                        mappings: preset.mappings.map((mapping) =>
                            mapping.id === actionMapping.id
                                ? {
                                    ...mapping,
                                    name: nextName,
                                }
                                : mapping,
                        ),
                        assignments: preset.assignments.map((assignment) =>
                            assignment.control === actionMapping.control
                                ? {
                                    ...assignment,
                                    label: nextName,
                                }
                                : assignment,
                        ),
                    }
                    : preset,
            ),
        }))

        setIsRenameMappingOpen(false)
    }

    const confirmDeleteActionMapping = () => {
        if (!activePreset || !actionMapping) {
            return
        }

        setConfig((current) => ({
            ...current,
            presets: current.presets.map((preset) =>
                preset.id === current.activePresetId
                    ? removeMappingFromPreset(preset, actionMapping)
                    : preset,
            ),
        }))

        releaseControlApps(actionMapping.control)
        setIsDeleteMappingConfirmOpen(false)

        // Enough to put it back exactly where it was, apps and all.
        const removed = actionMapping
        const presetId = activePreset.id
        const presetName = activePreset.name
        const index = activePreset.mappings.findIndex((mapping) => mapping.id === removed.id)
        const removedAssignments = activePreset.assignments.filter(
            (assignment) => assignment.control === removed.control,
        )

        toast.success(`Deleted ${mappingLabel(removed)}`, {
            source: "mapping",
            description:
                removedAssignments.length > 0
                    ? `${removedAssignments.length} app${removedAssignments.length === 1 ? " was" : "s were"} handed back to Windows.`
                    : undefined,
            fields: [
                { label: "Preset", value: activePreset.name },
                { label: "Control", value: String(removed.control) },
            ],
            event: {
                type: "mapping-deleted",
                mapping: mappingLabel(removed),
                control: removed.control,
                preset: activePreset.name,
                apps: eventApps(removedAssignments.map((assignment) => assignment.app)),
            },
            undo: () => {
                const preset = presetNow(presetId)

                if (!preset) {
                    return { done: false, reason: `${presetName} has been deleted since.` }
                }

                const occupant = preset.mappings.find((mapping) => mapping.control === removed.control)

                if (occupant) {
                    return {
                        done: false,
                        reason: `${mappingLabel(occupant)} is on ${describeControl(removed.control)} now, so ${mappingLabel(removed)} can't go back on it.`,
                    }
                }

                changePresetConfig((current) => ({
                    ...current,
                    presets: current.presets.map((entry) => {
                        if (entry.id !== presetId) {
                            return entry
                        }

                        const mappings = [...entry.mappings]
                        mappings.splice(Math.max(0, Math.min(index, mappings.length)), 0, removed)

                        return {
                            ...entry,
                            mappings,
                            assignments: [...entry.assignments, ...removedAssignments],
                        }
                    }),
                }))

                const apps = eventApps(removedAssignments.map((assignment) => assignment.app)).length

                return {
                    done: true,
                    title: `${mappingLabel(removed)} is back`,
                    description: apps > 0
                        ? `On ${describeControl(removed.control)} in ${presetName}, with its ${appCount(apps)}.`
                        : `On ${describeControl(removed.control)} in ${presetName}.`,
                }
            },
        })

        if (actionMapping.id === selectedMappingId) {
            closeMappingDetail()
        }
    }

    const commitMappingAssignments = (nextAssignments: PresetAssignment[]) => {
        if (!activePreset) {
            return
        }

        setConfig((current) => ({
            ...current,
            presets: current.presets.map((preset) =>
                preset.id === current.activePresetId
                    ? {
                        ...preset,
                        assignments: nextAssignments,
                    }
                    : preset,
            ),
        }))

        void syncActivePreset(nextAssignments)
    }

    const controlName = (control: number) =>
        activePreset?.mappings.find((mapping) => mapping.control === control)?.name ??
        `Control ${control}`

    const controlFallbackPercent = (control: number) =>
        activePreset?.mappings.find((mapping) => mapping.control === control)?.value ?? 0

    /** The raw 0-127 position of a control, for commands that set a volume target. */
    const controlValue = (control: number) =>
        getControlPosition(control)?.value ??
        Math.round((Math.max(0, Math.min(100, controlFallbackPercent(control))) / 100) * 127)

    const assignAppsToControl = (control: number, entries: AssignEntry[]) => {
        if (!activePreset || entries.length === 0) {
            return
        }

        const label = controlName(control)
        const nextAssignments = entries.reduce(
            (assignments, entry) =>
                upsertPresetAssignment(assignments, {
                    control,
                    app: entry.app,
                    label,
                    path: entry.path ?? null,
                    trim: 1,
                    muted: false,
                }),
            activePreset.assignments,
        )

        commitMappingAssignments(nextAssignments)
    }

    const removeAppsFromControl = (control: number, apps: string[]) => {
        if (!activePreset || apps.length === 0) {
            return
        }

        const nextAssignments = apps.reduce(
            (assignments, entry) => removePresetAssignment(assignments, control, entry),
            activePreset.assignments,
        )

        commitMappingAssignments(nextAssignments)

        // Hand the app back to Windows at its current volume rather than leaving it
        // muted by a mapping that no longer exists.
        if (hasTauriRuntime()) {
            void releaseApps(apps).catch(() => {
                // Nothing to undo: the app simply was not under our control.
            })
        }
    }

    /** Every other preset, as somewhere a mapping on this one can be sent. */
    const presetTargetsFor = (control: number): PresetTarget[] =>
        config.presets
            .filter((preset) => preset.id !== activePreset?.id)
            .map((preset) => {
                const existing = preset.mappings.find((mapping) => mapping.control === control)

                return {
                    id: preset.id,
                    name: preset.name,
                    mergesInto: existing ? mappingLabel(existing) : undefined,
                }
            })

    /**
     * Sends a mapping, with the apps under it, to another preset. A copy leaves
     * this preset as it is; a move takes the mapping off it and hands its apps
     * back to Windows, the way removing them from a control does.
     */
    const sendMappingToPreset = (
        mapping: MappingCardData,
        targetPresetId: string,
        mode: "move" | "copy",
    ) => {
        const target = config.presets.find((preset) => preset.id === targetPresetId)

        if (!activePreset || !target || target.id === activePreset.id) {
            return
        }

        setConfig((current) => {
            const source = current.presets.find((preset) => preset.id === current.activePresetId)

            if (!source) {
                return current
            }

            return {
                ...current,
                presets: current.presets.map((preset) => {
                    if (preset.id === targetPresetId) {
                        return copyMappingToPreset(preset, mapping, source.assignments)
                    }

                    if (mode === "move" && preset.id === source.id) {
                        return removeMappingFromPreset(preset, mapping)
                    }

                    return preset
                }),
            }
        })

        const existing = target.mappings.find((entry) => entry.control === mapping.control)

        announceTransfer(mapping, mode, target, existing ? mappingLabel(existing) : undefined)
        finishTransfer(mapping, mode)
    }

    /**
     * The same, into a preset made for it on the spot. The new preset listens to
     * the same controller as this one, since a control's number only means
     * something on the device it came from, and this preset stays the active one.
     */
    const sendMappingToNewPreset = (
        mapping: MappingCardData,
        mode: "move" | "copy",
        presetName: string,
    ) => {
        // Worked out here as well as in the update, so the message can offer to
        // switch to it. Both read the same list of presets, so they agree.
        const nextId = createPresetId(presetName, config.presets.map((preset) => preset.id))

        setConfig((current) => {
            const source = current.presets.find((preset) => preset.id === current.activePresetId)

            if (!source) {
                return current
            }

            const created = copyMappingToPreset(
                createEmptyPreset(nextId, presetName, source.controllerId),
                mapping,
                source.assignments,
            )

            return {
                ...current,
                presets: [
                    ...current.presets.map((preset) =>
                        mode === "move" && preset.id === source.id
                            ? removeMappingFromPreset(preset, mapping)
                            : preset,
                    ),
                    created,
                ],
            }
        })

        announceTransfer(mapping, mode, { id: nextId, name: presetName }, undefined, true)
        finishTransfer(mapping, mode)
    }

    /** Says where a mapping went and what went with it, with a way to follow it there. */
    const announceTransfer = (
        mapping: MappingCardData,
        mode: "move" | "copy",
        target: { id: string; name: string },
        mergedInto?: string,
        created = false,
    ) => {
        const verb = mode === "move" ? "Moved" : "Copied"
        const assigned = (activePreset?.assignments ?? [])
            .filter((assignment) => assignment.control === mapping.control)
            .map((assignment) => assignment.app)
        const apps = assigned.map((app) => knownApps.name(app) ?? app)

        toast.success(`${verb} ${mappingLabel(mapping)} to ${target.name}`, {
            source: "presets",
            description: mergedInto
                ? `Joined ${mergedInto}, which already used this control there.`
                : created
                    ? "Into a new preset on the same controller."
                    : apps.length > 0
                        ? `${apps.length} app${apps.length === 1 ? "" : "s"} went with it.`
                        : undefined,
            fields: [
                { label: "From", value: activePreset?.name ?? "" },
                { label: "To", value: target.name },
                { label: "Control", value: String(mapping.control) },
                ...(apps.length > 0 ? [{ label: "Apps", value: apps.join(", ") }] : []),
            ],
            event: {
                type: "mapping-sent",
                mode,
                mapping: mappingLabel(mapping),
                control: mapping.control,
                from: activePreset?.name ?? "",
                to: target.name,
                toId: target.id,
                apps: eventApps(assigned),
                mergedInto,
                newPreset: created,
            },
            action: {
                label: "Switch",
                onClick: () =>
                    changePresetConfig((current) =>
                        current.presets.some((preset) => preset.id === target.id)
                            ? { ...current, activePresetId: target.id }
                            : current,
                    ),
            },
        })
    }

    /** What's left after a mapping has gone to another preset: a move tidies up here. */
    const finishTransfer = (mapping: MappingCardData, mode: "move" | "copy") => {
        if (mode === "copy") {
            return
        }

        if (selectedMappingId === mapping.id) {
            setSelectedMappingId(null)
        }

        releaseControlApps(mapping.control)
    }

    /**
     * Hands a control's apps back to Windows when the control is going away from
     * this preset, the way removing an app does, so a mute doesn't outlive the
     * mapping that set it. An app another control here still drives stays put.
     */
    const releaseControlApps = (control: number) => {
        if (!activePreset || !hasTauriRuntime()) {
            return
        }

        const stillAssigned = new Set(
            activePreset.assignments
                .filter((assignment) => assignment.control !== control)
                .map((assignment) => assignment.app),
        )
        const released = activePreset.assignments
            .filter((assignment) => assignment.control === control && !stillAssigned.has(assignment.app))
            .map((assignment) => assignment.app)

        if (released.length > 0) {
            void releaseApps(released).catch(() => {
                // Nothing to undo: the app simply was not under our control.
            })
        }
    }

    /**
     * Sends a trim/mute edit straight to the audio thread. Cheap enough for every
     * pointer move of a trim slider — it never touches the config file.
     */
    const pushAppLevelBatch = (
        control: number,
        levels: Array<{ app: string; trim: number; muted: boolean }>,
    ) => {
        if (!hasTauriRuntime() || levels.length === 0) {
            return
        }

        void setAppLevels(control, levels, controlValue(control)).catch((caught) => {
            reportError("Couldn't set an app's level", caught, "Unable to update that level.", {
                source: "audio",
                key: "app-level-error",
                fields: [
                    { label: "Control", value: controlName(control) },
                    { label: "Apps", value: levels.map((level) => level.app).join(", ") },
                ],
                event: (reason) => ({
                    type: "levels-failed",
                    control,
                    mapping: controlName(control),
                    apps: eventApps(levels.map((level) => level.app)),
                    reason,
                }),
            })
        })
    }

    const pushLevelsForControl = (
        control: number,
        apps: string[],
        levels: { trim: number; muted: boolean },
    ) => {
        pushAppLevelBatch(
            control,
            apps.map((app) => ({ app, ...levels })),
        )
    }

    /** Persists a trim/mute edit once the user settles on a value. */
    const commitLevelsForControl = (
        control: number,
        apps: string[],
        levels: { trim: number; muted: boolean },
    ) => {
        if (!activePreset || apps.length === 0) {
            return
        }

        const targets = new Set(apps)

        setConfig((current) => ({
            ...current,
            presets: current.presets.map((preset) =>
                preset.id === current.activePresetId
                    ? {
                        ...preset,
                        assignments: preset.assignments.map((assignment) =>
                            assignment.control === control && targets.has(assignment.app)
                                ? { ...assignment, ...levels }
                                : assignment,
                        ),
                    }
                    : preset,
            ),
        }))
    }

    /** Mute/unmute from the palette, where only the app names are known. */
    const setAppsMuted = (control: number, apps: string[], muted: boolean) => {
        // Each app keeps its own trim, so they go over as one batch of levels
        // rather than a bridge round trip apiece.
        pushAppLevelBatch(
            control,
            apps.map((app) => ({
                app,
                trim: assignmentTrim(
                    activePreset?.assignments.find(
                        (entry) => entry.control === control && entry.app === app,
                    ) ?? {},
                ),
                muted,
            })),
        )

        const targets = new Set(apps)

        setConfig((current) => ({
            ...current,
            presets: current.presets.map((preset) =>
                preset.id === current.activePresetId
                    ? {
                        ...preset,
                        assignments: preset.assignments.map((assignment) =>
                            assignment.control === control && targets.has(assignment.app)
                                ? { ...assignment, muted }
                                : assignment,
                        ),
                    }
                    : preset,
            ),
        }))
    }

    const removeAppFromMapping = (app: string | string[]) => {
        if (!selectedMapping) {
            return
        }

        removeAppsFromControl(selectedMapping.control, Array.isArray(app) ? app : [app])
    }

    /**
     * Moves one app's row to another place among the apps on a control. Rows are
     * built in the order of the control's assignments, so the assignments are
     * what get reordered; an app made of several (helpers alongside the main
     * app) moves as one, and every other control's assignments stay put.
     */
    const reorderAppsOnControl = (control: number, apps: ControlledApp[], from: number, to: number) => {
        if (from === to) {
            return
        }

        const order = [...apps]
        const [moved] = order.splice(from, 1)

        if (!moved) {
            return
        }

        order.splice(to, 0, moved)

        const rank = new Map<string, number>()
        order.forEach((app, position) => {
            for (const source of app.sourceApps) {
                rank.set(normalizeAppName(source), position)
            }
        })

        const rankOf = (app: string) => rank.get(normalizeAppName(app)) ?? order.length

        setConfig((current) => ({
            ...current,
            presets: current.presets.map((preset) => {
                if (preset.id !== current.activePresetId) {
                    return preset
                }

                const sorted = preset.assignments
                    .filter((assignment) => assignment.control === control)
                    .sort((left, right) => rankOf(left.app) - rankOf(right.app))
                let next = 0

                return {
                    ...preset,
                    assignments: preset.assignments.map((assignment) =>
                        assignment.control === control ? sorted[next++] : assignment,
                    ),
                }
            }),
        }))
    }

    const pushAppLevels = (app: ControlledApp, next: { trim?: number; muted?: boolean }) => {
        if (!selectedMapping) {
            return
        }

        pushLevelsForControl(selectedMapping.control, app.sourceApps, {
            trim: next.trim ?? app.trim,
            muted: next.muted ?? app.muted,
        })
    }

    const commitAppLevels = (app: ControlledApp, next: { trim?: number; muted?: boolean }) => {
        if (!selectedMapping) {
            return
        }

        commitLevelsForControl(selectedMapping.control, app.sourceApps, {
            trim: next.trim ?? app.trim,
            muted: next.muted ?? app.muted,
        })
    }

    // Only a control with a card on this preset can fight over an app. An
    // assignment without one is a leftover, and goes as the presets load.
    const cardedControls = new Set(activePreset?.mappings.map((mapping) => mapping.control) ?? [])
    const cardedAssignments = activePresetAssignments.filter((assignment) =>
        cardedControls.has(assignment.control),
    )
    const conflictsForApp = (app: ControlledApp) =>
        selectedMapping
            ? Array.from(
                new Set(
                    app.sourceApps.flatMap((sourceApp) =>
                        getPresetAssignmentConflicts(cardedAssignments, sourceApp, selectedMapping.control),
                    ),
                ),
            ).sort((left, right) => left - right)
            : []

    const stopLearnPolling = () => {
        if (learnPollTimerRef.current !== null) {
            window.clearInterval(learnPollTimerRef.current)
            learnPollTimerRef.current = null
        }
    }

    const closeLearnDialog = () => {
        learnSessionIdRef.current += 1
        stopLearnPolling()
        setLearnDialogOpen(false)
    }

    const confirmDeleteActivePreset = () => {
        if (!activePreset) {
            return
        }

        const removed = activePreset
        const index = config.presets.findIndex((preset) => preset.id === removed.id)

        toast.success(`Deleted ${removed.name}`, {
            source: "presets",
            description: `${removed.mappings.length} mapping${removed.mappings.length === 1 ? "" : "s"} went with it.`,
            event: {
                type: "preset-deleted",
                preset: removed.name,
                mappings: removed.mappings.map((mapping) => ({
                    name: mappingLabel(mapping),
                    control: mapping.control,
                    apps: eventApps(
                        removed.assignments
                            .filter((assignment) => assignment.control === mapping.control)
                            .map((assignment) => assignment.app),
                    ).length,
                })),
            },
            undo: () => {
                if (presetNow(removed.id)) {
                    return { done: false, reason: `${removed.name} is already back.` }
                }

                changePresetConfig((current) => {
                    const presets = [...current.presets]
                    presets.splice(Math.max(0, Math.min(index, presets.length)), 0, removed)

                    return { ...current, activePresetId: removed.id, presets }
                })

                return {
                    done: true,
                    title: `${removed.name} is back`,
                    description: removed.mappings.length > 0
                        ? `With its ${removed.mappings.length} mapping${removed.mappings.length === 1 ? "" : "s"}, and in use again.`
                        : "And in use again.",
                }
            },
        })

        setConfig((current) => {
            const remainingPresets = current.presets.filter(
                (preset) => preset.id !== current.activePresetId,
            )

            const nextActivePresetId = remainingPresets[0]?.id ?? ""

            return {
                ...current,
                activePresetId: nextActivePresetId,
                presets: remainingPresets,
            }
        })

        setIsDeleteConfirmOpen(false)
        setIsPresetSettingsOpen(false)
    }

    const updateActivePresetController = async (controllerId: string) => {
        setError(null)

        setConfig((current) => ({
            ...current,
            presets: current.presets.map((preset) =>
                preset.id === current.activePresetId
                    ? {
                        ...preset,
                        controllerId,
                    }
                    : preset,
            ),
        }))
    }

    /**
     * Puts the learn dialog up and waits for a control to move, then hands it
     * to `onLearned`. Shared by learning a new control and relearning an
     * existing mapping, which differ only in what they do with it.
     */
    const listenForControl = async (
        relearning: string | undefined,
        onLearned: (control: number) => void,
    ) => {
        if (!activePreset) {
            reportProblem("Can't learn a control yet", "Create a preset before learning a control.", "controller", {
                type: "learn-blocked",
                missing: "preset",
            })
            return
        }

        if (!activePreset.controllerId) {
            reportProblem("Can't learn a control yet", "Select a controller first.", "controller", {
                type: "learn-blocked",
                missing: "controller",
                preset: activePreset.name,
            })
            return
        }

        if (!availableControllers.includes(activePreset.controllerId)) {
            reportProblem(
                "Can't learn a control",
                `${activePreset.controllerId} is disconnected or in use elsewhere.`,
                "controller",
                {
                    type: "learn-blocked",
                    missing: "connection",
                    preset: activePreset.name,
                    device: activePreset.controllerId,
                },
            )
            return
        }

        setError(null)
        setLearnDialogState({ phase: "learning", relearning })
        setLearnDialogOpen(true)
        learnSessionIdRef.current += 1
        const sessionId = learnSessionIdRef.current
        stopLearnPolling()

        try {
            await selectInput(activePreset.controllerId)
            const beginResult = await beginLearn()

            learnPollTimerRef.current = window.setInterval(async () => {
                if (learnSessionIdRef.current !== sessionId) {
                    stopLearnPolling()
                    return
                }

                try {
                    const pollResult = await pollLearn(beginResult.afterSequence)
                    const learnedControl = pollResult.control

                    if (!pollResult.ready || typeof learnedControl !== "number") {
                        return
                    }

                    stopLearnPolling()

                    if (learnSessionIdRef.current !== sessionId) {
                        return
                    }

                    onLearned(learnedControl)
                } catch (caught) {
                    stopLearnPolling()
                    if (learnSessionIdRef.current === sessionId) {
                        reportError("Couldn't learn a control", caught, "Failed to learn a control.", {
                            source: "controller",
                            fields: [{ label: "Controller", value: activePreset.controllerId }],
                            event: (reason) => ({ type: "learn-failed", device: activePreset.controllerId, reason }),
                        })
                        setLearnDialogOpen(false)
                    }
                }
            }, 150)
        } catch (caught) {
            reportError("Couldn't learn a control", caught, "Failed to learn a control.", {
                source: "controller",
                fields: [{ label: "Controller", value: activePreset.controllerId }],
                event: (reason) => ({ type: "learn-failed", device: activePreset.controllerId, reason }),
            })
            setLearnDialogOpen(false)
            stopLearnPolling()
        }
    }

    const learnControl = () =>
        listenForControl(undefined, (learnedControl) => {
            if (!activePreset) {
                return
            }

            // Learning a control this preset already maps just finds it again;
            // only a new one gets a card, and a celebration.
            const latest = latestConfigRef.current
            const existing = latest.presets
                .find((preset) => preset.id === latest.activePresetId)
                ?.mappings.find((mapping) => mapping.control === learnedControl)
            const isNewControl = !existing

            setConfig((current) => {
                const targetPreset = current.presets.find((preset) => preset.id === current.activePresetId)
                if (!targetPreset) {
                    return current
                }

                const existingMapping = targetPreset.mappings.find((mapping) => mapping.control === learnedControl)
                if (existingMapping) {
                    return current
                }

                return {
                    ...current,
                    presets: current.presets.map((preset) =>
                        preset.id === current.activePresetId
                            ? {
                                ...preset,
                                mappings: [
                                    ...preset.mappings,
                                    { id: `${preset.id}-mapping-${learnedControl}`, control: learnedControl, name: `Control ${learnedControl}`, value: 0, controlledApps: [] },
                                ],
                            }
                            : preset,
                    ),
                }
            })

            setLearnDialogState({ phase: "learnt", control: learnedControl })

            if (isNewControl) {
                void fireSideCannons()
            }

            // The learn dialog has already said so; this is for the record.
            toast.success(`Learned Control ${learnedControl}`, {
                source: "controller",
                silent: true,
                description: isNewControl
                    ? `Added to ${activePreset.name}, ready for apps to be assigned to it.`
                    : `${activePreset.name} already maps it, as ${mappingLabel(existing)}.`,
                fields: [
                    { label: "Preset", value: activePreset.name },
                    { label: "Controller", value: activePreset.controllerId },
                ],
                event: {
                    type: "control-learned",
                    control: learnedControl,
                    device: activePreset.controllerId,
                    preset: activePreset.name,
                    presetId: activePreset.id,
                    // The id the new card is given above, or the card it found.
                    mappingId: existing?.id ?? `${activePreset.id}-mapping-${learnedControl}`,
                    alreadyMapped: !isNewControl,
                },
            })
        })

    /**
     * Moves a mapping, apps and all, onto `control`. A mapping that already had
     * it keeps its apps but is left without a control, and says so on its card,
     * until it's relearned itself.
     */
    const applyRelearn = (mappingId: string, control: number) => {
        const latest = latestConfigRef.current
        const before = latest.presets.find((preset) => preset.id === latest.activePresetId)
        const mapping = before?.mappings.find((entry) => entry.id === mappingId)

        if (!before || !mapping) {
            return
        }

        const { preset: after, displaced } = relearnMapping(before, mappingId, control)
        const moved = after.mappings.find((entry) => entry.id === mappingId) ?? mapping
        const replace = (preset: typeof before) =>
            changePresetConfig((current) => ({
                ...current,
                presets: current.presets.map((entry) => (entry.id === preset.id ? preset : entry)),
            }))

        replace(after)
        void syncActivePreset(after.assignments)

        toast.success(`${mappingLabel(moved)} is on Control ${control}`, {
            source: "mapping",
            description: displaced
                ? `${mappingLabel(displaced)} no longer has a control. Relearn it to use its apps again.`
                : `Moved from ${describeControl(mapping.control)}, apps and all.`,
            fields: [
                { label: "Preset", value: before.name },
                ...(displaced ? [{ label: "Left without a control", value: mappingLabel(displaced) }] : []),
            ],
            event: {
                type: "control-moved",
                mapping: mappingLabel(moved),
                mappingId: moved.id,
                preset: before.name,
                from: mapping.control,
                to: control,
                displaced: displaced ? { name: mappingLabel(displaced), id: displaced.id } : undefined,
            },
            undo: () => {
                const preset = presetNow(before.id)
                const now = preset?.mappings.find((entry) => entry.id === mappingId)

                if (!preset || !now) {
                    return { done: false, reason: `${mappingLabel(moved)} has been deleted since.` }
                }

                if (now.control !== control) {
                    return {
                        done: false,
                        reason: `${mappingLabel(now)} has been moved again since, to ${describeControl(now.control)}.`,
                    }
                }

                const occupant = preset.mappings.find(
                    (entry) => entry.control === mapping.control && entry.id !== mappingId,
                )

                if (occupant) {
                    return {
                        done: false,
                        reason: `${mappingLabel(occupant)} is on ${describeControl(mapping.control)} now, so ${mappingLabel(now)} can't go back to it.`,
                    }
                }

                // Moved back the way it came, rather than the whole preset put
                // back as it was: anything else changed in it since stays changed.
                let reverted = relearnMapping(preset, mappingId, mapping.control).preset
                // And the mapping it pushed off, if that's still waiting for a control.
                const parked = displaced
                    ? reverted.mappings.find((entry) => entry.id === displaced.id)
                    : undefined
                const parkedReturns =
                    parked !== undefined &&
                    isUnboundControl(parked.control) &&
                    !reverted.mappings.some((entry) => entry.control === control)

                if (parkedReturns) {
                    reverted = relearnMapping(reverted, parked.id, control).preset
                }

                replace(reverted)

                return {
                    done: true,
                    title: `${mappingLabel(now)} is back on ${describeControl(mapping.control)}`,
                    description: parkedReturns
                        ? `${mappingLabel(parked)} is back on Control ${control}.`
                        : undefined,
                }
            },
        })

        return moved
    }

    const relearnControl = (mapping: MappingCardData) =>
        listenForControl(mappingLabel(mapping), (learnedControl) => {
            const latest = latestConfigRef.current
            const preset = latest.presets.find((entry) => entry.id === latest.activePresetId)
            const target = preset?.mappings.find((entry) => entry.id === mapping.id)

            if (!preset || !target) {
                setLearnDialogOpen(false)
                return
            }

            const label = mappingLabel(target)

            if (learnedControl === target.control) {
                setLearnDialogState({
                    phase: "learnt",
                    control: learnedControl,
                    relearning: label,
                    outcome: `${label} is already on Control ${learnedControl}, so nothing changed.`,
                })
                return
            }

            const occupant = preset.mappings.find(
                (entry) => entry.control === learnedControl && entry.id !== target.id,
            )

            // Taken: ask before leaving the other mapping without a control.
            if (occupant) {
                setLearnDialogOpen(false)
                setRelearnConflict({ mappingId: target.id, control: learnedControl, occupantId: occupant.id })
                return
            }

            applyRelearn(target.id, learnedControl)
            setLearnDialogState({
                phase: "learnt",
                control: learnedControl,
                relearning: label,
                outcome: `${label} is now on Control ${learnedControl}, with its apps.`,
            })
        })

    // Everything this section knows how to do, offered to the palette as plain
    // command descriptors. "Assign app" is just this command opened with its
    // first argument already filled in.
    const mappingCommands = useMappingCommands({
        presets: config.presets,
        activePresetId: config.activePresetId,
        mappings: activePreset?.mappings ?? [],
        assignments: activePresetAssignments,
        processGroups: groupedProcesses,
        runningProcesses,
        runningApps,
        apps: knownApps,
        assignAppsToControl,
        removeAppsFromControl,
        setAppsMuted,
        learnControl: () => void learnControl(),
        selectPreset: applyPresetSelection,
    })

    useRegisterCommands(mappingCommands)

    const openAssignCommand = (control: number) => {
        openPalette({
            commandId: ASSIGN_COMMAND_ID,
            tokens: [[{ id: String(control), label: controlName(control), hint: `Control ${control}` }]],
        })
    }

    const createPresetDialog = (
        <Dialog
            open={isCreatePresetOpen}
            onOpenChange={(open) => {
                setIsCreatePresetOpen(open)

                if (!open) {
                    setPendingTransfer(null)
                }
            }}
        >
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Create preset</DialogTitle>
                    <DialogDescription>
                        {pendingTransfer
                            ? `Give the new preset a name. ${pendingTransfer.mapping.name.trim() || `Control ${pendingTransfer.mapping.control}`} will be ${pendingTransfer.mode === "move" ? "moved" : "copied"} into it.`
                            : "Give the new preset a name."}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-2">
                    <label className="text-sm font-medium" htmlFor="preset-name">
                        Preset name
                    </label>
                    <Input
                        id="preset-name"
                        value={pendingPresetName}
                        onChange={(event) => setPendingPresetName(event.target.value)}
                        placeholder="Eg. Music"
                        onKeyDown={(event) => {
                            if (event.key === "Enter") {
                                event.preventDefault()
                                createPreset()
                            }
                        }}
                    />
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => setIsCreatePresetOpen(false)}>
                        Cancel
                    </Button>
                    <Button onClick={createPreset} disabled={!pendingPresetName.trim()}>
                        Create preset
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )

    if (!isHydrated || !isSessionReady) {
        return (
            <div className="flex h-full w-full items-center justify-center">
                <div className="text-center text-sm text-muted-foreground">Loading mapping data…</div>
            </div>
        )
    }

    if (!hasPresets) {
        return (
            <div className="flex h-full min-h-0 flex-col overflow-hidden">
                <div className="flex h-full min-h-0 items-center justify-center p-6">
                    <Empty className="max-w-md border-0">
                        <EmptyHeader>
                            <EmptyMedia variant="icon">
                                <RiAddLine />
                            </EmptyMedia>
                            <EmptyTitle>No Presets Yet</EmptyTitle>
                            <EmptyDescription>
                                You haven&apos;t created any presets yet. Get started by creating your first preset.
                            </EmptyDescription>
                        </EmptyHeader>
                        <EmptyContent className="flex-row justify-center gap-2">
                            <Button onClick={openCreatePresetDialog}>
                                <RiAddLine />
                                Create Preset
                            </Button>
                        </EmptyContent>
                    </Empty>
                </div>

                {createPresetDialog}
            </div>
        )
    }

    return (
        <div className="relative h-full min-h-0 overflow-hidden">
            {/* The grid and a control's screen cross over rather than taking turns,
                so each sits on top of the other while they do. */}
            <AnimatePresence initial={false}>
                {!isMappingDetailOpen ? (
                    <motion.div
                        key="mapping-grid"
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.1 }}
                        className="absolute inset-0 flex min-h-0 flex-col overflow-hidden"
                    >
                        <div className="flex w-full flex-row justify-between gap-4 border-b p-4">
                            <div className="flex flex-row gap-2">
                                <Button onClick={() => void learnControl()}>
                                    <RiBrainLine />
                                    Learn Control
                                </Button>

                                <ControllerStatus
                                    state={controllerState}
                                    waitingLabel={availableControllers.length > 0 ? "Select a controller" : "No controllers detected"}
                                />
                            </div>

                            <div className="flex flex-row gap-2">
                                <Select
                                    value={config.activePresetId}
                                    // So the trigger shows the preset's name rather than its id.
                                    items={[
                                        ...config.presets.map((preset) => ({ value: preset.id, label: preset.name })),
                                        { value: "new", label: "New Preset" },
                                    ]}
                                    onValueChange={(value) => {
                                        if (value !== null) {
                                            applyPresetSelection(value)
                                        }
                                    }}
                                >
                                    <SelectTrigger className="w-full max-w-48">
                                        <SelectValue placeholder="Select a preset" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectGroup>
                                            {config.presets.map((preset) => (
                                                <SelectItem key={preset.id} value={preset.id}>
                                                    {preset.name}
                                                </SelectItem>
                                            ))}
                                            <SelectSeparator />
                                            <SelectItem value="new">
                                                <span className="flex items-center gap-2">
                                                    <RiAddLine /> New Preset
                                                </span>
                                            </SelectItem>
                                        </SelectGroup>
                                    </SelectContent>
                                </Select>
                                <Button
                                    className="h-fill w-fit aspect-square"
                                    variant="outline"
                                    onClick={() => setIsPresetSettingsOpen(true)}
                                    disabled={!activePreset}
                                >
                                    <RiSettings2Line />
                                </Button>
                            </div>
                        </div>

                        {error ? (
                            <div className="border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-200">
                                {error}
                            </div>
                        ) : null}

                        {/* Right-clicking the background offers what can be done without
                            picking a control first. A card's own menu still wins over it. */}
                        <ContextMenu>
                            <ContextMenuTrigger className="flex min-h-0 flex-1 flex-col select-auto">
                        <ScrollArea className="min-h-0 flex-1 px-4">
                            {/* Cards are dragged into a new order. The grid is
                                reordered as the card moves, so the drop only has
                                to say where it ended up. */}
                            <DragDropProvider
                                onDragEnd={(event) => {
                                    if (event.canceled) {
                                        return
                                    }

                                    const { source } = event.operation

                                    if (isSortable(source) && source.initialIndex !== source.index) {
                                        reorderMappings(source.initialIndex, source.index)
                                    }
                                }}
                            >
                            <div className="grid gap-4 py-4 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3">
                                <AnimatePresence mode="popLayout" initial={false}>
                                    {activePreset?.mappings.map((mapping, index) => (
                                        <SortableMappingItem key={mapping.id} id={mapping.id} index={index}>
                                            <LiveMappingCard
                                                mapping={mapping}
                                                controlledApps={buildControlledAppsFromAssignments(
                                                    activePreset?.assignments ?? [],
                                                    mapping.control,
                                                    runningProcesses,
                                                    knownApps,
                                                    runningApps,
                                                )}
                                                presetTargets={presetTargetsFor(mapping.control)}
                                                onMoveToPreset={(presetId) => sendMappingToPreset(mapping, presetId, "move")}
                                                onCopyToPreset={(presetId) => sendMappingToPreset(mapping, presetId, "copy")}
                                                onMoveToNewPreset={() => openCreatePresetFor(mapping, "move")}
                                                onCopyToNewPreset={() => openCreatePresetFor(mapping, "copy")}
                                                onView={() => openMappingDetail(mapping.id)}
                                                onRename={() => openRenameMappingDialog(mapping)}
                                                onRelearn={() => void relearnControl(mapping)}
                                                onDelete={() => openDeleteMappingDialog(mapping.id)}
                                            />
                                        </SortableMappingItem>
                                    ))}
                                </AnimatePresence>
                                {activePreset && activePreset.mappings.length === 0 ? (
                                    <motion.div
                                        key="empty-mapping-state"
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        exit={{ opacity: 0 }}
                                        className="col-span-full rounded-xl border border-dashed bg-muted/20 p-6 text-sm text-muted-foreground"
                                    >
                                        No mappings yet. Click Learn Control to add a blank mapping card.
                                    </motion.div>
                                ) : null}
                            </div>
                            </DragDropProvider>
                        </ScrollArea>
                            </ContextMenuTrigger>
                            <ContextMenuContent className="w-56">
                                <ContextMenuItem onClick={() => void learnControl()}>
                                    <RiBrainLine className="text-muted-foreground" /> Learn Control
                                </ContextMenuItem>
                                <ContextMenuItem
                                    disabled={!activePreset?.mappings.length}
                                    onClick={() => openPalette({ commandId: ASSIGN_COMMAND_ID })}
                                >
                                    <RiApps2AddLine className="text-muted-foreground" /> Assign App…
                                </ContextMenuItem>
                                <ContextMenuItem onClick={() => openPalette()}>
                                    <RiTerminalBoxLine className="text-muted-foreground" /> Command Menu
                                    <ContextMenuShortcut className="tracking-normal">Ctrl+Alt</ContextMenuShortcut>
                                </ContextMenuItem>
                                <ContextMenuSeparator />
                                <ContextMenuSub>
                                    <ContextMenuSubTrigger>
                                        <RiStackLine className="text-muted-foreground" /> Switch Preset
                                    </ContextMenuSubTrigger>
                                    <ContextMenuSubContent>
                                        <ContextMenuRadioGroup
                                            value={config.activePresetId}
                                            onValueChange={applyPresetSelection}
                                        >
                                            {config.presets.map((preset) => (
                                                <ContextMenuRadioItem key={preset.id} value={preset.id}>
                                                    {preset.name}
                                                </ContextMenuRadioItem>
                                            ))}
                                        </ContextMenuRadioGroup>
                                    </ContextMenuSubContent>
                                </ContextMenuSub>
                                <ContextMenuItem onClick={openCreatePresetDialog}>
                                    <RiFileAddLine className="text-muted-foreground" /> New Preset…
                                </ContextMenuItem>
                                <ContextMenuItem onClick={openRenamePresetDialog}>
                                    <RiEditBoxLine className="text-muted-foreground" /> Rename Preset…
                                </ContextMenuItem>
                                <ContextMenuItem onClick={() => setIsPresetSettingsOpen(true)}>
                                    <RiSettings2Line className="text-muted-foreground" /> Preset Settings…
                                </ContextMenuItem>
                                <ContextMenuSeparator />
                                <ContextMenuItem variant="destructive" onClick={deleteActivePreset}>
                                    <RiDeleteBinLine /> Delete Preset…
                                </ContextMenuItem>
                            </ContextMenuContent>
                        </ContextMenu>
                    </motion.div>
                ) : (
                    <motion.div
                        key="mapping-detail"
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.1 }}
                        className="absolute inset-0 flex min-h-0 flex-col overflow-hidden"
                    >
                        <MappingDetail
                            control={selectedMapping?.control ?? 0}
                            name={mappingDisplayName}
                            onRelearn={() => {
                                if (selectedMapping) {
                                    void relearnControl(selectedMapping)
                                }
                            }}
                            fallbackPercent={selectedMapping?.value ?? 0}
                            controllerId={activePreset?.controllerId ?? ""}
                            controllerConnected={controllerState === "connected"}
                            apps={selectedMappingControlledApps}
                            conflictsFor={conflictsForApp}
                            onBack={closeMappingDetail}
                            onRename={renameSelectedMappingTo}
                            onDelete={() => {
                                if (selectedMappingId) {
                                    openDeleteMappingDialog(selectedMappingId)
                                }
                            }}
                            onAssignApp={() => openAssignCommand(selectedMapping?.control ?? 0)}
                            onRemoveApp={(app) => removeAppFromMapping(app.sourceApps)}
                            onReorderApps={(from, to) => {
                                if (selectedMapping) {
                                    reorderAppsOnControl(selectedMapping.control, selectedMappingControlledApps, from, to)
                                }
                            }}
                            onTrimChange={(app, trim) => pushAppLevels(app, { trim })}
                            onTrimCommit={(app, trim) => commitAppLevels(app, { trim })}
                            onMuteToggle={(app, muted) => {
                                pushAppLevels(app, { muted })
                                commitAppLevels(app, { muted })
                            }}
                        />
                    </motion.div>
                )}
            </AnimatePresence>

            <Dialog open={isRenameMappingOpen} onOpenChange={setIsRenameMappingOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Rename mapping</DialogTitle>
                        <DialogDescription>
                            Give this control a clearer name.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-2">
                        <label className="text-sm font-medium" htmlFor="mapping-rename">
                            Mapping name
                        </label>
                        <Input
                            id="mapping-rename"
                            value={pendingMappingRename}
                            // Starts out selected, so typing replaces the name.
                            onFocus={(event) => event.currentTarget.select()}
                            onChange={(event) => setPendingMappingRename(event.target.value)}
                            placeholder="Eg. Main volume"
                            onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                    event.preventDefault()
                                    renameActionMapping()
                                }
                            }}
                        />
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsRenameMappingOpen(false)}>
                            Cancel
                        </Button>
                        <Button onClick={renameActionMapping} disabled={!pendingMappingRename.trim()}>
                            Save rename
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={isDeleteMappingConfirmOpen} onOpenChange={setIsDeleteMappingConfirmOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete mapping?</DialogTitle>
                        <DialogDescription>
                            This will remove {actionMapping?.name.trim() || "this mapping"} from the active preset.
                        </DialogDescription>
                    </DialogHeader>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsDeleteMappingConfirmOpen(false)}>
                            Cancel
                        </Button>
                        <Button variant="destructive" onClick={confirmDeleteActionMapping}>
                            Delete mapping
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={learnDialogOpen} onOpenChange={setLearnDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            {learnDialogState.relearning
                                ? learnDialogState.phase === "learning"
                                    ? `Relearning ${learnDialogState.relearning}`
                                    : `Relearnt ${learnDialogState.relearning}`
                                : learnDialogState.phase === "learning"
                                    ? "Learning control"
                                    : "Learnt control"}
                        </DialogTitle>
                        <DialogDescription>
                            {learnDialogState.phase === "learning"
                                ? learnDialogState.relearning
                                    ? `Move the control you want ${learnDialogState.relearning} on. Its apps move with it.`
                                    : "Use this control to learn it."
                                : learnDialogState.outcome ?? `Control ${learnDialogState.control ?? 0} has been learnt.`}
                        </DialogDescription>
                    </DialogHeader>

                    {learnDialogState.phase === "learning" ? (
                        <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-muted-foreground">
                            {learnDialogState.relearning
                                ? "Waiting for a control to move. One another mapping already uses can be taken over."
                                : "Move the control you want to bind now."}
                        </div>
                    ) : learnDialogState.relearning ? null : (
                        <div className="rounded-xl border border-primary/20 bg-primary/10 px-4 py-3 text-sm text-primary">
                            Learn complete. The new blank mapping card has been saved.
                        </div>
                    )}

                    <DialogFooter>
                        {learnDialogState.phase === "learning" ? (
                            <Button variant="outline" onClick={closeLearnDialog}>
                                Cancel
                            </Button>
                        ) : (
                            <Button onClick={closeLearnDialog}>Close</Button>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* A relearn that landed on a control another mapping already has. */}
            <Dialog
                open={relearnConflict !== null}
                onOpenChange={(open) => {
                    if (!open) {
                        setRelearnConflict(null)
                    }
                }}
            >
                {(() => {
                    const moving = activePreset?.mappings.find((entry) => entry.id === relearnConflict?.mappingId)
                    const occupant = activePreset?.mappings.find((entry) => entry.id === relearnConflict?.occupantId)

                    if (!relearnConflict || !moving || !occupant) {
                        return null
                    }

                    return (
                        <DialogContent showCloseButton={false}>
                            <DialogHeader>
                                <DialogTitle>Control {relearnConflict.control} is already in use</DialogTitle>
                                <DialogDescription>
                                    {mappingLabel(occupant)} is on Control {relearnConflict.control}. Replace it
                                    and {mappingLabel(moving)} takes the control, while {mappingLabel(occupant)} keeps
                                    its apps but won&apos;t be on any control until you relearn it.
                                </DialogDescription>
                            </DialogHeader>
                            <DialogFooter>
                                <Button variant="outline" onClick={() => setRelearnConflict(null)}>
                                    Cancel
                                </Button>
                                <Button
                                    variant="destructive"
                                    onClick={() => {
                                        applyRelearn(relearnConflict.mappingId, relearnConflict.control)
                                        setRelearnConflict(null)
                                    }}
                                >
                                    Replace
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    )
                })()}
            </Dialog>

            {createPresetDialog}

            <Drawer open={isPresetSettingsOpen} onOpenChange={setIsPresetSettingsOpen} swipeDirection="right">
                <DrawerContent className="max-h-none w-[min(36rem,100vw)] rounded-none border-l border-border/60 bg-background/95 p-0 shadow-2xl backdrop-blur">
                    <div className="flex h-full min-h-0 flex-col">
                        <DrawerHeader className="border-b border-border/60 px-6 py-5">
                            <DrawerTitle className="text-lg flex flex-row items-center gap-1">
                                {activePreset?.name ?? "Preset settings"}
                                <Dot size={12} />
                                <span className="text-xs text-muted-foreground font-mono">
                                    {activePreset.id}
                                </span>
                            </DrawerTitle>
                            <DrawerDescription>
                                Adjust the preset controller and keep the mapping details in sync.
                            </DrawerDescription>
                        </DrawerHeader>

                        <ScrollArea className="min-h-0 flex-1 px-6 py-6">
                            {activePreset ? (
                                <div className="space-y-5">
                                    <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
                                        <div className="space-y-2">
                                            <p className="text-[0.7rem] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                                                Controller
                                            </p>
                                            <Select
                                                value={activePreset.controllerId}
                                                onValueChange={(value) => {
                                                    if (value !== null) {
                                                        void updateActivePresetController(value)
                                                    }
                                                }}
                                            >
                                                <SelectTrigger className="w-full">
                                                    <SelectValue placeholder="Select controller" />
                                                </SelectTrigger>
                                                <SelectContent align="end">
                                                    <SelectGroup>
                                                        {controllerChoices.length > 0 ? (
                                                            controllerChoices.map((controller) => (
                                                                <SelectItem key={controller} value={controller}>
                                                                    {controller}
                                                                </SelectItem>
                                                            ))
                                                        ) : (
                                                            <SelectItem value="__none__" disabled>
                                                                No controllers detected
                                                            </SelectItem>
                                                        )}
                                                    </SelectGroup>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    </div>
                                </div>
                            ) : null}
                        </ScrollArea>

                        <DrawerFooter className="border-t border-border/60 px-6 py-4">
                            <div className="flex w-full items-center justify-between gap-2">
                                <div className="flex gap-2">
                                    <Button variant="outline" onClick={openRenamePresetDialog}>
                                        <RiEditBoxLine />
                                        Rename
                                    </Button>
                                    <Button variant="destructive" onClick={deleteActivePreset}>
                                        <RiDeleteBinLine />
                                        Delete
                                    </Button>
                                </div>
                            </div>
                        </DrawerFooter>
                    </div>
                </DrawerContent>
            </Drawer>

            <Dialog open={isRenamePresetOpen} onOpenChange={setIsRenamePresetOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Rename preset</DialogTitle>
                        <DialogDescription>
                            Update the preset name.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-2">
                        <label className="text-sm font-medium" htmlFor="preset-rename">
                            Preset name
                        </label>
                        <Input
                            id="preset-rename"
                            value={pendingPresetRename}
                            onChange={(event) => setPendingPresetRename(event.target.value)}
                            placeholder="Eg. Music"
                            onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                    event.preventDefault()
                                    renameActivePreset()
                                }
                            }}
                        />
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsRenamePresetOpen(false)}>
                            Cancel
                        </Button>
                        <Button onClick={renameActivePreset} disabled={!pendingPresetRename.trim()}>
                            Save rename
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={isDeleteConfirmOpen} onOpenChange={setIsDeleteConfirmOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete preset?</DialogTitle>
                        <DialogDescription>
                            This will permanently remove “{activePreset?.name}” from the local config.
                        </DialogDescription>
                    </DialogHeader>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsDeleteConfirmOpen(false)}>
                            Cancel
                        </Button>
                        <Button variant="destructive" onClick={confirmDeleteActivePreset}>
                            Delete preset
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}