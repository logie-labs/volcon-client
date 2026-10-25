"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import {
  RiDraggable,
  RiExternalLinkLine,
  RiFeedbackLine,
  RiFileCopyLine,
  RiHeartLine,
  RiKeyboardLine,
  RiMouseLine,
} from "@remixicon/react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { ScrollArea } from "@/components/ui/scroll-area"
import { getDiagnosticsInfo, listInputs, openExternal } from "@/lib/bridge-client"
import { buildInfo, describeBuildTime, describeCommit } from "@/lib/build-info"
import { getNotifications, toast } from "@/lib/notifications"
import { bugReportUrl } from "@/lib/project"
import { appVersion } from "@/lib/version"

import { useSettings } from "../settings-context"
import { webViewVersion } from "./settings-diagnostics"

/** Opens a link in the browser, saying so - with the link to copy - if that doesn't work. */
function openLink(url: string, attempted: string) {
  void openExternal(url).catch((error: unknown) => {
    const reason = error instanceof Error ? error.message : String(error)

    toast.error("Couldn't open the link", {
      source: "settings",
      detail: reason,
      event: {
        type: "action-failed",
        attempted,
        reason,
        hint: "Copy the link and paste it into your browser instead.",
        target: { kind: "url", value: url },
      },
    })
  })
}

/** A heading over a part of a dialog's list. */
function ListHeading({ children }: { children: ReactNode }) {
  return (
    <h3 className="px-0.5 font-mono text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
      {children}
    </h3>
  )
}

/** A dialog's list, scrolling within the dialog once it's longer than the window allows. */
function DialogList({ children }: { children: ReactNode }) {
  return (
    <ScrollArea className="-mx-1 *:data-[slot=scroll-area-viewport]:max-h-[min(60vh,32rem)]">
      <div className="flex flex-col gap-4 px-1">{children}</div>
    </ScrollArea>
  )
}

type Shortcut = {
  keys: ReactNode
  does: string
  /** Turned off in Settings, which is worth saying beside it. */
  off?: boolean
}

