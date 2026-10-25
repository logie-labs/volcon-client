"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { invoke } from "@tauri-apps/api/core"

import {
  RiArrowDownSLine,
  RiArrowGoBackLine,
  RiArrowRightLine,
  RiCheckLine,
  RiCloseLine,
  RiComputerLine,
  RiDeleteBinLine,
  RiExternalLinkLine,
  RiFileCopyLine,
  RiFileTextLine,
  RiFolderOpenLine,
  RiLightbulbLine,
  RiUsbLine,
} from "@remixicon/react"

import { notificationKindStyle } from "@/components/notification-kind"
import { useActiveSection } from "@/components/sections/active-section-context"
import { requestMappingView } from "@/components/sections/mapping/mapping-navigation"
import {
  describeControl,
  lastKnownPresetConfig,
  normalizeAppName,
  type PresetConfig,
} from "@/components/sections/mapping/preset-config"
import { requestSettingsSection } from "@/components/sections/settings/settings-config"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { useMidiInputs, useRunningApps } from "@/context/volcon-context"
import { useAppIcon } from "@/lib/app-icons"
import { openExternal, revealInExplorer } from "@/lib/bridge-client"
import type { EventApp, NotificationEvent, SettingChange } from "@/lib/notification-events"
import {
  describeAge,
  describeTimestamp,
  notificationIdentity,
  notificationSourceLabels,
  toast,
  undoNotification,
  type Notification,
} from "@/lib/notifications"
import { hasTauriRuntime } from "@/lib/tauri-runtime"
import { compareVersions, useUpdates } from "@/lib/updates"
import { cn } from "@/lib/utils"

/*
 * What a notification was about, shown properly: each kind of event explained
 * in a sentence or two, then shown the way that suits it - the device with
 * whether it's connected now, the control that moved from one number to
 * another, the apps that were let go, the settings that changed and what they
 * changed to. A notification with no event behind it gets its description and
 * a table of whatever facts it carried.
 */

type DeviceEvent = Extract<NotificationEvent, { type: "device" }>

