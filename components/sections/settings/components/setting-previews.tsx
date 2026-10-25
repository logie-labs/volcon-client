"use client"

import { useEffect, useState, type ComponentType, type ReactNode } from "react"
import { AnimatePresence, motion } from "motion/react"
import {
  RiArrowDownSLine,
  RiCheckLine,
  RiCursorFill,
  RiEqualizer3Line,
  RiErrorWarningLine,
  RiFireLine,
  RiMusic2Fill,
  RiNotification3Line,
  RiQuestionLine,
  RiSettings3Line,
} from "@remixicon/react"

import Counter from "@/components/Counter"
import { SCALE_COLOURS } from "@/components/level-meter"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { VolumeNumber } from "@/components/volume-number"
import { cn } from "@/lib/utils"

import { useSettings } from "../settings-context"

/*
 * Small moving pictures of what a setting does, behind a ? beside its name.
 * Each draws a miniature of the part of the app the setting changes - the
 * title bar, the sidebar, an app's row - and, for a switch, shows it both ways
 * with the one it's set to now marked. They only run while they're open.
 */

/** A count that goes up every `ms` while the preview is open, to drive its loop. */
function useTick(ms: number) {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const id = window.setInterval(() => setTick((current) => current + 1), ms)
    return () => window.clearInterval(id)
  }, [ms])

  return tick
}

/** A knob being turned up and back down, as a figure, for previews that show one changing. */
function turning(tick: number) {
  const step = tick % 56

  if (step < 20) {
    return 20 + step * 3
  }

  if (step < 28) {
    return 80
  }

  if (step < 48) {
    return 80 - (step - 28) * 3
  }

  return 20
}

/** The ways a setting can be, side by side - or stacked, for wide pictures. */
function Variants({ stacked = false, children }: { stacked?: boolean; children: ReactNode }) {
  return <div className={cn("flex gap-2", stacked && "flex-col")}>{children}</div>
}

/** One way a setting can be, marked if it's how it's set now. */
function Variant({
  label,
  current,
  note,
  children,
}: {
  label: string
  current: boolean
  note: string
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 flex-col gap-2 border p-2",
        current ? "border-primary/50 bg-primary/5" : "bg-muted/20"
      )}
    >
      <div className="flex items-center justify-between font-mono text-[9px] tracking-[0.2em] uppercase">
        <span className={current ? "text-primary" : "text-muted-foreground"}>{label}</span>
        {current ? <span className="text-primary">Now</span> : null}
      </div>
      {children}
      <p className="text-[10px] leading-snug text-muted-foreground">{note}</p>
    </div>
  )
}

/** The app's title bar, in miniature: the flame, the screen's name, the window buttons. */
function MiniTitleBar({ middle, over }: { middle?: ReactNode; over?: ReactNode }) {
  return (
    <div className="relative flex h-7 items-center gap-1.5 overflow-hidden border bg-background px-2">
      <RiFireLine aria-hidden className="size-3 shrink-0 text-muted-foreground" />
      <span className="font-mono text-[8px] tracking-[0.15em] text-muted-foreground uppercase">Mapping</span>
      <span aria-hidden className="ml-auto flex gap-1.5">
        {[0, 1, 2].map((button) => (
          <span key={button} className="size-1.5 bg-muted-foreground/40" />
        ))}
      </span>
      {middle ? (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">{middle}</span>
      ) : null}
      {over}
    </div>
  )
}

/** The app's sidebar, in miniature, with the bell's unread dot when there is one. */
function MiniSidebar({ dot = false, lit }: { dot?: boolean; lit?: "bell" }) {
  return (
    <div className="flex h-24 w-9 shrink-0 flex-col items-center justify-between border bg-muted/30 py-1.5">
      <RiEqualizer3Line aria-hidden className="size-3.5 text-foreground" />
      <div className="flex flex-col items-center gap-2">
        <span className="relative">
          <RiNotification3Line
            aria-hidden
            className={cn("size-3.5 transition-opacity", lit === "bell" ? "opacity-100" : "opacity-50")}
          />
          <AnimatePresence>
            {dot ? (
              <motion.span
                key="dot"
                className="absolute -top-0.5 -right-0.5 size-1.5 bg-primary"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                transition={{ duration: 0.18 }}
              />
            ) : null}
          </AnimatePresence>
        </span>
        <RiSettings3Line aria-hidden className="size-3.5 opacity-50" />
      </div>
    </div>
  )
}