function ShortcutList({ title, shortcuts }: { title: string; shortcuts: Shortcut[] }) {
  return (
    <section className="flex flex-col gap-1.5">
      <ListHeading>{title}</ListHeading>
      <div className="flex flex-col border">
        {shortcuts.map((shortcut) => (
          <div
            key={shortcut.does}
            className="flex items-center justify-between gap-4 border-b px-3 py-2 last:border-b-0"
          >
            <span className={shortcut.off ? "text-sm text-muted-foreground" : "text-sm"}>
              {shortcut.does}
              {shortcut.off ? (
                <span className="ml-2 font-mono text-[9px] tracking-widest text-amber-600 uppercase dark:text-amber-400">
                  Off in Navigation
                </span>
              ) : null}
            </span>
            <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
              {shortcut.keys}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

/** Two shortcuts that do the same thing, either way round. */
function Or({ children }: { children: [ReactNode, ReactNode] }) {
  return (
    <>
      {children[0]}
      <span>or</span>
      {children[1]}
    </>
  )
}

/** Every shortcut Volcon has, behind one button on the About page. */
export function ShortcutsDialog() {
  const { altArrows, mouseButtons } = useSettings().config.navigation

  const anywhere: Shortcut[] = [
    {
      keys: (
        <KbdGroup>
          <Kbd>Ctrl</Kbd>
          <Kbd>Alt</Kbd>
        </KbdGroup>
      ),
      does: "Open or close the command menu",
    },
    {
      keys: (
        <Or>
          {[
            <KbdGroup key="back">
              <Kbd>Alt</Kbd>
              <Kbd>←</Kbd>
            </KbdGroup>,
            <KbdGroup key="forward">
              <Kbd>Alt</Kbd>
              <Kbd>→</Kbd>
            </KbdGroup>,
          ]}
        </Or>
      ),
      does: "Go back, or forward again",
      off: !altArrows,
    },
    {
      keys: (
        <KbdGroup>
          <Kbd>
            <RiMouseLine /> Back
          </Kbd>
          <Kbd>
            <RiMouseLine /> Forward
          </Kbd>
        </KbdGroup>
      ),
      does: "The same, from the mouse's side buttons",
      off: !mouseButtons,
    },
    { keys: <Kbd>Esc</Kbd>, does: "Close whatever's open: a dialog, a menu, an app's window" },
  ]

  const mapping: Shortcut[] = [
    { keys: <Kbd>F2</Kbd>, does: "Rename the mapping you're on, or the card under the pointer" },
    {
      keys: (
        <Kbd>
          <RiMouseLine /> Right-click
        </Kbd>
      ),
      does: "More for a card, an app, or the space around them",
    },
    {
      keys: (
        <Kbd>
          <RiDraggable /> Drag
        </Kbd>
      ),
      does: "Put cards, and the apps on a control, in a new order",
    },
  ]

  const commandMenu: Shortcut[] = [
    { keys: <Kbd>Enter</Kbd>, does: "Pick what's highlighted, or run the command" },
    {
      keys: (
        <Or>
          {[
            <Kbd key="tab">Tab</Kbd>,
            <KbdGroup key="click">
              <Kbd>Shift</Kbd>
              <Kbd>Click</Kbd>
            </KbdGroup>,
          ]}
        </Or>
      ),
      does: "Add another before running it",
    },
    {
      keys: (
        <KbdGroup>
          <Kbd>Alt</Kbd>
          <Kbd>←</Kbd>
          <Kbd>→</Kbd>
        </KbdGroup>
      ),
      does: "Move between what you've added",
    },
    { keys: <Kbd>Backspace</Kbd>, does: "With nothing typed, take back the last thing added" },
    { keys: <Kbd>Esc</Kbd>, does: "Step back out of a command, then close the menu" },
  ]

  const settings: Shortcut[] = [
    { keys: <Kbd>Esc</Kbd>, does: "Clear the search" },
    {
      keys: (
        <Kbd>
          <RiMouseLine /> Right-click
        </Kbd>
      ),
      does: "Put a setting back to its default",
    },
  ]

  return (
    <Dialog>
      <DialogTrigger render={<Button type="button" variant="outline" size="sm" />}>
        <RiKeyboardLine />
        Show shortcuts
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Keyboard and mouse shortcuts</DialogTitle>
          <DialogDescription>What Volcon answers to, and where.</DialogDescription>
        </DialogHeader>
        <DialogList>
          <ShortcutList title="Anywhere" shortcuts={anywhere} />
          <ShortcutList title="Mapping" shortcuts={mapping} />
          <ShortcutList title="Command menu" shortcuts={commandMenu} />
          <ShortcutList title="Settings" shortcuts={settings} />
        </DialogList>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The bug report form's "This PC" answer: which versions this PC runs, its
 * controllers, and what's gone wrong lately. The form asks the rest. Kept to
 * what helps - no settings, no paths - since it's posted where anyone can
 * read it.
 */
async function thisPcDetails() {
  const [info, inputs, version] = await Promise.all([
    getDiagnosticsInfo().catch(() => null),
    listInputs().catch(() => null),
    // Answered even by a backend too old to report the rest.
    appVersion().catch(() => null),
  ])
  const { shortCommit, changed } = describeCommit(info?.source)
  const build = shortCommit
    ? `build ${shortCommit}${changed ? " with uncommitted changes" : ""}${buildInfo.builtAt ? `, ${describeBuildTime(buildInfo.builtAt)}` : ""}${buildInfo.development ? " (development)" : ""}`
    : null
  const errors = getNotifications()
    .filter((entry) => entry.kind === "error")
    .slice(0, 3)

  return [
    `- Volcon ${info?.appVersion ?? version ?? "unknown"}${build ? `, ${build}` : ""}`,
    `- Windows ${info?.os ?? "unknown"}`,
    `- WebView2 ${webViewVersion() ?? "unknown"}`,
    `- Tauri ${info?.tauriVersion ?? "unknown"}`,
    `- Controllers: ${inputs ? (inputs.inputs.length > 0 ? inputs.inputs.join(", ") : "none connected") : "couldn't list them"}`,
    ...(errors.length > 0
      ? [
          "- Recent errors:",
          // Each kept short: the whole report travels in the link, which
          // Windows can cut off if it runs too long.
          ...errors.map((entry) => {
            const said = entry.description && entry.description.length > 100
              ? `${entry.description.slice(0, 99)}…`
              : entry.description

            return `  - ${new Date(entry.at).toLocaleString()}: ${entry.title}${said ? ` (${said})` : ""}`
          }),
        ]
      : []),
  ].join("\n")
}

/** A copy button that says it worked, for a moment. */
function CopyDetails({ text }: { text: string }) {
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
      type="button"
      variant="outline"
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
      <RiFileCopyLine />
      {copied ? "Copied" : "Copy"}
    </Button>
  )
}

/**
 * The bug report form on GitHub, started for you: what it'll be given is shown
 * first, so it's plain what will be posted, then the form opens in the browser
 * to finish and send.
 */
export function ReportProblemDialog() {
  const [open, setOpen] = useState(false)
  const [details, setDetails] = useState<string | null>(null)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)

        // Gathered each time, so the errors are the latest.
        if (next) {
          setDetails(null)
          void thisPcDetails().then(setDetails)
        }
      }}
    >
      <DialogTrigger render={<Button type="button" variant="outline" size="sm" />}>
        <RiFeedbackLine />
        Report a problem
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Report a problem</DialogTitle>
          <DialogDescription>
            This opens the bug report form on Volcon&apos;s GitHub, with the details below already in
            its This PC box. Answer its questions there, change or remove anything you&apos;d rather not
            share, then submit it. It needs a GitHub account.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="border bg-muted/30 *:data-[slot=scroll-area-viewport]:max-h-64">
          <pre className="p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground select-text">
            {details ?? "Gathering the details…"}
          </pre>
        </ScrollArea>
        <DialogFooter>
          {details ? <CopyDetails text={details} /> : null}
          <Button
            type="button"
            disabled={!details}
            onClick={() => {
              if (!details) {
                return
              }

              openLink(bugReportUrl(details), "Start an issue on Volcon's GitHub")
              setOpen(false)
            }}
          >
            <RiExternalLinkLine />
            Open GitHub
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type Credit = {
  name: string
  /** What it does in Volcon. */
  use: string
  licence: string
  url: string
}

/** The open-source projects Volcon is built with, by what they do in it. */
const credits: Array<{ title: string; items: Credit[] }> = [
  {
    title: "Foundations",
    items: [
      { name: "Tauri", use: "The app itself, and its way into Windows", licence: "MIT or Apache-2.0", url: "https://tauri.app" },
      { name: "React", use: "Draws the interface", licence: "MIT", url: "https://react.dev" },
      { name: "Next.js", use: "Builds it", licence: "MIT", url: "https://nextjs.org" },
    ],
  },
  {
    title: "Behind the scenes",
    items: [
      { name: "midir", use: "Reads MIDI controllers", licence: "MIT", url: "https://github.com/Boddlnagg/midir" },
      { name: "windows-rs", use: "Talks to Windows' audio and shell", licence: "MIT or Apache-2.0", url: "https://github.com/microsoft/windows-rs" },
      { name: "image", use: "Turns app icons into pictures", licence: "MIT or Apache-2.0", url: "https://github.com/image-rs/image" },
      { name: "Serde", use: "Reads and writes presets and settings", licence: "MIT or Apache-2.0", url: "https://serde.rs" },
    ],
  },
  {
    title: "Interface",
    items: [
      { name: "Base UI", use: "Dialogs, menus, sliders and switches", licence: "MIT", url: "https://base-ui.com" },
      { name: "shadcn/ui", use: "The components made from them", licence: "MIT", url: "https://ui.shadcn.com" },
      { name: "Tailwind CSS", use: "How everything looks", licence: "MIT", url: "https://tailwindcss.com" },
      { name: "Motion", use: "How everything moves", licence: "MIT", url: "https://motion.dev" },
      { name: "cmdk", use: "The command menu", licence: "MIT", url: "https://cmdk.paco.me" },
      { name: "dnd kit", use: "Dragging cards and apps into order", licence: "MIT", url: "https://dndkit.com" },
      { name: "next-themes", use: "Light and dark", licence: "MIT", url: "https://github.com/pacocoursey/next-themes" },
    ],
  },
  {
    title: "Flourishes",
    items: [
      { name: "React Bits", use: "Rolling numbers, and the pixels on the About page", licence: "MIT + Commons Clause", url: "https://reactbits.dev" },
      { name: "Motion Primitives", use: "The window an app opens into", licence: "MIT", url: "https://motion-primitives.com" },
      { name: "Magic UI", use: "The confetti when a control is learned", licence: "MIT", url: "https://magicui.design" },
      { name: "canvas-confetti", use: "Draws that confetti", licence: "ISC", url: "https://github.com/catdad/canvas-confetti" },
      { name: "three.js and postprocessing", use: "Draw those pixels", licence: "MIT and Zlib", url: "https://threejs.org" },
    ],
  },
  {
    title: "Icons and type",
    items: [
      { name: "Remix Icon", use: "Icons", licence: "Remix Icon License 1.0", url: "https://remixicon.com" },
      { name: "Lucide", use: "A few more icons", licence: "ISC", url: "https://lucide.dev" },
      { name: "Geist and Geist Mono", use: "Type", licence: "SIL Open Font License", url: "https://vercel.com/font" },
      { name: "Instrument Sans and Manrope", use: "Type", licence: "SIL Open Font License", url: "https://fonts.google.com" },
    ],
  },
]

/** Thanks, with licences, behind one small button on the About page. */
export function CreditsDialog() {
  return (
    <Dialog>
      <DialogTrigger render={<Button type="button" variant="outline" size="sm" />}>
        <RiHeartLine />
        Credits
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Credits</DialogTitle>
          <DialogDescription>
            Volcon is built with these open-source projects. Thank you to everyone who makes them.
          </DialogDescription>
        </DialogHeader>
        <DialogList>
          {credits.map((group) => (
            <section key={group.title} className="flex flex-col gap-1.5">
              <ListHeading>{group.title}</ListHeading>
              <div className="flex flex-col border">
                {group.items.map((credit) => (
                  <button
                    key={credit.name}
                    type="button"
                    title={`Open ${credit.url}`}
                    onClick={() => openLink(credit.url, `Open ${credit.name}'s website`)}
                    className="group flex items-center gap-3 border-b px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-muted/30"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{credit.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{credit.use}</span>
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{credit.licence}</span>
                    <RiExternalLinkLine
                      aria-hidden
                      className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                    />
                  </button>
                ))}
              </div>
            </section>
          ))}
          <p className="px-0.5 text-[11px] leading-relaxed text-muted-foreground">
            And smaller pieces besides: class-variance-authority, clsx, tailwind-merge and tw-animate-css,
            Tauri&apos;s log and single-instance plugins, tauri-plugin-prevent-default, base64, semver and sha2.
          </p>
        </DialogList>
      </DialogContent>
    </Dialog>
  )
}
