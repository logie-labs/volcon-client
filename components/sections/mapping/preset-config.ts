import type { AppDirectory } from "@/lib/app-icons"

export type ControlledApp = {
  id: string
  name: string
  percent: number
  /** Has a live audio session, so the control is moving something you can hear. */
  available: boolean
  /** Has a process running, whether or not it's playing anything. */
  running: boolean
  iconSrc: string
  iconAlt: string
  /** The executable the icon came from, for a sharper copy when it's shown large. */
  iconPath?: string | null
  sourceApps: string[]
  /** Per-app gain applied on top of the control's position, 0–1. */
  trim: number
  muted: boolean
  /** How many live audio sessions this app currently has. */
  processCount: number
}

export type MappingCardData = {
  id: string
  control: number
  name: string
  value: number
  controlledApps: ControlledApp[]
}

export type PresetAssignment = {
  control: number
  app: string
  label?: string | null
  /** Executable path captured when the assignment was made, used as a reliable icon-lookup fallback. */
  path?: string | null
  /**
   * Per-app gain applied on top of the control's position, 0–1. Undefined on
   * assignments written before trim existed, which read as unity.
   */
  trim?: number
  muted?: boolean
}

export const DEFAULT_TRIM = 1

export function assignmentTrim(assignment: Pick<PresetAssignment, "trim">) {
  return typeof assignment.trim === "number" && Number.isFinite(assignment.trim)
    ? Math.max(0, Math.min(1, assignment.trim))
    : DEFAULT_TRIM
}

export type SessionSnapshot = {
  pid: number
  name: string
  icon?: string | null
  executable_path?: string | null
}

export type ProcessSnapshot = SessionSnapshot

export type ProcessGroup = {
  id: string
  name: string
  normalizedName: string
  available: boolean
  iconSrc: string
  iconAlt: string
  processes: ProcessSnapshot[]
}

export type PresetConfig = {
  schemaVersion: 1
  activePresetId: string
  presets: Array<{
    id: string
    name: string
    controllerId: string
    deviceAliases: Record<string, string>
    groupAliases: Record<string, string>
    assignments: PresetAssignment[]
    mappings: MappingCardData[]
  }>
  nodeGraphs: Array<Record<string, never>>
}

export { clampPercent, controlValueToPercent } from "@/lib/control-volume-store"

export function normalizeAppName(app: string) {
  return app.trim().toLowerCase().replace(/\.exe$/, "")
}

/**
 * Directory portion of an executable path, used to cluster processes that
 * belong to the same installed app even when they run under different
 * process names (e.g. an Electron app's main process alongside its helper
 * processes, which usually all live next to each other on disk).
 */
export function appDirectoryKey(path?: string | null) {
  if (!path) return null

  const trimmed = path.trim().toLowerCase()
  const lastSlash = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"))

  return lastSlash > 0 ? trimmed.slice(0, lastSlash) : null
}

/** Clusters a process/session by install directory, falling back to its normalized name. */
export function appClusterKey(entry: { name: string; executable_path?: string | null }) {
  return appDirectoryKey(entry.executable_path) ?? `name:${normalizeAppName(entry.name)}`
}

const HELPER_PROCESS_PATTERN = /\b(helper|renderer|gpu|crashpad|updater|utility|service|subprocess|broker|plugin|zygote)\b/i

/**
 * Picks the representative entry for a cluster of processes that belong to
 * the same app (e.g. sub-processes of Spotify/Discord/Chrome), preferring an
 * entry that has an icon and doesn't look like a background helper process.
 */
export function pickPrimaryApp<T extends { name: string; icon?: string | null }>(candidates: T[]): T {
  const withIcon = candidates.filter((candidate) => candidate.icon)
  const pool = withIcon.length > 0 ? withIcon : candidates
  const primaryLooking = pool.filter((candidate) => !HELPER_PROCESS_PATTERN.test(candidate.name))
  const finalPool = primaryLooking.length > 0 ? primaryLooking : pool

  return [...finalPool].sort(
    (left, right) => left.name.length - right.name.length || left.name.localeCompare(right.name),
  )[0]
}

export function createEmptyPreset(id: string, name: string, controllerId = "") {
  return {
    id,
    name,
    controllerId,
    deviceAliases: {},
    groupAliases: {},
    assignments: [],
    mappings: [],
  }
}


