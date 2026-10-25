"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"

import {
  RiArrowDownSLine,
  RiArrowGoBackLine,
  RiDeleteBinLine,
  RiFileCopyLine,
  RiFilter3Line,
  RiInformationLine,
  RiNotification3Line,
} from "@remixicon/react"

import { notificationKindStyle } from "@/components/notification-kind"
import { useSettingsConfig } from "@/components/sections/settings/settings-config"
import { Button } from "@/components/ui/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import {
  clearNotifications,
  describeAge,
  describeTimestamp,
  getNotifications,
  markNotificationsRead,
  notificationIdentity,
  notificationSourceLabels,
  removeNotifications,
  undoNotification,
  useNotifications,
  type Notification,
} from "@/lib/notifications"
import { useSessionState } from "@/lib/session-state"
import { cn } from "@/lib/utils"

import { NotificationDetail, notificationText } from "./notification-detail"
import {
  emptyNotificationFilters,
  isFilteringNotifications,
  NotificationFilters,
  passesNotification,
  type NotificationFilterState,
} from "./notification-filters"

/** Below this width the filter panel moves into a sheet. */
const NARROW_WIDTH = 720

/** The current time, refreshed often enough for "4m ago" to stay true. */
function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])

  return now
}

function startOfDay(at: number) {
  const date = new Date(at)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function dayLabel(day: number, now: number) {
  const today = startOfDay(now)

  if (day === today) {
    return "Today"
  }

  if (day === startOfDay(today - 1)) {
    return "Yesterday"
  }

  return new Date(day).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  })
}

/** A row on the screen: one notification, or the same one several times in a row. */
type ListItem =
  | { type: "single"; entry: Notification }
  | { type: "group"; entries: Notification[] }

/**
 * Runs of the same message, newest first, folded into groups. Only runs: a
 * group never pulls an older notification up past newer, different ones.
 */
function groupRuns(entries: Notification[]): ListItem[] {
  const items: ListItem[] = []

  for (const entry of entries) {
    const last = items[items.length - 1]
    const lastEntry = last?.type === "group" ? last.entries[0] : last?.entry

    if (!last || !lastEntry || notificationIdentity(lastEntry) !== notificationIdentity(entry)) {
      items.push({ type: "single", entry })
    } else if (last.type === "group") {
      last.entries.push(entry)
    } else {
      items[items.length - 1] = { type: "group", entries: [last.entry, entry] }
    }
  }

  return items
}

/**
 * A group's identity while it's open: its oldest notification, which stays
 * put as newer ones join at the top.
 */
const groupId = (entries: Notification[]) => entries[entries.length - 1].id

function KindTile({
  entry,
  className,
}: {
  entry: Notification
  className?: string
}) {
  const { icon: Icon, tone } = notificationKindStyle[entry.kind]

  return (
    <span
      className={cn(
        "flex size-8 shrink-0 items-center justify-center border bg-muted",
        className
      )}
    >
      <Icon aria-hidden className={cn("size-4", tone)} />
    </span>
  )
}

function NewBadge() {
  return (
    <span className="shrink-0 bg-primary/15 px-1 font-mono text-[9px] tracking-widest text-primary uppercase">
      New
    </span>
  )
}

function NotificationRow({
  entry,
  now,
  isNew,
  nested = false,
  onView,
  onDelete,
  onClearAll,
}: {
  entry: Notification
  now: number
  /** Arrived since the screen was last looked at. */
  isNew: boolean
  /** One of a group's, listed under it while it's open. */
  nested?: boolean
  onView: () => void
  onDelete: () => void
  onClearAll: () => void
}) {
  const { label } = notificationKindStyle[entry.kind]

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <button
            type="button"
            onClick={onView}
            className={cn(
              "relative flex w-full items-start gap-3 border-b py-3 pr-4 text-left transition-colors hover:bg-muted/30 active:bg-muted/50 active:duration-0",
              // Indented so its tile sits under the group's title.
              nested ? "pl-15" : "pl-4"
            )}
          />
        }
      >
        {/* The same rule as a dependent setting, tying it to its group. */}
        {nested ? (
          <span aria-hidden className="absolute inset-y-3 left-8 w-px bg-border" />
        ) : null}

        <KindTile entry={entry} />

        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium">{entry.title}</span>
            {isNew ? <NewBadge /> : null}
          </span>
          {entry.description ? (
            <span className="truncate text-xs text-muted-foreground">
              {entry.description}
            </span>
          ) : null}
          <span className="mt-0.5 font-mono text-[10px] tracking-widest text-muted-foreground/80 uppercase">
            {notificationSourceLabels[entry.source]} · {label}
          </span>
        </span>

        <span
          className="shrink-0 pt-0.5 font-mono text-[10px] tracking-[0.04em] whitespace-nowrap text-muted-foreground uppercase"
          title={describeTimestamp(entry.at)}
        >
          {describeAge(entry.at, now)}
        </span>
      </ContextMenuTrigger>

      <ContextMenuContent className="w-52">
        <ContextMenuItem onClick={onView}>
          <RiInformationLine className="text-muted-foreground" /> View Details
        </ContextMenuItem>
        {entry.undo ? (
          <ContextMenuItem onClick={() => void undoNotification(entry.id)}>
            <RiArrowGoBackLine className="text-muted-foreground" /> Undo
          </ContextMenuItem>
        ) : null}
        {entry.actions.map((action) => (
          <ContextMenuItem key={action.label} onClick={action.onClick}>
            <span className="size-4" /> {action.label}
          </ContextMenuItem>
        ))}
        <ContextMenuItem
          onClick={() =>
            void navigator.clipboard.writeText(notificationText(entry, getNotifications()))
          }
        >
          <RiFileCopyLine className="text-muted-foreground" /> Copy Text
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onClick={onDelete}>
          <RiDeleteBinLine /> Delete
        </ContextMenuItem>
        <ContextMenuItem variant="destructive" onClick={onClearAll}>
          <RiDeleteBinLine /> Clear All…
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

