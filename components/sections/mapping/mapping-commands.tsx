"use client"

import { useMemo } from "react"

import {
  RiAddLine,
  RiBrainLine,
  RiComputerLine,
  RiStackLine,
  RiSubtractLine,
  RiVolumeMuteLine,
  RiVolumeUpLine,
} from "@remixicon/react"

import type { CommandOption, CommandTokens, PaletteCommand } from "@/components/command-palette/types"
import type { AppDirectory } from "@/lib/app-icons"

import {
  buildControlledAppsFromAssignments,
  normalizeAppName,
  type MappingCardData,
  type PresetAssignment,
  type PresetConfig,
  type ProcessGroup,
  type ProcessSnapshot,
} from "./preset-config"

/** One app to assign: a process name plus the path its icon can be read from. */
export type AssignEntry = { app: string; path?: string | null }

export type MappingCommandsInput = {
  presets: PresetConfig["presets"]
  activePresetId: string
  mappings: MappingCardData[]
  assignments: PresetAssignment[]
  processGroups: ProcessGroup[]
  runningProcesses: ProcessSnapshot[]
  /** Normalized names of every running app, audio or not. */
  runningApps: ReadonlySet<string>
  /** Where each app lives and how it looks, for the ones that aren't running. */
  apps: AppDirectory
  assignAppsToControl: (control: number, entries: AssignEntry[]) => void
  removeAppsFromControl: (control: number, apps: string[]) => void
  setAppsMuted: (control: number, apps: string[], muted: boolean) => void
  learnControl: () => void
  selectPreset: (presetId: string) => void
}

export const ASSIGN_COMMAND_ID = "mapping.add-apps"

/** Stands in for an app whose icon couldn't be read, as it does everywhere else. */
const missingAppIcon = <RiComputerLine className="text-muted-foreground" />

function controlOption(mapping: MappingCardData, assignments: PresetAssignment[]): CommandOption {
  const assigned = assignments.filter((assignment) => assignment.control === mapping.control).length

  return {
    id: String(mapping.control),
    label: mapping.name.trim() || `Control ${mapping.control}`,
    hint: `Control ${mapping.control}`,
    keywords: [`control ${mapping.control}`, `${assigned} apps`],
    group: "Controls",
  }
}

function controlFromTokens(tokens: CommandTokens) {
  const raw = tokens[0]?.[0]?.id
  const control = raw === undefined ? Number.NaN : Number(raw)

  return Number.isFinite(control) ? control : null
}

/**
 * The mapping section's contribution to the command palette. Every command is a
 * plain descriptor — the palette knows nothing about controls or apps, it just
 * collects arguments and calls `run`.
 *
 * `input` is captured directly, so the descriptors are rebuilt whenever the
 * section re-renders. Re-registering is cheap: it bumps a counter and re-renders
 * the palette, which draws nothing while closed.
 */