/** "3m 12s", "2h 5m", "4d": how long between two moments, roughly. */
function describeDuration(milliseconds: number) {
  const seconds = Math.max(1, Math.round(milliseconds / 1000))

  if (seconds < 60) {
    return `${seconds}s`
  }

  const minutes = Math.floor(seconds / 60)

  if (minutes < 60) {
    return seconds % 60 ? `${minutes}m ${seconds % 60}s` : `${minutes}m`
  }

  const hours = Math.floor(minutes / 60)

  if (hours < 24) {
    return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`
  }

  const days = Math.floor(hours / 24)
  return hours % 24 ? `${days}d ${hours % 24}h` : `${days}d`
}

/** The time of day something happened, to the second. */
function timeOf(at: number) {
  return new Date(at).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  })
}

/** "1 app", "3 apps". */
function count(amount: number, noun: string) {
  return `${amount} ${noun}${amount === 1 ? "" : "s"}`
}

/** "Spotify", "Spotify and Discord", "Spotify, Discord and Chrome". */
function listNames(names: string[]) {
  return names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
}

/** An instruction - "Open the log folder" - as the middle of a sentence. */
function asClause(instruction: string) {
  return instruction.charAt(0).toLowerCase() + instruction.slice(1)
}

/**
 * The device's notification on either side of this one: for a disconnect, the
 * time it came back; for a connect, the time it went. Only the neighbour
 * counts, so two disconnects in a row - with alerts off in between - don't pair
 * up across a gap nobody saw.
 */
function devicePartner(entry: Notification, event: DeviceEvent, log: readonly Notification[]) {
  const history = log.filter(
    (other) => other.event?.type === "device" && other.event.device === event.device
  )
  const index = history.findIndex((other) => other.id === entry.id)
  // The log is newest first: the next thing to happen is the one before it.
  const partner = event.change === "disconnected" ? history[index - 1] : history[index + 1]
  const opposite = event.change === "disconnected" ? "connected" : "disconnected"

  return partner?.event?.type === "device" && partner.event.change === opposite ? partner : null
}

/**
 * What happened, in sentences. Built from the notification and the log alone,
 * so it reads the same on screen and copied as text; whatever is true now,
 * rather than then, is shown beside it instead.
 */
function storyFor(entry: Notification, log: readonly Notification[]): string[] {
  const event = entry.event

  if (!event) {
    return [entry.description ?? "Nothing more was recorded about this one than its title."]
  }

  switch (event.type) {
    case "device": {
      const partner = devicePartner(entry, event, log)

      if (event.change === "disconnected") {
        return [
          `${event.device} disappeared from the list of MIDI controllers at ${timeOf(entry.at)}. It was unplugged or switched off, or Windows stopped seeing it.`,
          "While it's gone, its knobs and faders can't change anything, so every app it controls stays at the volume it was last set to.",
          partner
            ? `It came back ${describeDuration(partner.at - entry.at)} later, at ${timeOf(partner.at)}.`
            : "",
        ].filter(Boolean)
      }

      return [
        `${event.device} appeared in the list of MIDI controllers at ${timeOf(entry.at)}.`,
        partner ? `It had been gone for ${describeDuration(entry.at - partner.at)}.` : "",
      ].filter(Boolean)
    }

    case "control-learned":
      return event.alreadyMapped
        ? [
            `Control ${event.control} on ${event.device} was learned, but ${event.preset} already had a mapping for it, so learning it found that one again rather than adding another.`,
          ]
        : [
            `Volcon heard Control ${event.control} move on ${event.device}, and added it to ${event.preset} as a new mapping.`,
            "Assign apps to it and turning it will set their volume.",
          ]

    case "learn-blocked": {
      const why =
        event.missing === "preset"
          ? "There was no preset yet, so there was nowhere to put a new mapping."
          : event.missing === "controller"
            ? `${event.preset} didn't have a controller chosen, so there was nothing to listen to.`
            : `${event.preset} listens to ${event.device}, which wasn't connected.`

      return [
        "Learning a control needs a preset to add it to, a controller chosen for that preset, and that controller plugged in.",
        why,
      ]
    }

    case "learn-failed":
      return [
        `Volcon started listening to ${event.device} for a control to learn, but it went wrong before one was heard.`,
      ]

    case "control-moved":
      return [
        `${event.mapping} was moved from Control ${event.from} to Control ${event.to} in ${event.preset}, and its apps went with it: turning Control ${event.to} now sets their volume.`,
        event.displaced
          ? `${event.displaced.name} had Control ${event.to} before, so it was left without a control. Its apps are kept, but nothing moves them until it's relearned.`
          : "",
      ].filter(Boolean)

    case "mapping-deleted":
      return [
        `${event.mapping} was deleted from ${event.preset}, so Control ${event.control} doesn't change anything any more.`,
        event.apps.length > 0
          ? `${event.apps.length === 1 ? "Its app was" : `Its ${event.apps.length} apps were`} handed back to Windows: Volcon stopped setting ${event.apps.length === 1 ? "its" : "their"} volume, unmuted any it had muted, and left the rest as it was.`
          : "It had no apps assigned, so nothing else changed.",
      ]

    case "mapping-sent": {
      const where = event.newPreset ? `${event.to}, a new preset made for it` : event.to
      const names = event.apps.map((app) => app.name)

      return [
        event.mode === "move"
          ? `${event.mapping} (Control ${event.control}) was moved from ${event.from} to ${where}. ${event.from} doesn't have it any more.`
          : `${event.mapping} (Control ${event.control}) was copied from ${event.from} to ${where}. ${event.from} still has it too.`,
        event.mergedInto
          ? `${event.to} already used Control ${event.control}, as ${event.mergedInto}, so the apps joined that mapping rather than making a second one.`
          : "",
        names.length > 0
          ? `${listNames(names)} went with it.`
          : "It had no apps assigned.",
        event.mode === "move" && names.length > 0
          ? `Since it left ${event.from}, Volcon stopped setting ${names.length === 1 ? "that app's" : "those apps'"} volume there, unless another of its controls still does.`
          : "",
      ].filter(Boolean)
    }

    case "preset-created":
      return [
        `${event.preset} was created and switched to.`,
        event.device
          ? `It listens to ${event.device}. Learn a control to start mapping.`
          : "It doesn't have a controller yet: choose one in its settings, then learn a control.",
      ]

    case "preset-deleted": {
      const mappings = event.mappings.length

      return [
        mappings > 0
          ? `${event.preset} was deleted, along with its ${count(mappings, "mapping")} and the apps assigned to them.`
          : `${event.preset} was deleted. It didn't have any mappings.`,
      ]
    }

    case "preset-apply-failed":
      return [
        `Volcon couldn't hand ${event.preset} to the part of it that sets volumes, so its controls may not be moving the apps it shows.`,
        "It's sent again whenever the preset changes.",
      ]

    case "levels-failed":
      return [
        `Turning ${event.mapping} should have set the volume of ${listNames(event.apps.map((app) => app.name)) || "its apps"}, but the change didn't go through.`,
        "Moving the control again tries again.",
      ]

    case "settings-changed": {
      const changed = event.changes.length
      const summary =
        changed === 0
          ? "Nothing was different, so nothing actually changed."
          : `${count(changed, "setting")} changed.`

      if (event.how === "undone") {
        const kept = event.kept ?? 0

        return [
          `${count(changed, "setting")} went back to how ${changed === 1 ? "it was" : "they were"} before ${event.undid}.`,
          kept > 0
            ? `${kept === 1 ? "One you'd changed since was" : `${kept} you'd changed since were`} left as ${kept === 1 ? "it was" : "they were"}, as asked.`
            : "",
        ].filter(Boolean)
      }

      return event.how === "page-reset"
        ? [`Everything on the ${event.page} page went back to its default. ${summary}`]
        : event.how === "reset"
          ? [`Every setting went back to how Volcon ships. ${summary}`]
          : [`Your settings were replaced with the ones in ${event.file}. ${summary}`]
    }

    case "file-saved": {
      const folder = event.path.slice(0, Math.max(0, event.path.length - event.file.length - 1))

      return [
        `A copy of every setting was saved as ${event.file}${folder ? ` in ${folder}` : ""}.`,
        "Import it from Settings, under Backup & reset, to bring them back, on this PC or another.",
      ]
    }

    case "copied":
      return [`${event.what} was copied to the clipboard, ready to paste into a bug report.`]

    case "update-available":
      return [
        `Volcon ${event.latest} has been released, and this PC has ${event.installed}.`,
        event.prerelease
          ? "It's a pre-release: a test version, ahead of the release for everyone."
          : "",
        "What's new in it, and where to download it, are in Settings, under Updates.",
      ].filter(Boolean)

    case "action-failed":
      return [`Volcon tried to ${asClause(event.attempted)}, but it didn't work.`]
  }
}