/**
 * The same notification several times in a row, as one row: the latest one,
 * with how many times it came. Clicking it opens the list of each one.
 */
function NotificationGroupRow({
  entries,
  now,
  open,
  isNew,
  onToggle,
  onViewLatest,
  onDeleteAll,
  onClearAll,
}: {
  /** Newest first. */
  entries: Notification[]
  now: number
  open: boolean
  /** Any of them arrived since the screen was last looked at. */
  isNew: boolean
  onToggle: () => void
  onViewLatest: () => void
  onDeleteAll: () => void
  onClearAll: () => void
}) {
  const latest = entries[0]
  const { label } = notificationKindStyle[latest.kind]

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <button
            type="button"
            aria-expanded={open}
            onClick={onToggle}
            className="flex w-full items-start gap-3 border-b px-4 py-3 text-left transition-colors hover:bg-muted/30 active:bg-muted/50 active:duration-0"
          />
        }
      >
        <KindTile entry={latest} />

        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium">{latest.title}</span>
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
              ×{entries.length}
            </span>
            {isNew ? <NewBadge /> : null}
          </span>
          {latest.description ? (
            <span className="truncate text-xs text-muted-foreground">
              {latest.description}
            </span>
          ) : null}
          <span className="mt-0.5 font-mono text-[10px] tracking-widest text-muted-foreground/80 uppercase">
            {notificationSourceLabels[latest.source]} · {label}
          </span>
        </span>

        <span className="flex shrink-0 items-center gap-2 pt-0.5">
          <span
            className="font-mono text-[10px] tracking-[0.04em] whitespace-nowrap text-muted-foreground uppercase"
            title={describeTimestamp(latest.at)}
          >
            {describeAge(latest.at, now)}
          </span>
          <RiArrowDownSLine
            aria-hidden
            className={cn(
              "-my-0.5 size-4 text-muted-foreground transition-transform duration-200",
              open && "rotate-180"
            )}
          />
        </span>
      </ContextMenuTrigger>

      <ContextMenuContent className="w-52">
        <ContextMenuItem onClick={onToggle}>
          <RiArrowDownSLine
            className={cn("text-muted-foreground transition-transform", open && "rotate-180")}
          />
          {open ? "Hide Each One" : `Show All ${entries.length}`}
        </ContextMenuItem>
        <ContextMenuItem onClick={onViewLatest}>
          <RiInformationLine className="text-muted-foreground" /> View Latest
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onClick={onDeleteAll}>
          <RiDeleteBinLine /> Delete All {entries.length}
        </ContextMenuItem>
        <ContextMenuItem variant="destructive" onClick={onClearAll}>
          <RiDeleteBinLine /> Clear All…
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

/**
 * Everything the app has said, newest first, grouped by day. The title bar
 * shows each message for a few seconds; this is where it can be read later, in
 * full, with whatever detail there was no room for up there.
 */