export function upsertPresetAssignment(
  assignments: PresetAssignment[],
  nextAssignment: PresetAssignment,
) {
  const existing = assignments.find(
    (assignment) => assignment.control === nextAssignment.control && assignment.app === nextAssignment.app,
  )

  if (existing) {
    return assignments
  }

  return [...assignments, nextAssignment]
}

export function removePresetAssignment(
  assignments: PresetAssignment[],
  control: number,
  app: string,
) {
  return assignments.filter(
    (assignment) => !(assignment.control === control && assignment.app === app),
  )
}

export function getPresetAssignmentsForControl(assignments: PresetAssignment[], control: number) {
  return assignments.filter((assignment) => assignment.control === control)
}

type Preset = PresetConfig["presets"][number]

/**
 * MIDI numbers its controls 0-127, so from 128 up no controller can reach a
 * card. A card that lost its control - another took it over in a relearn - is
 * parked on one of these, keeping its apps until it's given a control again.
 * The backend stores them like any other, and nothing ever moves them.
 */
export const FIRST_UNBOUND_CONTROL = 128

export function isUnboundControl(control: number) {
  return control >= FIRST_UNBOUND_CONTROL
}

/** "Control 5", or that there isn't one. */
export function describeControl(control: number) {
  return isUnboundControl(control) ? "No control" : `Control ${control}`
}

/** The lowest parking number nothing in the preset is using. */
export function nextUnboundControl(preset: Pick<Preset, "mappings" | "assignments">) {
  const taken = new Set([
    ...preset.mappings.map((mapping) => mapping.control),
    ...preset.assignments.map((assignment) => assignment.control),
  ])
  let control = FIRST_UNBOUND_CONTROL

  while (taken.has(control)) {
    control += 1
  }

  return control
}

/**
 * A mapping moved onto another control, its apps going with it. A name that
 * only ever said which control it was on follows it to the new one.
 */
function moveMapping(preset: Preset, mappingId: string, to: number): Preset {
  const mapping = preset.mappings.find((entry) => entry.id === mappingId)

  if (!mapping) {
    return preset
  }

  const from = mapping.control
  const name =
    /^Control \d+$/.test(mapping.name.trim()) && !isUnboundControl(to) ? `Control ${to}` : mapping.name

  return {
    ...preset,
    mappings: preset.mappings.map((entry) =>
      entry.id === mappingId ? { ...entry, control: to, name } : entry,
    ),
    assignments: preset.assignments.map((assignment) =>
      assignment.control === from ? { ...assignment, control: to, label: name } : assignment,
    ),
  }
}

/**
 * A mapping put on a different control. If another mapping had that control,
 * it's left without one - parked, apps and all, until it's relearned - and
 * comes back as `displaced`.
 */
export function relearnMapping(preset: Preset, mappingId: string, control: number) {
  const displaced =
    preset.mappings.find((entry) => entry.control === control && entry.id !== mappingId) ?? null
  const cleared = displaced ? moveMapping(preset, displaced.id, nextUnboundControl(preset)) : preset

  return { preset: moveMapping(cleared, mappingId, control), displaced }
}

/**
 * Copies a control's mapping, and the apps under it, into another preset. If
 * that preset already maps the same control, the apps join its mapping (which
 * keeps its own name) instead of replacing it, so nothing on the target is
 * lost, and an app it already has there keeps its trim and mute.
 */
export function copyMappingToPreset(
  target: Preset,
  mapping: MappingCardData,
  assignments: PresetAssignment[],
): Preset {
  // A card without a control has nothing to join over there: it goes as a
  // card of its own, parked on a number that's free in that preset.
  const unbound = isUnboundControl(mapping.control)
  const control = unbound ? nextUnboundControl(target) : mapping.control
  const existing = unbound ? undefined : target.mappings.find((entry) => entry.control === control)
  const label = existing?.name ?? mapping.name

  const present = new Set(
    getPresetAssignmentsForControl(target.assignments, control).map((assignment) =>
      normalizeAppName(assignment.app),
    ),
  )
  const incoming: PresetAssignment[] = []

  for (const assignment of getPresetAssignmentsForControl(assignments, mapping.control)) {
    const app = normalizeAppName(assignment.app)

    if (present.has(app)) {
      continue
    }

    present.add(app)
    incoming.push({ ...assignment, control, label })
  }

  return {
    ...target,
    mappings: existing
      ? target.mappings
      : [...target.mappings, { ...mapping, control, id: uniqueMappingId(target, control) }],
    assignments: [...target.assignments, ...incoming],
  }
}