function AnimatedNumbersPreview() {
  const on = useSettings().config.appearance.animatedNumbers
  const value = turning(useTick(100))

  const figure = (children: ReactNode) => (
    <div className="flex h-10 items-start justify-center gap-0.5 leading-none">
      <span className="text-3xl tabular-nums">{children}</span>
      <span className="pt-0.5 text-xs text-muted-foreground">%</span>
    </div>
  )

  return (
    <Variants>
      <Variant label="On" current={on} note="Each figure rolls to its new value.">
        {/* Rolling whatever the setting says: this is what On looks like. */}
        {figure(
          <Counter
            value={value}
            duration={0.1}
            bounce={0.2}
            stagger={0.01}
            intro={false}
            fontSize="inherit"
          />
        )}
      </Variant>
      <Variant label="Off" current={!on} note="It simply changes.">
        {figure(value)}
      </Variant>
    </Variants>
  )
}

function ToolbarReadoutPreview() {
  const on = useSettings().config.appearance.toolbarReadout
  const level = turning(useTick(100))

  return (
    <Variants stacked>
      <Variant label="On" current={on} note="On a mapping's own screen, its name and level sit in the middle.">
        <MiniTitleBar
          middle={
            <span className="flex items-center gap-1 font-heading text-[9px] font-semibold tracking-[0.06em] uppercase">
              <span className="text-muted-foreground">Music</span>
              <span aria-hidden className="size-0.5 bg-muted-foreground/60" />
              <VolumeNumber value={level} className="text-[10px] tabular-nums" />
              <span className="text-muted-foreground">%</span>
            </span>
          }
        />
      </Variant>
      <Variant label="Off" current={!on} note="The title bar stays clear.">
        <MiniTitleBar />
      </Variant>
    </Variants>
  )
}