/** Facts worth having in a copy beyond the story: lists the screen shows as chips and rows. */
function factsFor(event: NotificationEvent | undefined): string[] {
  if (!event) {
    return []
  }

  switch (event.type) {
    case "mapping-deleted":
    case "levels-failed":
      return event.apps.length > 0 ? [`Apps: ${event.apps.map((app) => app.name).join(", ")}`] : []
    case "preset-deleted":
      return event.mappings.map(
        (mapping) => `${mapping.name} (Control ${mapping.control}): ${count(mapping.apps, "app")}`
      )
    case "settings-changed":
      return event.changes.map(
        (change) => `${change.page} > ${change.label}: ${change.before} -> ${change.after}`
      )
    case "copied":
      return event.contents.map((line) => `- ${line}`)
    case "learn-failed":
    case "preset-apply-failed":
    case "levels-failed":
    case "action-failed":
      return [
        `Reason: ${event.reason}`,
        ...(event.type === "action-failed" && event.target ? [event.target.value] : []),
      ]
    default:
      return []
  }
}

/** Everything written down about one notification, as plain text. */
export function notificationText(entry: Notification, log: readonly Notification[] = []) {
  return [
    entry.title,
    ...storyFor(entry, log),
    ...(entry.event ? factsFor(entry.event) : entry.fields.map((field) => `${field.label}: ${field.value}`)),
    `${notificationSourceLabels[entry.source]} · ${describeTimestamp(entry.at)}`,
    entry.detail,
  ]
    .filter(Boolean)
    .join("\n")
}

/**
 * The presets as they are now, for what's become of a preset or mapping since:
 * the Mapping screen's copy if it has loaded one, otherwise the saved file.
 */
function usePresetConfig() {
  const [config, setConfig] = useState<PresetConfig | null>(lastKnownPresetConfig)

  useEffect(() => {
    if (config || !hasTauriRuntime()) {
      return
    }

    let cancelled = false

    void invoke<PresetConfig>("load_preset_config")
      .then((loaded) => {
        if (!cancelled) {
          setConfig(loaded)
        }
      })
      .catch(() => {
        // Without it, nothing is said about now - only about then.
      })

    return () => {
      cancelled = true
    }
  }, [config])

  return config
}

/** Somewhere to go from a notification: a mapping's own screen, or a Settings page. */
function useGoTo() {
  const { setActive } = useActiveSection()

  return {
    mapping: (mappingId: string | null) => {
      requestMappingView(mappingId)
      setActive("mapping")
    },
    settings: (page: string) => {
      requestSettingsSection(page)
      setActive("settings")
    },
  }
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h3 className="font-mono text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
      {children}
    </h3>
  )
}

/** A part of the detail with a heading of its own. */
function Part({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <SectionLabel>{title}</SectionLabel>
      {children}
    </section>
  )
}

/** One box in a row of them, as the steps on an app's own screen are drawn. */
function Tile({
  caption,
  value,
  note,
  tone = "plain",
}: {
  caption: string
  value: ReactNode
  note?: ReactNode
  tone?: "plain" | "primary" | "warning" | "gone"
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 flex-col gap-1.5 border px-3 py-2.5",
        tone === "primary" && "border-primary/40 bg-primary/10",
        tone === "warning" && "border-amber-500/40 bg-amber-500/10",
        tone === "gone" && "border-dashed bg-transparent opacity-70",
        tone === "plain" && "bg-muted/40"
      )}
    >
      <span className="font-mono text-[9px] tracking-[0.2em] text-muted-foreground uppercase">
        {caption}
      </span>
      <span
        className={cn(
          "truncate font-mono text-base leading-none",
          tone === "primary" && "text-primary",
          tone === "warning" && "text-amber-600 dark:text-amber-400",
          tone === "gone" && "line-through decoration-muted-foreground/60"
        )}
      >
        {value}
      </span>
      {note ? <span className="truncate text-[10px] text-muted-foreground">{note}</span> : null}
    </div>
  )
}

/** Tiles in a row, an arrow between each: from this, to that. */
function Flow({ children }: { children: ReactNode[] }) {
  return (
    <div className="flex items-stretch gap-1.5">
      {children.map((child, index) => (
        <div key={index} className="contents">
          {index > 0 ? (
            <RiArrowRightLine aria-hidden className="size-4 shrink-0 self-center text-muted-foreground" />
          ) : null}
          {child}
        </div>
      ))}
    </div>
  )
}

/** An app as it's shown everywhere else: its icon, grey while it isn't running. */
function AppChip({ app }: { app: EventApp }) {
  const icon = useAppIcon(app.app)
  const running = useRunningApps().has(normalizeAppName(app.app))

  return (
    <span className="flex min-w-0 items-center gap-2 border bg-muted/30 py-1 pr-2.5 pl-1">
      <span className="flex size-6 shrink-0 items-center justify-center overflow-hidden">
        {icon ? (
          <img
            src={icon}
            alt=""
            className={cn("size-full object-contain", !running && "grayscale")}
          />
        ) : (
          <RiComputerLine aria-hidden className="size-3.5 text-muted-foreground" />
        )}
      </span>
      <span className="truncate text-xs">{app.name}</span>
      <span className="sr-only">{running ? "(running)" : "(not running)"}</span>
    </span>
  )
}

