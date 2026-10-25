"use client"

import { RiCloseLine, RiSearchLine } from "@remixicon/react"

import {
  notificationKinds,
  notificationKindStyle,
} from "@/components/notification-kind"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { eventKeywords } from "@/lib/notification-events"
import {
  notificationSourceLabels,
  type Notification,
  type NotificationKind,
  type NotificationSource,
} from "@/lib/notifications"
import { cn } from "@/lib/utils"

export type NotificationFilterState = {
  query: string
  /**
   * The kinds and sources taken out of the list. Stored as what's hidden rather
   * than what's shown, so every switch starts lit next to a list showing
   * everything, and a source that turns up later is shown without being asked.
   */
  hiddenKinds: NotificationKind[]
  hiddenSources: NotificationSource[]
}

export const emptyNotificationFilters: NotificationFilterState = {
  query: "",
  hiddenKinds: [],
  hiddenSources: [],
}

export function isFilteringNotifications(value: NotificationFilterState) {
  return Boolean(
    value.query.trim() ||
      value.hiddenKinds.length > 0 ||
      value.hiddenSources.length > 0
  )
}

/** Does one entry survive the filters? */
export function passesNotification(
  entry: Notification,
  value: NotificationFilterState
) {
  if (
    value.hiddenKinds.includes(entry.kind) ||
    value.hiddenSources.includes(entry.source)
  ) {
    return false
  }

  const query = value.query.trim().toLowerCase()

  if (!query) {
    return true
  }

  // Everything written down, not just the title: what somebody half-remembers
  // is usually an app or preset name, and those live in the other parts.
  return [
    entry.title,
    entry.description,
    entry.detail,
    notificationSourceLabels[entry.source],
    ...entry.fields.flatMap((field) => [field.label, field.value]),
    ...eventKeywords(entry.event),
  ]
    .filter(Boolean)
    .some((text) => (text as string).toLowerCase().includes(query))
}

function FilterGroupHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="px-1 pb-2 font-mono text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
      {children}
    </h2>
  )
}

/**
 * One switch: the square light is the toggle, lit when the option is shown.
 * "only" appears on hover, because going from everything to one is what a row
 * of switches is otherwise bad at.
 */
function FilterRow({
  label,
  count,
  active,
  alone,
  lit,
  onToggle,
  onOnly,
}: {
  label: string
  count: number
  active: boolean
  alone: boolean
  /** The light's colour when on. */
  lit: string
  onToggle: () => void
  onOnly: () => void
}) {
  return (
    <div className="group/filter flex items-center gap-2 px-1 py-1.5 text-xs">
      <button
        type="button"
        aria-pressed={active}
        aria-label={`Show ${label}`}
        onClick={onToggle}
        className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none"
      >
        <span
          aria-hidden
          className={cn(
            "size-1.5 shrink-0 transition-colors",
            active ? lit : "bg-muted-foreground opacity-30"
          )}
        />
        <span
          className={cn(
            "min-w-0 flex-1 truncate transition-colors",
            active ? "text-foreground" : "text-muted-foreground opacity-60"
          )}
        >
          {label}
        </span>
      </button>

      <button
        type="button"
        onClick={onOnly}
        disabled={alone}
        className={cn(
          "shrink-0 font-mono text-[9px] tracking-[0.12em] text-muted-foreground uppercase transition-opacity",
          "opacity-0 group-hover/filter:opacity-100 focus-visible:opacity-100",
          "hover:text-foreground disabled:pointer-events-none disabled:opacity-0"
        )}
      >
        only
      </button>

      <span className="w-6 shrink-0 text-right font-mono text-[10px] text-muted-foreground tabular-nums">
        {count}
      </span>
    </div>
  )
}

/**
 * The panel beside the log: search it, and narrow it by how things went and
 * where they happened. Counts come off the whole log, so an option with nothing
 * behind it reads zero rather than disappearing.
 */
export function NotificationFilters({
  value,
  entries,
  onChange,
  className,
}: {
  value: NotificationFilterState
  /** Every entry, unfiltered - the counts are worked out from these. */
  entries: readonly Notification[]
  onChange: (next: NotificationFilterState) => void
  className?: string
}) {
  const kindCounts = new Map<NotificationKind, number>()
  const sourceCounts = new Map<NotificationSource, number>()

  for (const entry of entries) {
    kindCounts.set(entry.kind, (kindCounts.get(entry.kind) ?? 0) + 1)
    sourceCounts.set(entry.source, (sourceCounts.get(entry.source) ?? 0) + 1)
  }

  // Only the sources that have said something, in the order they're declared.
  const sources = (
    Object.keys(notificationSourceLabels) as NotificationSource[]
  ).filter(
    (source) => sourceCounts.has(source) || value.hiddenSources.includes(source)
  )
  const filtering = isFilteringNotifications(value)

  const toggle = <T,>(list: T[], item: T) =>
    list.includes(item) ? list.filter((entry) => entry !== item) : [...list, item]

  return (
    <aside className={cn("flex h-full min-w-0 flex-col", className)}>
      {/* The clear button sits over the field rather than beside it, so the
          field doesn't resize as filters come and go. */}
      <div className="flex shrink-0 items-center border-b p-3">
        <div className="relative min-w-0 flex-1">
          <RiSearchLine
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 opacity-50"
          />
          <Input
            value={value.query}
            onChange={(event) => onChange({ ...value, query: event.target.value })}
            placeholder="Search notifications..."
            aria-label="Search notifications"
            className="pr-8 pl-8"
          />
          {filtering ? (
            <button
              type="button"
              title="Clear every filter"
              aria-label="Clear every filter"
              onClick={() => onChange(emptyNotificationFilters)}
              className="absolute top-1/2 right-1 z-10 flex size-6 -translate-y-1/2 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
            >
              <RiCloseLine className="size-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-4 p-3">
          <section>
            <FilterGroupHeading>Type</FilterGroupHeading>
            {notificationKinds.map((kind) => (
              <FilterRow
                key={kind}
                label={notificationKindStyle[kind].label}
                count={kindCounts.get(kind) ?? 0}
                active={!value.hiddenKinds.includes(kind)}
                alone={
                  value.hiddenKinds.length === notificationKinds.length - 1 &&
                  !value.hiddenKinds.includes(kind)
                }
                lit={notificationKindStyle[kind].dot}
                onToggle={() =>
                  onChange({ ...value, hiddenKinds: toggle(value.hiddenKinds, kind) })
                }
                onOnly={() =>
                  onChange({
                    ...value,
                    hiddenKinds: notificationKinds.filter((entry) => entry !== kind),
                  })
                }
              />
            ))}
          </section>

          {sources.length > 0 ? (
            <section>
              <FilterGroupHeading>Source</FilterGroupHeading>
              {sources.map((source) => (
                <FilterRow
                  key={source}
                  label={notificationSourceLabels[source]}
                  count={sourceCounts.get(source) ?? 0}
                  active={!value.hiddenSources.includes(source)}
                  alone={
                    value.hiddenSources.length === sources.length - 1 &&
                    !value.hiddenSources.includes(source)
                  }
                  lit="bg-foreground"
                  onToggle={() =>
                    onChange({
                      ...value,
                      hiddenSources: toggle(value.hiddenSources, source),
                    })
                  }
                  onOnly={() =>
                    onChange({
                      ...value,
                      hiddenSources: sources.filter((entry) => entry !== source),
                    })
                  }
                />
              ))}
            </section>
          ) : null}
        </div>
      </ScrollArea>
    </aside>
  )
}