/** Left and right, bouncing as if something's playing, drawn like the real meters. */
function PlayingMeters() {
  const heights = [
    ["35%", "70%", "50%", "85%", "40%", "65%", "35%"],
    ["30%", "60%", "78%", "45%", "82%", "50%", "30%"],
  ]

  return (
    <span aria-hidden className="flex h-8 shrink-0 gap-0.75">
      {heights.map((frames, channel) => (
        <span key={channel} className="relative w-1 overflow-hidden bg-muted">
          <motion.span
            className="absolute inset-x-0 bottom-0"
            style={{
              background: `linear-gradient(to top, ${SCALE_COLOURS})`,
              backgroundSize: "100% 2rem",
              backgroundPosition: "bottom",
            }}
            animate={{ height: frames }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
          />
        </span>
      ))}
    </span>
  )
}

/** An assigned app's row, in miniature. */
function MiniAppRow({ meters }: { meters: boolean }) {
  return (
    <div className="flex items-center gap-2 border bg-card px-2 py-1.5">
      <span className="flex size-6 shrink-0 items-center justify-center border bg-muted">
        <RiMusic2Fill aria-hidden className="size-3.5 text-primary" />
      </span>
      <span className="min-w-0 flex-1 truncate text-[11px] font-medium">Spotify</span>
      <span className="flex items-baseline gap-0.5 leading-none">
        <span className="text-sm tabular-nums">40</span>
        <span className="text-[9px] text-muted-foreground">%</span>
      </span>
      {meters ? <PlayingMeters /> : null}
    </div>
  )
}

function LevelMetersPreview() {
  const on = useSettings().config.mapping.levelMeters

  return (
    <Variants stacked>
      <Variant label="On" current={on} note="Live left and right levels beside each app's volume.">
        <MiniAppRow meters />
      </Variant>
      <Variant label="Off" current={!on} note="Just the volume.">
        <MiniAppRow meters={false} />
      </Variant>
    </Variants>
  )
}

function TitleBarNotificationsPreview() {
  const on = useSettings().config.notifications.titleBar
  const showing = useTick(1700) % 2 === 1

  return (
    <Variants stacked>
      <Variant label="On" current={on} note="A line over the title for a few seconds, then it's gone.">
        <MiniTitleBar
          over={
            <AnimatePresence>
              {showing ? (
                <motion.span
                  key="line"
                  className="absolute inset-0 flex items-center gap-1.5 bg-[color-mix(in_oklab,var(--background)_94%,var(--foreground)_6%)] px-2"
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                >
                  <RiCheckLine aria-hidden className="size-3 shrink-0 text-primary" />
                  <span className="truncate text-[9px]">
                    Mock MIDI connected
                    <span className="text-muted-foreground"> · Its controls are live again.</span>
                  </span>
                </motion.span>
              ) : null}
            </AnimatePresence>
          }
        />
      </Variant>
      <Variant label="Off" current={!on} note="Nothing in the title bar; it's still on the Notifications screen.">
        <MiniTitleBar />
      </Variant>
    </Variants>
  )
}

function UnreadBadgePreview() {
  const on = useSettings().config.notifications.unreadBadge
  // Something arrives, waits, and is read when the screen is opened.
  const phase = useTick(900) % 4
  const waiting = phase === 1 || phase === 2

  return (
    <Variants>
      <Variant label="On" current={on} note="A dot on the bell when something arrives while you're elsewhere.">
        <div className="flex justify-center">
          <MiniSidebar dot={waiting} />
        </div>
      </Variant>
      <Variant label="Off" current={!on} note="No dot; it's still on the Notifications screen.">
        <div className="flex justify-center">
          <MiniSidebar />
        </div>
      </Variant>
    </Variants>
  )
}

/** A notification's row, in miniature. */
function MiniNotification({
  time,
  count,
  open,
  nested = false,
}: {
  time: string
  count?: number
  open?: boolean
  nested?: boolean
}) {
  return (
    <div className={cn("flex items-center gap-1.5 border-b py-1 pr-1.5 last:border-b-0", nested ? "pl-4" : "pl-1.5")}>
      <RiErrorWarningLine aria-hidden className="size-2.5 shrink-0 text-amber-500" />
      <span className="min-w-0 flex-1 truncate text-[9px]">Mock MIDI disconnected</span>
      {count ? <span className="font-mono text-[8px] text-muted-foreground">×{count}</span> : null}
      <span className="shrink-0 font-mono text-[7px] text-muted-foreground uppercase">{time}</span>
      {count ? (
        <RiArrowDownSLine
          aria-hidden
          className={cn("size-2.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
        />
      ) : null}
    </div>
  )
}

function GroupRepeatsPreview() {
  const on = useSettings().config.notifications.groupRepeats
  const open = useTick(1600) % 2 === 1
  const times = ["now", "1m", "2m"]

  // Stacked, so each list has the card's full width for its rows.
  return (
    <Variants stacked>
      <Variant label="On" current={on} note="One entry with a count, which opens to list each.">
        {/* Tall enough for it opened, so the card doesn't grow and shrink. */}
        <div className="h-24">
          <div className="border bg-card">
            <MiniNotification time="now" count={3} open={open} />
            <AnimatePresence initial={false}>
              {open ? (
                <motion.div
                  key="each"
                  className="overflow-hidden"
                  initial={{ height: 0 }}
                  animate={{ height: "auto" }}
                  exit={{ height: 0 }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                >
                  {times.map((time) => (
                    <MiniNotification key={time} time={time} nested />
                  ))}
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </div>
      </Variant>
      <Variant label="Off" current={!on} note="Each time is its own entry.">
        <div className="border bg-card">
          {times.map((time) => (
            <MiniNotification key={time} time={time} />
          ))}
        </div>
      </Variant>
    </Variants>
  )
}

/** The highest position a control reports, as the backend counts it. */
const MAX_POSITION = 127

/**
 * How long a control has to go without covering a deadzone's width before it
 * counts as at rest - `SETTLE_AFTER` in the backend's deadzone filter.
 */
const SETTLE_AFTER_MS = 750

type FilterState = {
  /** The last position let through. */
  resting: number
  /** Where the current movement last covered a deadzone's width, and when. */
  anchor: number
  anchoredAt: number
}

/**
 * The backend's deadzone filter, step for step (`DeadzoneFilter::admit_at`):
 * a moving control gets every step, and keeps moving for as long as it covers
 * a deadzone's width every so often; a settled one has to clear the deadzone
 * from the last position let through, though the very ends always get through.
 */
function admit(state: FilterState | null, value: number, now: number, percent: number) {
  const clears = (from: number) => Math.abs(from - value) * 100 >= percent * MAX_POSITION

  if (!state) {
    return { admitted: true, state: { resting: value, anchor: value, anchoredAt: now } }
  }

  if (now - state.anchoredAt < SETTLE_AFTER_MS) {
    return {
      admitted: true,
      state: clears(state.anchor)
        ? { resting: value, anchor: value, anchoredAt: now }
        : { ...state, resting: value },
    }
  }

  const reachesEnd = value !== state.resting && (value === 0 || value === MAX_POSITION)

  if (!clears(state.resting) && !reachesEnd) {
    return { admitted: false, state }
  }

  return { admitted: true, state: { resting: value, anchor: value, anchoredAt: now } }
}

/** Where the pretend fader rests, low and high, in steps: about 40% and 72%. */
const LOW = 51
const HIGH = 92
/** One pass of the loop: rest, a move up, rest, a move down, rest. */
const LOOP_MS = 7600

/** A fader left alone never sits quite still: it wanders a step or two either way. */
function wobble(seconds: number) {
  return 2 * Math.sin(seconds * 11) * Math.sin(seconds * 2.7)
}

const ease = (progress: number) => (1 - Math.cos(Math.PI * progress)) / 2

/** The pretend fader's position, in whole steps, at a moment in the loop. */
function faderAt(seconds: number) {
  const at =
    seconds < 2.4
      ? LOW + wobble(seconds)
      : seconds < 3.2
        ? LOW + (HIGH - LOW) * ease((seconds - 2.4) / 0.8)
        : seconds < 5.6
          ? HIGH + wobble(seconds)
          : seconds < 6.4
            ? HIGH - (HIGH - LOW) * ease((seconds - 5.6) / 0.8)
            : LOW + wobble(seconds)

  return Math.max(0, Math.min(MAX_POSITION, Math.round(at)))
}

const percentOf = (steps: number) => (steps / MAX_POSITION) * 100

function DeadzonePreview() {
  const deadzone = useSettings().config.controller.deadzone
  const [reading, setReading] = useState({
    fader: LOW,
    level: LOW,
    resting: LOW,
    settled: 1,
    held: false,
  })

  useEffect(() => {
    const started = performance.now()
    // The control starts out at rest, as one left alone would be.
    let state: FilterState | null = {
      resting: LOW,
      anchor: LOW,
      anchoredAt: started - SETTLE_AFTER_MS,
    }
    let level = LOW
    let sent: number | null = null
    let held = false

    const id = window.setInterval(() => {
      const now = performance.now()
      const fader = faderAt(((now - started) % LOOP_MS) / 1000)

      // A controller only says anything when the position changes.
      if (fader !== sent) {
        sent = fader
        const result = admit(state, fader, now, deadzone)
        state = result.state
        held = !result.admitted

        if (result.admitted) {
          level = fader
        }
      }

      setReading({
        fader,
        level,
        resting: state?.resting ?? fader,
        settled: Math.min(1, (now - (state?.anchoredAt ?? now)) / SETTLE_AFTER_MS),
        held,
      })
    }, 25)

    return () => window.clearInterval(id)
  }, [deadzone])

  const atRest = reading.settled >= 1
  const track = (children: ReactNode) => <div className="relative h-1.5 bg-muted">{children}</div>

  return (
    <div className="flex flex-col gap-3 border bg-muted/20 p-2.5">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between font-mono text-[9px] tracking-[0.2em] text-muted-foreground uppercase">
          <span>Fader</span>
          <span className={cn("tracking-normal normal-case", reading.held && "text-amber-600 dark:text-amber-400")}>
            {reading.held ? "ignored" : "let through"}
          </span>
        </div>
        {track(
          <>
            {/* At rest, how far it can wander from the last position let
                through without counting. Moving, there's no band at all. */}
            {deadzone > 0 && atRest ? (
              <span
                className="absolute -inset-y-1 border-x border-amber-500/60 bg-amber-500/15"
                style={{
                  left: `${Math.max(0, percentOf(reading.resting) - deadzone)}%`,
                  width: `${Math.min(100, percentOf(reading.resting) + deadzone) - Math.max(0, percentOf(reading.resting) - deadzone)}%`,
                }}
              />
            ) : null}
            <span
              className={cn(
                "absolute -top-1 h-3.5 w-1 -translate-x-1/2",
                reading.held ? "bg-amber-500" : "bg-foreground"
              )}
              style={{ left: `${percentOf(reading.fader)}%` }}
            />
          </>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between font-mono text-[9px] tracking-[0.2em] text-muted-foreground uppercase">
          <span>Level</span>
          <span className="text-xs tracking-normal text-foreground tabular-nums">
            {Math.round(percentOf(reading.level))}%
          </span>
        </div>
        {track(<span className="absolute inset-y-0 left-0 bg-primary" style={{ width: `${percentOf(reading.level)}%` }} />)}
      </div>

      {/* Whether the control counts as moving, and how close it is to settling. */}
      <div className="flex items-center gap-2">
        <span className="relative h-0.5 w-10 shrink-0 bg-muted">
          <span className="absolute inset-y-0 left-0 bg-muted-foreground" style={{ width: `${reading.settled * 100}%` }} />
        </span>
        <span className="text-[10px] text-muted-foreground">
          {deadzone === 0
            ? "Every step counts."
            : atRest
              ? "At rest: wobble inside the band is ignored."
              : "Moving: every step gets through."}
        </span>
      </div>

      <p className="text-[10px] leading-snug text-muted-foreground">
        {deadzone === 0
          ? "Off: a resting fader's wobble reaches the level, every step of it."
          : `At ${deadzone}%: once a control has stopped moving for ¾ of a second, it has to move more than ${deadzone}% from the last level let through to count. While it's moving, nothing is held back, and the very top and bottom always get through.`}
      </p>
    </div>
  )
}

function SidebarTooltipsPreview() {
  const on = useSettings().config.appearance.sidebarTooltips
  const hovering = useTick(1300) % 2 === 1

  // The pointer comes in from the side and rests on the bell.
  const panel = (tooltip: boolean) => (
    <div className="relative h-24">
      <MiniSidebar lit={hovering ? "bell" : undefined} />
      <motion.span
        aria-hidden
        className="absolute top-0 left-0"
        animate={hovering ? { x: 18, y: 58 } : { x: 64, y: 84 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
      >
        <RiCursorFill className="size-3.5 text-foreground drop-shadow" />
      </motion.span>
      <AnimatePresence>
        {tooltip && hovering ? (
          <motion.span
            key="tooltip"
            className="absolute top-[3.15rem] left-11 border bg-popover px-1.5 py-0.5 text-[9px] whitespace-nowrap shadow-sm"
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0, transition: { delay: 0.35, duration: 0.15 } }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
          >
            Notifications
          </motion.span>
        ) : null}
      </AnimatePresence>
    </div>
  )

  return (
    <Variants>
      <Variant label="On" current={on} note="The screen's name appears beside its button.">
        {panel(true)}
      </Variant>
      <Variant label="Off" current={!on} note="Just the icons.">
        {panel(false)}
      </Variant>
    </Variants>
  )
}

/** The settings with a picture of what they do, by id. */
const settingPreviews: Partial<Record<string, ComponentType>> = {
  "appearance.animatedNumbers": AnimatedNumbersPreview,
  "appearance.sidebarTooltips": SidebarTooltipsPreview,
  "appearance.toolbarReadout": ToolbarReadoutPreview,
  "mapping.levelMeters": LevelMetersPreview,
  "notifications.titleBar": TitleBarNotificationsPreview,
  "notifications.unreadBadge": UnreadBadgePreview,
  "notifications.groupRepeats": GroupRepeatsPreview,
  "controller.deadzone": DeadzonePreview,
}

/**
 * The ? beside a setting's name, for a setting with a preview. Pointing at it,
 * or reaching it from the keyboard, shows what the setting does. Draws nothing
 * for a setting without one, so any row can ask.
 */
export function SettingPreviewHint({ id, label }: { id: string; label: string }) {
  const Preview = settingPreviews[id]

  if (!Preview) {
    return null
  }

  return (
    <HoverCard>
      <HoverCardTrigger
        delay={150}
        closeDelay={100}
        render={
          <button
            type="button"
            aria-label={`What ${label} does`}
            className="flex size-4 shrink-0 items-center justify-center text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        }
      >
        <RiQuestionLine aria-hidden className="size-3.5" />
      </HoverCardTrigger>
      <HoverCardContent side="bottom" align="start" className="flex w-80 flex-col gap-2.5 p-3">
        <p className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">{label}</p>
        <Preview />
      </HoverCardContent>
    </HoverCard>
  )
}