function AppChips({ apps }: { apps: EventApp[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {apps.map((app) => (
        <AppChip key={app.app} app={app} />
      ))}
    </div>
  )
}

/** The device, and whether it's connected right now. */
function DeviceCard({ device, presets }: { device: string; presets: ReactNode }) {
  const connected = useMidiInputs().includes(device)

  return (
    <div className="flex items-center gap-3 border bg-muted/30 p-3">
      <span className="flex size-10 shrink-0 items-center justify-center border bg-muted">
        <RiUsbLine aria-hidden className="size-5 text-muted-foreground" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{device}</p>
        <p className="truncate text-xs text-muted-foreground">{presets}</p>
      </div>
      <span
        className={cn(
          "flex shrink-0 items-center gap-1.5 font-mono text-[10px] tracking-widest uppercase",
          connected ? "text-primary" : "text-muted-foreground"
        )}
      >
        <span aria-hidden className={cn("size-1.5", connected ? "bg-primary" : "bg-destructive")} />
        {connected ? "Connected now" : "Not connected"}
      </span>
    </div>
  )
}

type CheckState = "done" | "failed" | "todo"

/** Steps, each done, failed, or still to do. */
function Checklist({
  items,
}: {
  items: Array<{ label: string; note?: string; state: CheckState }>
}) {
  return (
    <ol className="flex flex-col border">
      {items.map((item) => (
        <li key={item.label} className="flex items-start gap-3 border-b px-3 py-2 last:border-b-0">
          <span
            aria-hidden
            className={cn(
              "mt-0.5 flex size-4 shrink-0 items-center justify-center border",
              item.state === "done" && "border-primary/50 bg-primary/15 text-primary",
              item.state === "failed" && "border-destructive/50 bg-destructive/15 text-destructive",
              item.state === "todo" && "border-dashed"
            )}
          >
            {item.state === "done" ? (
              <RiCheckLine className="size-3" />
            ) : item.state === "failed" ? (
              <RiCloseLine className="size-3" />
            ) : null}
          </span>
          <div className="min-w-0">
            <p className={cn("text-sm", item.state === "todo" && "text-muted-foreground")}>
              {item.label}
              <span className="sr-only">
                {item.state === "done" ? " (done)" : item.state === "failed" ? " (missing)" : " (not done)"}
              </span>
            </p>
            {item.note ? <p className="text-xs text-muted-foreground">{item.note}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  )
}

/** Settings that changed, under the page each is on. */
function ChangeList({ changes }: { changes: SettingChange[] }) {
  const pages = [...new Set(changes.map((change) => change.page))]

  return (
    <div className="flex flex-col border text-xs">
      {pages.map((page) => (
        <div key={page} className="border-b last:border-b-0">
          <p className="border-b bg-muted/30 px-3 py-1.5 font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
            {page}
          </p>
          {changes
            .filter((change) => change.page === page)
            .map((change) => (
              <div
                key={change.label}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b px-3 py-2 last:border-b-0"
              >
                <span className="truncate">{change.label}</span>
                <span className="flex items-center gap-1.5 font-mono text-[11px] whitespace-nowrap">
                  <span className="text-muted-foreground line-through decoration-muted-foreground/50">
                    {change.before}
                  </span>
                  <RiArrowRightLine aria-hidden className="size-3 text-muted-foreground" />
                  <span className="text-primary">{change.after}</span>
                </span>
              </div>
            ))}
        </div>
      ))}
    </div>
  )
}

/** What went wrong, in the words it came with. */
function Reason({ children, tone = "error" }: { children: ReactNode; tone?: "error" | "warning" }) {
  return (
    <p
      className={cn(
        "border px-3 py-2 font-mono text-[11px] leading-relaxed wrap-break-word",
        tone === "error"
          ? "border-destructive/30 bg-destructive/10 text-destructive"
          : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
      )}
    >
      {children}
    </p>
  )
}

/** What might put it right. */
function Hint({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-xs text-muted-foreground">
      <RiLightbulbLine aria-hidden className="mt-px size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  )
}

/** Something true now rather than then, set apart from the story. */
function Now({ children }: { children: ReactNode }) {
  return (
    <p className="border-l-2 border-primary/50 pl-3 text-xs text-muted-foreground">
      <span className="mr-1.5 font-mono text-[10px] tracking-widest text-primary uppercase">Now</span>
      {children}
    </p>
  )
}

/** A copy button that says it worked without adding to the log it copies from. */
function CopyButton({
  text,
  label = "Copy",
  variant = "ghost",
}: {
  text: string
  label?: string
  variant?: "ghost" | "outline"
}) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current)
      }
    },
    []
  )

  return (
    <Button
      variant={variant}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true)

          if (timer.current !== null) {
            window.clearTimeout(timer.current)
          }

          timer.current = window.setTimeout(() => setCopied(false), 1500)
        })
      }}
    >
      <RiFileCopyLine /> {copied ? "Copied" : label}
    </Button>
  )
}

/** A preset as it is now, found by id, and whether it's the one in use. */
function findPreset(config: PresetConfig | null, presetId: string) {
  const preset = config?.presets.find((candidate) => candidate.id === presetId) ?? null

  return { preset, active: preset !== null && config?.activePresetId === presetId }
}

/** A mapping as it is now, wherever it lives, with how many apps it has. */
function findMapping(config: PresetConfig | null, mappingId: string | undefined) {
  for (const preset of config?.presets ?? []) {
    const mapping = preset.mappings.find((candidate) => candidate.id === mappingId)

    if (mapping) {
      const apps = new Set(
        preset.assignments
          .filter((assignment) => assignment.control === mapping.control)
          .map((assignment) => normalizeAppName(assignment.app))
      ).size

      return { mapping, preset, apps, active: config?.activePresetId === preset.id }
    }
  }

  return null
}

type DetailParts = {
  /** Shown under the story. */
  body?: ReactNode
  /** Things to do about it that still work once Volcon has been closed and opened again. */
  actions?: ReactNode
}