export function useMappingCommands(input: MappingCommandsInput) {
  return useMemo<PaletteCommand[]>(() => {
    const controlArgument = (name: string, placeholder: string) => ({
      name,
      placeholder,
      emptyLabel: "No controls on this preset yet — learn one first.",
      options: () =>
        input.mappings.map((mapping) =>
          controlOption(mapping, input.assignments),
        ),
    })

    /** Apps already under a control, as the rows on its page group them. */
    const assignedApps = (tokens: CommandTokens) => {
      const control = controlFromTokens(tokens)

      if (control === null) {
        return []
      }

      const { assignments, runningProcesses, runningApps, apps } = input

      return buildControlledAppsFromAssignments(
        assignments,
        control,
        runningProcesses,
        apps,
        runningApps,
      )
    }

    const assignedAppOptions = (tokens: CommandTokens): CommandOption[] =>
      assignedApps(tokens).map((app) => ({
        id: app.id,
        label: app.name,
        hint: app.muted
          ? "muted"
          : app.available
            ? `${app.processCount} live`
            : app.running
              ? "no audio session"
              : "not running",
        keywords: app.sourceApps,
        iconSrc: app.iconSrc || null,
        icon: missingAppIcon,
        group: "Assigned",
        data: app.sourceApps,
      }))

    return [
      {
        id: ASSIGN_COMMAND_ID,
        name: "Add",
        description: "Put apps under a control",
        keywords: ["add", "assign", "app", "control", "volume"],
        group: "Mapping",
        icon: <RiAddLine className="text-muted-foreground" />,
        args: [
          controlArgument("control", "Which control?"),
          {
            name: "apps",
            placeholder: "Add an app — Tab for another, Enter to run",
            variadic: true,
            emptyLabel: "No other apps are playing audio. Type a name to add one anyway.",
            options: (tokens, query) => {
              const control = controlFromTokens(tokens)

              if (control === null) {
                return []
              }

              const { assignments, processGroups } = input
              const taken = new Set(
                assignments
                  .filter((assignment) => assignment.control === control)
                  .map((assignment) => normalizeAppName(assignment.app)),
              )

              const groups = processGroups.filter(
                (group) =>
                  !group.processes.every((process) => taken.has(normalizeAppName(process.name))),
              )

              const groupOptions = groups.map<CommandOption>((group) => ({
                id: `group:${group.id}`,
                label: group.name,
                hint: `${group.processes.length} process${group.processes.length === 1 ? "" : "es"}`,
                keywords: group.processes.map((process) => process.name),
                iconSrc: group.iconSrc || null,
                icon: missingAppIcon,
                group: "Apps",
                data: group.processes.map((process) => ({
                  app: process.name,
                  path: process.executable_path ?? null,
                })),
              }))

              if (!query.trim()) {
                return groupOptions
              }

              // Individual processes stay reachable for the cases group-level
              // assignment gets wrong, but only once there's something to match
              // them against — otherwise they bury the app list.
              const processOptions = groups
                .filter((group) => group.processes.length > 1)
                .flatMap((group) =>
                  group.processes
                    .filter((process) => !taken.has(normalizeAppName(process.name)))
                    .map<CommandOption>((process) => ({
                      id: `process:${process.pid}`,
                      label: process.name,
                      hint: `${group.name} · PID ${process.pid}`,
                      keywords: [group.name],
                      iconSrc: process.icon ?? group.iconSrc ?? null,
                      icon: missingAppIcon,
                      group: "Processes",
                      data: [{ app: process.name, path: process.executable_path ?? null }],
                    })),
                )

              return [...groupOptions, ...processOptions]
            },
            freeText: (value) => ({
              id: `name:${normalizeAppName(value)}`,
              label: value,
              hint: "add by name",
              icon: missingAppIcon,
              group: "Not running",
              data: [{ app: value, path: null }],
            }),
          },
        ],
        run: (tokens) => {
          const control = controlFromTokens(tokens)

          if (control === null) {
            return
          }

          const entries = (tokens[1] ?? []).flatMap(
            (token) => (token.data as AssignEntry[] | undefined) ?? [],
          )

          if (entries.length > 0) {
            input.assignAppsToControl(control, entries)
          }
        },
      },
      {
        id: "mapping.remove-apps",
        name: "Remove",
        description: "Take apps back off a control",
        keywords: ["remove", "unassign", "delete", "app"],
        group: "Mapping",
        icon: <RiSubtractLine className="text-muted-foreground" />,
        args: [
          controlArgument("control", "Take apps off which control?"),
          {
            name: "apps",
            placeholder: "Remove an app — Tab for another, Enter to run",
            variadic: true,
            emptyLabel: "Nothing is assigned to that control.",
            options: assignedAppOptions,
          },
        ],
        run: (tokens) => {
          const control = controlFromTokens(tokens)

          if (control === null) {
            return
          }

          const apps = (tokens[1] ?? []).flatMap((token) => (token.data as string[] | undefined) ?? [])

          if (apps.length > 0) {
            input.removeAppsFromControl(control, apps)
          }
        },
      },
      {
        id: "mapping.mute-apps",
        name: "Mute",
        description: "Silence apps without unassigning them",
        keywords: ["mute", "silence", "quiet"],
        group: "Mapping",
        icon: <RiVolumeMuteLine className="text-muted-foreground" />,
        args: [
          controlArgument("control", "Mute apps on which control?"),
          {
            name: "apps",
            placeholder: "Mute an app — Tab for another, Enter to run",
            variadic: true,
            emptyLabel: "Nothing is assigned to that control.",
            options: assignedAppOptions,
          },
        ],
        run: (tokens) => {
          const control = controlFromTokens(tokens)

          if (control === null) {
            return
          }

          const apps = (tokens[1] ?? []).flatMap((token) => (token.data as string[] | undefined) ?? [])

          if (apps.length > 0) {
            input.setAppsMuted(control, apps, true)
          }
        },
      },
      {
        id: "mapping.unmute-apps",
        name: "Unmute",
        description: "Let muted apps play again",
        keywords: ["unmute", "unsilence", "restore"],
        group: "Mapping",
        icon: <RiVolumeUpLine className="text-muted-foreground" />,
        args: [
          controlArgument("control", "Unmute apps on which control?"),
          {
            name: "apps",
            placeholder: "Unmute an app — Tab for another, Enter to run",
            variadic: true,
            emptyLabel: "Nothing is muted on that control.",
            options: (tokens) =>
              assignedApps(tokens)
                .filter((app) => app.muted)
                .map((app) => ({
                  id: app.id,
                  label: app.name,
                  hint: "muted",
                  keywords: app.sourceApps,
                  iconSrc: app.iconSrc || null,
                  icon: missingAppIcon,
                  group: "Muted",
                  data: app.sourceApps,
                })),
          },
        ],
        run: (tokens) => {
          const control = controlFromTokens(tokens)

          if (control === null) {
            return
          }

          const apps = (tokens[1] ?? []).flatMap((token) => (token.data as string[] | undefined) ?? [])

          if (apps.length > 0) {
            input.setAppsMuted(control, apps, false)
          }
        },
      },
      {
        id: "mapping.learn-control",
        name: "Learn",
        description: "Listen for the next control you touch",
        keywords: ["learn", "midi", "knob", "fader", "map"],
        group: "Mapping",
        icon: <RiBrainLine className="text-muted-foreground" />,
        run: () => input.learnControl(),
      },
      {
        id: "mapping.switch-preset",
        name: "Preset",
        description: "Switch the active preset",
        keywords: ["preset", "profile", "switch", "load"],
        group: "Mapping",
        icon: <RiStackLine className="text-muted-foreground" />,
        args: [
          {
            name: "preset",
            placeholder: "Switch to which preset?",
            emptyLabel: "No presets yet.",
            options: () =>
              input.presets.map((preset) => ({
                id: preset.id,
                label: preset.name,
                hint:
                  preset.id === input.activePresetId
                    ? "active"
                    : `${preset.mappings.length} controls`,
                group: "Presets",
              })),
          },
        ],
        run: (tokens) => {
          const presetId = tokens[0]?.[0]?.id

          if (presetId) {
            input.selectPreset(presetId)
          }
        },
      },
    ]
  }, [input])
}