export default function NotificationsSection() {
  const entries = useNotifications()
  const now = useNow()
  const rootRef = useRef<HTMLDivElement | null>(null)

  const [narrow, setNarrow] = useState(false)
  // The filters, the switch below and which groups are open are kept while
  // Volcon is open, so going to another screen and back finds them as left.
  const [filters, setFilters] = useSessionState<NotificationFilterState>(
    "notifications.filters",
    emptyNotificationFilters
  )
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [viewingId, setViewingId] = useState<number | null>(null)

  // Settings says whether repeats start grouped; the switch here overrides it
  // until Volcon closes - unless Settings changes it in the meantime, which is
  // the newer word on the matter.
  const { groupRepeats } = useSettingsConfig().notifications
  const [groupingHere, setGroupingHere] = useSessionState<{
    on: boolean
    /** What Settings said when the switch was flipped. */
    over: boolean
  } | null>("notifications.grouping", null)
  const grouping = groupingHere && groupingHere.over === groupRepeats ? groupingHere.on : groupRepeats
  const [openGroups, setOpenGroups] = useSessionState<number[]>("notifications.openGroups", [])

  const toggleGroup = (id: number) => {
    setOpenGroups((current) =>
      current.includes(id) ? current.filter((open) => open !== id) : [...current, id]
    )
  }

  // What was unread when it reached this screen, kept for as long as the
  // screen is open: looking marks everything read straight away, but it's
  // still worth showing which ones are new.
  const [fresh, setFresh] = useState<ReadonlySet<number>>(() => new Set())
  const unreadIds = entries
    .filter((entry) => !entry.read)
    .map((entry) => entry.id)

  if (unreadIds.some((id) => !fresh.has(id))) {
    setFresh(new Set([...fresh, ...unreadIds]))
  }

  useEffect(() => {
    markNotificationsRead()
  }, [entries])

  useEffect(() => {
    const element = rootRef.current

    if (!element) {
      return
    }

    const update = () =>
      setNarrow(element.getBoundingClientRect().width < NARROW_WIDTH)
    update()

    const observer = new ResizeObserver(update)
    observer.observe(element)

    return () => observer.disconnect()
  }, [])

  const shown = useMemo(
    () => entries.filter((entry) => passesNotification(entry, filters)),
    [entries, filters]
  )
  const filtering = isFilteringNotifications(filters)

  const groups = useMemo(() => {
    const byDay: Array<{ day: number; entries: Notification[] }> = []

    for (const entry of shown) {
      const day = startOfDay(entry.at)
      const last = byDay[byDay.length - 1]

      if (last?.day === day) {
        last.entries.push(entry)
      } else {
        byDay.push({ day, entries: [entry] })
      }
    }

    return byDay.map((group) => ({
      ...group,
      items: grouping
        ? groupRuns(group.entries)
        : group.entries.map((entry): ListItem => ({ type: "single", entry })),
    }))
  }, [grouping, shown])

  // Kept while the sheet closes, so its contents don't vanish mid-animation.
  const viewing = entries.find((entry) => entry.id === viewingId) ?? null
  const [lastViewed, setLastViewed] = useState<Notification | null>(null)

  if (viewing && viewing !== lastViewed) {
    setLastViewed(viewing)
  }

  const clearTargets = filtering ? shown : entries

  const clear = () => {
    if (filtering) {
      removeNotifications(shown.map((entry) => entry.id))
    } else {
      clearNotifications()
    }

    setConfirmClear(false)
  }

  const filterPanel = (
    <NotificationFilters
      value={filters}
      entries={entries}
      onChange={setFilters}
    />
  )

  return (
    <div ref={rootRef} className="flex h-full min-h-0 overflow-hidden">
      {!narrow ? (
        <div className="w-64 shrink-0 border-r bg-muted/20">{filterPanel}</div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* One row, one height: the counts are always rendered and only fade,
            so nothing below moves while it's being read. */}
        <div className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
          <div className="flex min-w-0 items-baseline gap-2">
            <h1 className="font-mono text-xs font-semibold tracking-widest uppercase">
              Notifications
            </h1>
            <span
              className={cn(
                "font-mono text-[10px] text-muted-foreground tabular-nums transition-opacity",
                !filtering && "opacity-0"
              )}
            >
              {shown.length} of {entries.length} shown
            </span>
          </div>

          <div className="ml-auto flex items-center gap-1">
            {/* Until Volcon closes; Settings has the one it starts from. */}
            <label
              className="mr-1 flex cursor-pointer items-center gap-2 px-2 text-xs text-muted-foreground select-none"
              title="Show the same notification several times in a row as one entry"
            >
              <Switch
                size="sm"
                checked={grouping}
                onCheckedChange={(on) => setGroupingHere({ on, over: groupRepeats })}
              />
              Group
            </label>
            {narrow ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setFiltersOpen(true)}
              >
                <RiFilter3Line />
                Filters
                {filtering ? (
                  <span aria-hidden className="ml-0.5 size-1.5 bg-primary" />
                ) : null}
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              disabled={clearTargets.length === 0}
              onClick={() => setConfirmClear(true)}
            >
              <RiDeleteBinLine />
              {filtering ? "Clear shown" : "Clear all"}
            </Button>
          </div>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          {entries.length === 0 ? (
            <Empty className="h-full py-16">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <RiNotification3Line />
                </EmptyMedia>
                <EmptyTitle>Nothing to report</EmptyTitle>
                <EmptyDescription>
                  Messages shown in the title bar are kept here, so anything
                  that went past while you were busy can still be read.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : shown.length === 0 ? (
            <Empty className="h-full py-16">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <RiFilter3Line />
                </EmptyMedia>
                <EmptyTitle>Nothing matches</EmptyTitle>
                <EmptyDescription>
                  No notification matches these filters.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button
                  variant="outline"
                  onClick={() => setFilters(emptyNotificationFilters)}
                >
                  Clear filters
                </Button>
              </EmptyContent>
            </Empty>
          ) : (
            groups.map((group) => (
              <section key={group.day}>
                {/* Stuck to the top while its day scrolls past, so a row half
                    way down still says which day it's from. */}
                <h2 className="sticky top-0 z-10 flex items-center justify-between border-b bg-background/95 px-4 py-1.5 font-mono text-[10px] tracking-widest text-muted-foreground uppercase backdrop-blur">
                  <span>{dayLabel(group.day, now)}</span>
                  <span className="tabular-nums">{group.entries.length}</span>
                </h2>
                {group.items.map((item) => {
                  if (item.type === "single") {
                    return (
                      <NotificationRow
                        key={item.entry.id}
                        entry={item.entry}
                        now={now}
                        isNew={fresh.has(item.entry.id)}
                        onView={() => setViewingId(item.entry.id)}
                        onDelete={() => removeNotifications([item.entry.id])}
                        onClearAll={() => setConfirmClear(true)}
                      />
                    )
                  }

                  const id = groupId(item.entries)
                  const open = openGroups.includes(id)

                  return (
                    <div key={`group-${id}`}>
                      <NotificationGroupRow
                        entries={item.entries}
                        now={now}
                        open={open}
                        isNew={item.entries.some((entry) => fresh.has(entry.id))}
                        onToggle={() => toggleGroup(id)}
                        onViewLatest={() => setViewingId(item.entries[0].id)}
                        onDeleteAll={() =>
                          removeNotifications(item.entries.map((entry) => entry.id))
                        }
                        onClearAll={() => setConfirmClear(true)}
                      />
                      <AnimatePresence initial={false}>
                        {open ? (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.18, ease: "easeOut" }}
                            className="overflow-hidden"
                          >
                            {item.entries.map((entry) => (
                              <NotificationRow
                                key={entry.id}
                                entry={entry}
                                now={now}
                                nested
                                isNew={fresh.has(entry.id)}
                                onView={() => setViewingId(entry.id)}
                                onDelete={() => removeNotifications([entry.id])}
                                onClearAll={() => setConfirmClear(true)}
                              />
                            ))}
                          </motion.div>
                        ) : null}
                      </AnimatePresence>
                    </div>
                  )
                })}
              </section>
            ))
          )}
        </ScrollArea>
      </div>

      {/* One sheet for whichever row is open, rather than one per row. */}
      <Sheet
        open={viewing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setViewingId(null)
          }
        }}
      >
        {lastViewed ? (
          <NotificationDetail
            entry={lastViewed}
            log={entries}
            now={now}
            onDelete={() => {
              removeNotifications([lastViewed.id])
              setViewingId(null)
            }}
            onView={setViewingId}
          />
        ) : null}
      </Sheet>

      <Sheet open={narrow && filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent side="left" className="gap-0 p-0" showCloseButton={false}>
          <SheetHeader className="sr-only">
            <SheetTitle>Filters</SheetTitle>
            <SheetDescription>
              Narrow the log by type and source.
            </SheetDescription>
          </SheetHeader>
          {filterPanel}
        </SheetContent>
      </Sheet>

      <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {filtering
                ? "Clear the shown notifications?"
                : "Clear all notifications?"}
            </DialogTitle>
            <DialogDescription>
              {filtering
                ? `This removes the ${clearTargets.length} notification${clearTargets.length === 1 ? "" : "s"} matching your filters. The rest are kept.`
                : `This removes all ${entries.length} notification${entries.length === 1 ? "" : "s"} from the log. It can't be undone.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmClear(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={clear}>
              {filtering ? "Clear shown" : "Clear all"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