/** The parts of the detail that suit this kind of event, and what can be done about it. */
function useEventParts({
  entry,
  event,
  config,
  log,
}: {
  entry: Notification
  event: NotificationEvent
  config: PresetConfig | null
  log: readonly Notification[]
}): DetailParts {
  const go = useGoTo()
  const midiInputs = useMidiInputs()
  const updates = useUpdates()

  switch (event.type) {
    case "device": {
      const users = (config?.presets ?? []).filter((preset) => preset.controllerId === event.device)
      const partner = devicePartner(entry, event, log)
      const connected = midiInputs.includes(event.device)

      return {
        body: (
          <>
            <DeviceCard
              device={event.device}
              presets={
                config === null
                  ? "MIDI controller"
                  : users.length === 0
                    ? "No preset uses it"
                    : `Used by ${listNames(
                        users.map((preset) =>
                          preset.id === config.activePresetId ? `${preset.name} (in use)` : preset.name
                        )
                      )}`
              }
            />
            {event.change === "disconnected" && !partner && connected ? (
              <Now>It&apos;s connected again, though Volcon didn&apos;t see it come back.</Now>
            ) : event.change === "connected" && !connected ? (
              <Now>It&apos;s been disconnected again since.</Now>
            ) : null}
            {users.length > 0 ? (
              <Part title="Mappings on it">
                <div className="flex flex-col border text-xs">
                  {users.map((preset) => (
                    <div key={preset.id} className="border-b last:border-b-0">
                      <p className="flex items-center justify-between border-b bg-muted/30 px-3 py-1.5 font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
                        <span className="truncate">{preset.name}</span>
                        {preset.id === config?.activePresetId ? (
                          <span className="text-primary">In use</span>
                        ) : null}
                      </p>
                      {preset.mappings.length === 0 ? (
                        <p className="px-3 py-2 text-muted-foreground">No mappings yet</p>
                      ) : (
                        preset.mappings.map((mapping) => (
                          <div
                            key={mapping.id}
                            className="grid grid-cols-[6rem_minmax(0,1fr)_auto] items-center gap-3 border-b px-3 py-2 last:border-b-0"
                          >
                            <span className="font-mono text-[11px]">{describeControl(mapping.control)}</span>
                            <span className="truncate">{mapping.name}</span>
                            <span className="font-mono text-[11px] text-muted-foreground">
                              {count(
                                new Set(
                                  preset.assignments
                                    .filter((assignment) => assignment.control === mapping.control)
                                    .map((assignment) => normalizeAppName(assignment.app))
                                ).size,
                                "app"
                              )}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  ))}
                </div>
              </Part>
            ) : null}
          </>
        ),
      }
    }

    case "control-learned": {
      const now = findMapping(config, event.mappingId)

      return {
        body: (
          <>
            <Flow>
              {[
                <Tile key="device" caption="Controller" value={event.device} />,
                <Tile
                  key="control"
                  caption={event.alreadyMapped ? "Found again" : "Learned"}
                  value={`Control ${event.control}`}
                  note={event.preset}
                  tone="primary"
                />,
              ]}
            </Flow>
            {config ? (
              <Now>
                {now
                  ? `It's in ${now.preset.name} as ${now.mapping.name.trim() || describeControl(now.mapping.control)}, with ${now.apps === 0 ? "no apps assigned yet" : count(now.apps, "app")}.`
                  : "That mapping has since been deleted."}
              </Now>
            ) : null}
          </>
        ),
        actions:
          now?.active ? (
            <Button variant="outline" onClick={() => go.mapping(now.mapping.id)}>
              Open {now.mapping.name.trim() || describeControl(now.mapping.control)}
            </Button>
          ) : null,
      }
    }

    case "learn-blocked": {
      const steps: Array<{ label: string; note?: string; state: CheckState }> = [
        {
          label: "A preset to add it to",
          note: event.preset,
          state: event.missing === "preset" ? "failed" : "done",
        },
        {
          label: "A controller chosen for the preset",
          note: event.device,
          state: event.missing === "controller" ? "failed" : event.missing === "preset" ? "todo" : "done",
        },
        {
          label: "That controller plugged in",
          state: event.missing === "connection" ? "failed" : "todo",
        },
      ]
      const fixedNow =
        event.missing === "connection" && event.device && midiInputs.includes(event.device)
          ? `${event.device} is connected, so learning should work now.`
          : event.missing === "preset" && config && config.presets.length > 0
            ? "There's a preset now, so that's no longer in the way."
            : null

      return {
        body: (
          <>
            <Checklist items={steps} />
            {fixedNow ? <Now>{fixedNow}</Now> : null}
          </>
        ),
        actions: (
          <Button variant="outline" onClick={() => go.mapping(null)}>
            Go to Mapping
          </Button>
        ),
      }
    }

    case "learn-failed":
      return {
        body: (
          <>
            <Reason>{event.reason}</Reason>
            <Hint>
              Check that {event.device} is plugged in and isn&apos;t open in another program, then try learning again.
            </Hint>
          </>
        ),
      }

    case "control-moved": {
      const moved = findMapping(config, event.mappingId)
      const displaced = event.displaced ? findMapping(config, event.displaced.id) : null

      return {
        body: (
          <div className="flex flex-col gap-1.5">
            <Flow>
              {[
                <Tile key="from" caption="Was on" value={`Control ${event.from}`} note={event.mapping} />,
                <Tile key="to" caption="Now on" value={`Control ${event.to}`} note={event.mapping} tone="primary" />,
              ]}
            </Flow>
            {event.displaced ? (
              <Flow>
                {[
                  <Tile key="from" caption="Was on" value={`Control ${event.to}`} note={event.displaced.name} />,
                  <Tile key="to" caption="Now on" value="No control" note={event.displaced.name} tone="warning" />,
                ]}
              </Flow>
            ) : null}
          </div>
        ),
        actions: (
          <>
            {moved?.active ? (
              <Button variant="outline" onClick={() => go.mapping(moved.mapping.id)}>
                Open {event.mapping}
              </Button>
            ) : null}
            {displaced?.active ? (
              <Button variant="outline" onClick={() => go.mapping(displaced.mapping.id)}>
                Open {event.displaced?.name}
              </Button>
            ) : null}
          </>
        ),
      }
    }

    case "mapping-deleted":
      return {
        body: (
          <>
            <Tile
              caption={`Deleted from ${event.preset}`}
              value={`Control ${event.control}`}
              note={event.mapping}
              tone="gone"
            />
            {event.apps.length > 0 ? (
              <Part title="Handed back to Windows">
                <AppChips apps={event.apps} />
              </Part>
            ) : null}
          </>
        ),
      }

    case "mapping-sent": {
      const target = findPreset(config, event.toId)

      return {
        body: (
          <>
            <Flow>
              {[
                <Tile
                  key="from"
                  caption="From"
                  value={event.from}
                  note={event.mode === "move" ? "no longer has it" : "still has it"}
                />,
                <Tile
                  key="to"
                  caption={event.mode === "move" ? "Moved to" : "Copied to"}
                  value={event.to}
                  note={event.mergedInto ? `joined ${event.mergedInto}` : event.newPreset ? "new preset" : `Control ${event.control}`}
                  tone="primary"
                />,
              ]}
            </Flow>
            {event.apps.length > 0 ? (
              <Part title="Went with it">
                <AppChips apps={event.apps} />
              </Part>
            ) : null}
            {config && !target.preset ? <Now>{event.to} has since been deleted.</Now> : null}
            {target.active ? <Now>{event.to} is the preset in use.</Now> : null}
          </>
        ),
      }
    }

    case "preset-created": {
      const { preset, active } = findPreset(config, event.presetId)
      const mappings = preset?.mappings.length ?? 0
      const apps = new Set(preset?.assignments.map((assignment) => normalizeAppName(assignment.app))).size

      return {
        body:
          config && !preset ? (
            <Now>{event.preset} has since been deleted.</Now>
          ) : (
            <Part title={config ? "Getting it going" : "Next"}>
              <Checklist
                items={[
                  { label: "Create the preset", note: event.preset, state: "done" },
                  {
                    label: "Choose a controller",
                    note: preset?.controllerId || event.device,
                    state: (preset ? preset.controllerId : event.device) ? "done" : "todo",
                  },
                  {
                    label: "Learn a control",
                    note: mappings > 0 ? count(mappings, "mapping") : undefined,
                    state: mappings > 0 ? "done" : "todo",
                  },
                  {
                    label: "Assign apps",
                    note: apps > 0 ? count(apps, "app") : undefined,
                    state: apps > 0 ? "done" : "todo",
                  },
                ]}
              />
            </Part>
          ),
        actions: active ? (
          <Button variant="outline" onClick={() => go.mapping(null)}>
            Go to Mapping
          </Button>
        ) : null,
      }
    }

    case "preset-deleted":
      return {
        body:
          event.mappings.length > 0 ? (
            <Part title="Went with it">
              <div className="flex flex-col gap-1.5">
                {event.mappings.map((mapping) => (
                  <Tile
                    key={mapping.control}
                    caption={`Control ${mapping.control}`}
                    value={mapping.name}
                    note={mapping.apps === 0 ? "no apps" : count(mapping.apps, "app")}
                    tone="gone"
                  />
                ))}
              </div>
            </Part>
          ) : null,
      }

    case "preset-apply-failed":
      return {
        body: (
          <>
            <Reason>{event.reason}</Reason>
            <Hint>Switching to another preset and back sends it again.</Hint>
          </>
        ),
      }

    case "levels-failed":
      return {
        body: (
          <>
            <Flow>
              {[
                <Tile key="control" caption="Turned" value={`Control ${event.control}`} note={event.mapping} />,
                <div key="apps" className="flex min-w-0 flex-1 flex-col gap-1.5 border bg-muted/40 px-3 py-2.5">
                  <span className="font-mono text-[9px] tracking-[0.2em] text-muted-foreground uppercase">
                    Should have set
                  </span>
                  <AppChips apps={event.apps} />
                </div>,
              ]}
            </Flow>
            <Reason>{event.reason}</Reason>
          </>
        ),
      }

    case "settings-changed":
      return {
        body:
          event.changes.length > 0 ? (
            <Part title="What changed">
              <ChangeList changes={event.changes} />
            </Part>
          ) : null,
      }

    case "file-saved":
      return {
        body: (
          <div className="flex items-center gap-3 border bg-muted/30 p-3">
            <span className="flex size-10 shrink-0 items-center justify-center border bg-muted">
              <RiFileTextLine aria-hidden className="size-5 text-muted-foreground" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{event.file}</p>
              <p className="truncate font-mono text-[11px] text-muted-foreground" title={event.path}>
                {event.path}
              </p>
            </div>
          </div>
        ),
        actions: (
          <>
            <Button
              variant="outline"
              onClick={() => {
                void revealInExplorer(event.path).catch((error: unknown) => {
                  const reason = error instanceof Error ? error.message : String(error)

                  toast.error("Couldn't show the backup", {
                    source: "settings",
                    detail: reason,
                    event: {
                      type: "action-failed",
                      attempted: "Show the backup in its folder",
                      reason,
                      hint: "It may have been moved or deleted since it was saved.",
                      target: { kind: "path", value: event.path },
                    },
                  })
                })
              }}
            >
              <RiFolderOpenLine /> Show in folder
            </Button>
            <CopyButton text={event.path} label="Copy path" variant="outline" />
          </>
        ),
      }

    case "update-available":
      return {
        body: (
          <>
            <Flow>
              {[
                <Tile key="installed" caption="This PC has" value={event.installed} />,
                <Tile
                  key="latest"
                  caption={event.prerelease ? "Pre-release" : "Released"}
                  value={event.latest}
                  tone="primary"
                />,
              ]}
            </Flow>
            {updates.result && compareVersions(updates.result.installed ?? "0", event.latest) >= 0 ? (
              <Now>You&apos;re on {updates.result.installed} now.</Now>
            ) : null}
          </>
        ),
        actions: (
          <>
            <Button variant="outline" onClick={() => go.settings("updates")}>
              Open Updates
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                void openExternal(event.url).catch(() => {
                  // The Updates page has the same link, and says so if it fails.
                })
              }}
            >
              <RiExternalLinkLine /> Release page
            </Button>
          </>
        ),
      }

    case "copied":
      return {
        body: (
          <Part title="What's in it">
            <ul className="flex flex-col gap-1 text-xs text-foreground/90">
              {event.contents.map((line) => (
                <li key={line} className="flex gap-2">
                  <span aria-hidden className="mt-1.5 size-1 shrink-0 bg-muted-foreground/60" />
                  {line}
                </li>
              ))}
            </ul>
          </Part>
        ),
        actions: (
          <Button variant="outline" onClick={() => go.settings("diagnostics")}>
            Open Diagnostics
          </Button>
        ),
      }

    case "action-failed":
      return {
        body: (
          <>
            <Reason>{event.reason}</Reason>
            {event.target ? (
              <p
                className="truncate border bg-muted/30 px-3 py-2 font-mono text-[11px]"
                title={event.target.value}
              >
                {event.target.value}
              </p>
            ) : null}
            {event.hint ? <Hint>{event.hint}</Hint> : null}
          </>
        ),
        actions:
          event.target?.kind === "url" ? (
            <CopyButton text={event.target.value} label="Copy link" variant="outline" />
          ) : event.target?.kind === "path" ? (
            <CopyButton text={event.target.value} label="Copy path" variant="outline" />
          ) : null,
      }
  }
}

/**
 * Undo while it can be, then when it was. Pressed here, the change lands on
 * another screen out of sight, so the button says so itself - and the title bar
 * does too - rather than looking as if nothing happened.
 */
function UndoControl({ entry }: { entry: Notification }) {
  if (entry.undoneAt !== undefined) {
    return (
      <span className="flex items-center gap-1.5 border border-primary/30 bg-primary/10 px-2.5 py-1.5 text-xs text-primary">
        <RiCheckLine aria-hidden className="size-3.5" />
        Undone at {timeOf(entry.undoneAt)}
      </span>
    )
  }

  if (!entry.undo) {
    return null
  }

  return (
    <Button variant="outline" onClick={() => void undoNotification(entry.id)}>
      <RiArrowGoBackLine /> Undo
    </Button>
  )
}

/** Events with an Undo, which only lasts as long as Volcon is open. */
const undoable = new Set<NotificationEvent["type"]>([
  "mapping-deleted",
  "control-moved",
  "preset-deleted",
  "settings-changed",
])

/**
 * Other notifications that belong with this one: every time the same device
 * came or went, or every time this same message was raised.
 */
function relatedTo(entry: Notification, log: readonly Notification[]) {
  const event = entry.event

  if (event?.type === "device") {
    return log.filter((other) => other.event?.type === "device" && other.event.device === event.device)
  }

  const identity = notificationIdentity(entry)
  return log.filter((other) => notificationIdentity(other) === identity)
}

/** Related notifications as a list, newest first, this one marked. */
function Timeline({
  entry,
  related,
  onView,
}: {
  entry: Notification
  related: Notification[]
  onView: (id: number) => void
}) {
  const shown = related.slice(0, 8)
  const isDevice = entry.event?.type === "device"

  return (
    <Part title={isDevice ? `${(entry.event as DeviceEvent).device}, coming and going` : `Every time · ${related.length}`}>
      <ol className="flex flex-col border">
        {shown.map((other, index) => {
          const { dot } = notificationKindStyle[other.kind]
          const older = related[index + 1]
          // For a device, how long it had been away when it came back.
          const away =
            isDevice &&
            other.event?.type === "device" &&
            other.event.change === "connected" &&
            older?.event?.type === "device" &&
            older.event.change === "disconnected"
              ? `after ${describeDuration(other.at - older.at)} away`
              : null

          return (
            <li key={other.id} className="border-b last:border-b-0">
              <button
                type="button"
                onClick={() => onView(other.id)}
                disabled={other.id === entry.id}
                aria-current={other.id === entry.id ? "true" : undefined}
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors hover:bg-muted/30",
                  other.id === entry.id && "bg-muted/40 hover:bg-muted/40"
                )}
              >
                <span aria-hidden className={cn("size-1.5 shrink-0", dot)} />
                <span className="min-w-0 flex-1 truncate">
                  {other.title}
                  {away ? <span className="text-muted-foreground"> · {away}</span> : null}
                </span>
                {other.id === entry.id ? (
                  <span className="font-mono text-[9px] tracking-widest text-muted-foreground uppercase">
                    This one
                  </span>
                ) : null}
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
                  {describeTimestamp(other.at)}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
      {related.length > shown.length ? (
        <p className="text-[11px] text-muted-foreground">
          And {related.length - shown.length} more before these.
        </p>
      ) : null}
    </Part>
  )
}

/**
 * Whether the technical detail only repeats what the event already shows - a
 * failure's reason, a saved file's path - which isn't worth folding away again.
 */
function alreadyShown(entry: Notification, detail: string) {
  const event = entry.event

  return (
    detail === entry.description ||
    (event?.type === "file-saved" && detail === event.path) ||
    (event !== undefined && "reason" in event && detail === event.reason)
  )
}

/** Whatever was written down for whoever has to dig into it, folded away. */
function TechnicalDetails({ detail }: { detail: string }) {
  const [open, setOpen] = useState(false)

  return (
    <section className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 self-start font-mono text-[10px] font-semibold tracking-widest text-muted-foreground uppercase transition-colors hover:text-foreground"
      >
        Technical details
        <RiArrowDownSLine aria-hidden className={cn("size-3.5 transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <pre className="border bg-muted/30 p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
          {detail}
        </pre>
      ) : null}
    </section>
  )
}

/** The facts a notification without an event carried, as a table. */
function FactTable({ entry }: { entry: Notification }) {
  const facts = [
    { label: "When", value: describeTimestamp(entry.at) },
    { label: "Source", value: notificationSourceLabels[entry.source] },
    ...entry.fields,
  ]

  return (
    <dl className="grid grid-cols-[auto_1fr] border text-xs">
      {facts.map((fact) => (
        <div key={fact.label} className="col-span-2 grid grid-cols-subgrid border-b last:border-b-0">
          <dt className="border-r bg-muted/30 px-3 py-2 font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
            {fact.label}
          </dt>
          <dd className="min-w-0 px-3 py-2 wrap-break-word">{fact.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** The event's own parts, in a component of their own so its hooks always run in order. */
function EventDetail({
  entry,
  event,
  log,
  onView,
}: {
  entry: Notification
  event: NotificationEvent
  log: readonly Notification[]
  onView: (id: number) => void
}) {
  const config = usePresetConfig()
  const parts = useEventParts({ entry, event, config, log })
  const related = relatedTo(entry, log)
  // Settings put back by an undo never had one of their own.
  const hadUndo =
    undoable.has(event.type) && !(event.type === "settings-changed" && event.how === "undone")
  const undoGone = hadUndo && !entry.undo && entry.undoneAt === undefined

  return (
    <>
      {parts.body}

      {parts.actions || entry.actions.length > 0 || entry.undo || entry.undoneAt !== undefined ? (
        <div className="flex flex-wrap items-center gap-2">
          <UndoControl entry={entry} />
          {parts.actions}
          {entry.actions.map((action) => (
            <Button key={action.label} variant="outline" onClick={action.onClick}>
              {action.label}
            </Button>
          ))}
        </div>
      ) : null}

      {undoGone ? (
        <p className="text-[11px] text-muted-foreground">
          Undo was offered until Volcon was closed, so it can&apos;t be undone from here now.
        </p>
      ) : null}

      {related.length > 1 ? <Timeline entry={entry} related={related} onView={onView} /> : null}
    </>
  )
}

export function NotificationDetail({
  entry,
  log,
  now,
  onDelete,
  onView,
}: {
  entry: Notification
  /** The whole log, for what happened before and after. */
  log: readonly Notification[]
  now: number
  onDelete: () => void
  /** Shows another notification in this one's place. */
  onView: (id: number) => void
}) {
  const { icon: Icon, tone, label } = notificationKindStyle[entry.kind]
  const event = entry.event

  return (
    // The sheet's own width is set for its side, so this is too.
    <SheetContent side="right" className="gap-0 data-[side=right]:sm:max-w-lg">
      <SheetHeader className="border-b pr-12">
        <div className="flex items-start gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center border bg-muted">
            <Icon aria-hidden className={cn("size-4", tone)} />
          </span>
          <div className="min-w-0">
            <SheetTitle className="leading-snug">{entry.title}</SheetTitle>
            <SheetDescription className="font-mono text-[10px] tracking-widest uppercase">
              {label} · {notificationSourceLabels[entry.source]} · {describeAge(entry.at, now)}
            </SheetDescription>
          </div>
        </div>
      </SheetHeader>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-5 p-4">
          <Part title="What happened">
            <div className="flex flex-col gap-2 text-sm leading-relaxed text-foreground/90">
              {storyFor(entry, log).map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </div>
          </Part>

          {event ? (
            <EventDetail key={entry.id} entry={entry} event={event} log={log} onView={onView} />
          ) : (
            <>
              <FactTable entry={entry} />
              {entry.actions.length > 0 || entry.undo || entry.undoneAt !== undefined ? (
                <div className="flex flex-wrap items-center gap-2">
                  <UndoControl entry={entry} />
                  {entry.actions.map((action) => (
                    <Button key={action.label} variant="outline" onClick={action.onClick}>
                      {action.label}
                    </Button>
                  ))}
                </div>
              ) : null}
            </>
          )}

          {entry.detail && !alreadyShown(entry, entry.detail) ? (
            <TechnicalDetails key={`detail-${entry.id}`} detail={entry.detail} />
          ) : null}

          <p className="font-mono text-[10px] tracking-widest text-muted-foreground/80 uppercase">
            {describeTimestamp(entry.at)}
          </p>
        </div>
      </ScrollArea>

      <SheetFooter className="flex-row items-center justify-between border-t">
        <Button variant="ghost" className="text-destructive" onClick={onDelete}>
          <RiDeleteBinLine /> Delete
        </Button>
        <div className="flex gap-2">
          <CopyButton text={notificationText(entry, log)} />
          <SheetClose render={<Button variant="outline" />}>Close</SheetClose>
        </div>
      </SheetFooter>
    </SheetContent>
  )
}