/** A preset without one of its mappings, or anything assigned to its control. */
export function removeMappingFromPreset(preset: Preset, mapping: MappingCardData): Preset {
  return {
    ...preset,
    mappings: preset.mappings.filter((entry) => entry.id !== mapping.id),
    assignments: preset.assignments.filter((assignment) => assignment.control !== mapping.control),
  }
}

function uniqueMappingId(preset: Preset, control: number) {
  const taken = new Set(preset.mappings.map((mapping) => mapping.id))
  const base = `${preset.id}-mapping-${control}`
  let id = base

  for (let suffix = 2; taken.has(id); suffix += 1) {
    id = `${base}-${suffix}`
  }

  return id
}

export function getPresetAssignmentConflicts(
  assignments: PresetAssignment[],
  app: string,
  control: number,
) {
  const normalizedApp = normalizeAppName(app)

  // A card without a control moves nothing, so it can't fight over an app.
  if (isUnboundControl(control)) {
    return []
  }

  return Array.from(
    new Set(
      assignments
        .filter(
          (assignment) =>
            normalizeAppName(assignment.app) === normalizedApp &&
            assignment.control !== control &&
            !isUnboundControl(assignment.control),
        )
        .map((assignment) => assignment.control),
    ),
  ).sort((left, right) => left - right)
}

export function buildControlledAppsFromAssignments(
  assignments: PresetAssignment[],
  control: number,
  processes: ProcessSnapshot[],
  /** Where each app lives and how it looks, for the ones that aren't running. */
  apps?: AppDirectory,
  /** Normalized names of every running app, audio or not. */
  runningApps: ReadonlySet<string> = new Set(),
) {
  function resolveProcesses(normalizedApp: string) {
    return processes.filter((currentProcess) => {
      const processName = normalizeAppName(currentProcess.name)
      const executablePath = currentProcess.executable_path?.trim().toLowerCase()

      return (
        processName === normalizedApp ||
        executablePath?.includes(`\\${normalizedApp}.exe`) ||
        executablePath?.endsWith(`\\${normalizedApp}`)
      )
    })
  }

  // Cluster assignments by install directory (falling back to normalized name) so that an
  // assignment covering an app's sub-processes (e.g. "Spotify" + "Spotify Helper (Renderer)")
  // renders as one card with one icon instead of one per literal process name.
  const clusters = new Map<
    string,
    {
      sourceApps: string[]
      candidates: Array<{ name: string; icon?: string | null; path?: string | null }>
      available: boolean
      running: boolean
      trim: number
      muted: boolean
      pids: Set<number>
    }
  >()

  for (const assignment of getPresetAssignmentsForControl(assignments, control)) {
    const normalizedApp = normalizeAppName(assignment.app)
    const matchedProcesses = resolveProcesses(normalizedApp)
    const process = matchedProcesses[0]
    // Playing audio implies running, but an app can be open without a session.
    const running = Boolean(process) || runningApps.has(normalizedApp)

    const displayName =
      process?.name?.replace(/\.exe$/i, "") ??
      apps?.name(assignment.app) ??
      assignment.app.replace(/\.exe$/i, "")
    // Running, it's the icon the process has now. Otherwise it's read from
    // wherever the app was last seen, or where it was when it was assigned,
    // falling back to the last icon it showed if neither file can be read.
    const iconSrc = process?.icon ?? apps?.icon(assignment.app, assignment.path) ?? ""

    const clusterKey =
      appDirectoryKey(assignment.path) ?? appDirectoryKey(process?.executable_path) ?? `name:${normalizedApp}`
    const iconPath = process?.executable_path ?? apps?.path(assignment.app) ?? assignment.path ?? null

    const existing = clusters.get(clusterKey)

    if (existing) {
      if (!existing.sourceApps.includes(assignment.app)) {
        existing.sourceApps.push(assignment.app)
      }
      existing.candidates.push({ name: displayName, icon: iconSrc || null, path: iconPath })
      existing.available = existing.available || Boolean(process)
      existing.running = existing.running || running
      // Trim and mute are edited for the whole cluster at once, so any member
      // carries the cluster's value; a muted member mutes the row.
      existing.muted = existing.muted || Boolean(assignment.muted)
      for (const matched of matchedProcesses) {
        existing.pids.add(matched.pid)
      }
      continue
    }

    clusters.set(clusterKey, {
      sourceApps: [assignment.app],
      candidates: [{ name: displayName, icon: iconSrc || null, path: iconPath }],
      available: Boolean(process),
      running,
      trim: assignmentTrim(assignment),
      muted: Boolean(assignment.muted),
      pids: new Set(matchedProcesses.map((matched) => matched.pid)),
    })
  }

  return Array.from(clusters.entries()).map(([clusterKey, cluster]) => {
    const primary = pickPrimaryApp(cluster.candidates)

    return {
      id: `${control}-${clusterKey}`,
      name: primary.name,
      percent: 0,
      available: cluster.available,
      running: cluster.running,
      iconSrc: primary.icon ?? "",
      iconAlt: primary.name,
      iconPath: primary.path ?? null,
      sourceApps: cluster.sourceApps,
      trim: cluster.trim,
      muted: cluster.muted,
      processCount: cluster.pids.size,
    } satisfies ControlledApp
  })
}

export function groupProcessesByApp(processes: ProcessSnapshot[], apps?: AppDirectory) {
  // Cluster by install directory (falling back to normalized name) so that sub-processes of the
  // same app (e.g. a Spotify/Discord/Chrome helper process) collapse into a single group instead
  // of showing up as separate "apps" with duplicate icons.
  const groupedProcesses = new Map<string, ProcessSnapshot[]>()

  for (const process of processes) {
    const clusterKey = appClusterKey(process)
    const existing = groupedProcesses.get(clusterKey) ?? []
    existing.push(process)
    groupedProcesses.set(clusterKey, existing)
  }

  return Array.from(groupedProcesses.entries())
    .map(([clusterKey, groupProcesses]) => {
      const orderedProcesses = [...groupProcesses].sort((left, right) => left.name.localeCompare(right.name))
      const primaryProcess = pickPrimaryApp(orderedProcesses)
      const normalizedName = normalizeAppName(primaryProcess.name)
      const displayName = primaryProcess.name.replace(/\.exe$/i, "") || normalizedName
      const iconSource =
        primaryProcess.icon ?? apps?.icon(primaryProcess.name, primaryProcess.executable_path) ?? ""

      return {
        id: clusterKey,
        name: displayName,
        normalizedName,
        available: orderedProcesses.length > 0,
        iconSrc: iconSource,
        iconAlt: displayName,
        processes: orderedProcesses,
      } satisfies ProcessGroup
    })
    .sort((left, right) => left.name.localeCompare(right.name))
}

export const initialPresetConfig: PresetConfig = {
  schemaVersion: 1,
  activePresetId: "",
  presets: [],
  nodeGraphs: [],
}

/** The presets as the Mapping screen last had them, once it has loaded them. */
let lastPresetConfig: PresetConfig | null = null

/** Kept by the Mapping screen, for other screens to read without asking the backend. */
export function rememberPresetConfig(config: PresetConfig) {
  lastPresetConfig = config
}

/** The presets as last seen, or null if the Mapping screen hasn't loaded them yet. */
export function lastKnownPresetConfig() {
  return lastPresetConfig
}

export function createPresetId(_name: string, existingIds: string[]) {
  const highestPresetNumber = existingIds.reduce((highest, existingId) => {
    const match = existingId.match(/^preset-(\d+)$/)

    if (!match) {
      return highest
    }

    return Math.max(highest, Number(match[1]))
  }, 0)

  let nextId = `preset-${highestPresetNumber + 1}`

  while (existingIds.includes(nextId)) {
    const nextNumber = Number(nextId.replace("preset-", "")) + 1
    nextId = `preset-${nextNumber}`
  }

  return nextId
}

export function clonePresetTemplate(
  template: PresetConfig["presets"][number],
  nextId: string,
  nextName: string,
) {
  return {
    ...template,
    id: nextId,
    name: nextName,
    mappings: template.mappings.map((mapping, mappingIndex) => ({
      ...mapping,
      id: `${nextId}-mapping-${mappingIndex + 1}`,
      controlledApps: mapping.controlledApps.map((app) => ({
        ...app,
        id: `${nextId}-${app.id}`,
      })),
    })),
  }
}