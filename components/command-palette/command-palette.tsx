"use client"

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"

import { Command as CommandPrimitive } from "cmdk"
import { RiCloseLine, RiCornerDownLeftLine, RiSearchLine, RiTerminalBoxLine } from "@remixicon/react"

import { Kbd, KbdGroup } from "@/components/ui/kbd"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command"

import { useCommandRegistry } from "./command-palette-context"
import {
  activeArgumentIndex,
  argumentTokens,
  canRunCommand,
  commandSignature,
  type CommandOption,
  type CommandToken,
  type CommandTokens,
  type PaletteCommand,
} from "./types"

const ROOT_GROUP = "Commands"

function optionValue(option: CommandOption) {
  return [option.id, option.label, ...(option.keywords ?? [])].join(" ").trim()
}

/** cmdk normalises the values it stores, so match on a normalised form. */
function normalizeValue(value: string) {
  return value.trim().toLowerCase()
}

const words = (text: string) => text.split(/[^a-z0-9]+/).filter(Boolean)

function isSubsequence(needle: string, haystack: string) {
  let found = 0

  for (const char of haystack) {
    if (char === needle[found]) {
      found += 1
    }
  }

  return found === needle.length
}

/**
 * How well an option answers what's been typed, or 0 for not at all. A name
 * beats a keyword, and the start of a name beats anywhere in it, so typing
 * "add" puts Add first. cmdk's own fuzzy scoring ranked Theme above it, by
 * stringing the letters of "and dark" together out of its description.
 */
function matchScore(option: CommandOption, query: string) {
  const needle = query.trim().toLowerCase()
  const label = option.label.toLowerCase()

  if (label === needle) return 100
  if (label.startsWith(needle)) return 90
  if (words(label).some((word) => word.startsWith(needle))) return 80
  if (label.includes(needle)) return 70

  const keywords = (option.keywords ?? []).map((keyword) => keyword.toLowerCase())

  if (keywords.includes(needle)) return 60
  if (keywords.some((keyword) => words(keyword).some((word) => word.startsWith(needle)))) return 50
  if (isSubsequence(needle, label)) return 40
  if (keywords.some((keyword) => keyword.includes(needle))) return 30

  return 0
}

/** The options that match, best first; ties keep the order they were listed in. */
function rankOptions(options: CommandOption[], query: string) {
  if (!query.trim()) {
    return options
  }

  return options
    .map((option, index) => ({ option, index, score: matchScore(option, query) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((entry) => entry.option)
}

function OptionIcon({ option }: { option: CommandOption }) {
  if (option.iconSrc) {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center overflow-hidden border bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={option.iconSrc} alt="" className="size-full object-contain p-0.5" />
      </span>
    )
  }

  if (option.icon) {
    return <span className="flex size-5 shrink-0 items-center justify-center">{option.icon}</span>
  }

  return null
}

/** One accepted argument, sitting inline in the input bar like a tag. */
function Chip({
  token,
  selected,
  onSelect,
  onRemove,
}: {
  token: CommandToken
  selected: boolean
  onSelect: () => void
  onRemove: () => void
}) {
  return (
    <span
      role="option"
      aria-selected={selected}
      onMouseDown={(event) => {
        // Keep focus on the input; selection is ours to track.
        event.preventDefault()
        onSelect()
      }}
      className={`flex h-6 shrink-0 cursor-default items-center gap-1 border px-1.5 text-xs transition-colors ${
        selected
          ? "border-primary bg-primary/15 text-foreground"
          : "border-border bg-muted text-foreground"
      }`}
    >
      {token.iconSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={token.iconSrc} alt="" className="size-3.5 shrink-0 object-contain" />
      ) : token.icon ? (
        <span className="flex size-3.5 shrink-0 items-center justify-center [&_svg]:size-3.5">
          {token.icon}
        </span>
      ) : null}
      <span className="max-w-32 truncate">{token.label}</span>
      <button
        type="button"
        tabIndex={-1}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onRemove}
        aria-label={`Remove ${token.label}`}
        className="text-muted-foreground transition-colors hover:text-foreground"
      >
        <RiCloseLine className="size-3" />
      </button>
    </span>
  )
}

/** Where the cursor sits when it is between chips rather than in the text. */
function ChipCaret() {
  return <span aria-hidden className="h-5 w-px shrink-0 animate-pulse bg-primary" />
}

export function CommandPalette() {
  const { commands: liveCommands, isOpen, seed, close, toggle } = useCommandRegistry()

  // What the palette draws from: live while it's open, held from the moment it
  // starts to close. The command that just ran is usually what changes the
  // registry ("Add" assigns the very apps it was listing), and redrawing from
  // the new list during the exit animation resized the dialog as it faded out.
  const [heldCommands, setHeldCommands] = useState(liveCommands)

  if (isOpen && heldCommands !== liveCommands) {
    setHeldCommands(liveCommands)
  }

  const commands = isOpen ? liveCommands : heldCommands

  const [activeCommandId, setActiveCommandId] = useState<string | null>(null)
  const [tokens, setTokens] = useState<CommandTokens>([])
  const [query, setQuery] = useState("")
  const [highlighted, setHighlighted] = useState("")
  /** Index into the flat chip list, or null when the cursor is in the text. */
  const [selectedChip, setSelectedChip] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const shiftClickRef = useRef(false)
  const appliedSeed = useRef<string | null>(null)

  const activeCommand = useMemo(
    () => commands.find((command) => command.id === activeCommandId) ?? null,
    [commands, activeCommandId],
  )

  const reset = useCallback(() => {
    setActiveCommandId(null)
    setTokens([])
    setQuery("")
    setHighlighted("")
    setSelectedChip(null)
  }, [])

  // Two ways in: Ctrl/Cmd+K, and a bare Ctrl+Alt.
  //
  // Ctrl+Alt is modifiers-only, so it can't be an accelerator — it has to be read
  // as a chord. It fires the moment the second of the two goes down, in either
  // order, so there is no wait for a release. `fired` then holds it shut until
  // the pair is broken, which stops key auto-repeat from strobing the palette
  // while the chord is held, but still lets a second tap toggle it back.
  useEffect(() => {
    let fired = false

    const isChordModifier = (key: string) => key === "Control" || key === "Alt" || key === "AltGraph"

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey) && !event.altKey) {
        event.preventDefault()
        toggle()
        return
      }

      if (!isChordModifier(event.key)) {
        return
      }

      if (event.repeat || fired) {
        return
      }

      if (event.ctrlKey && event.altKey && !event.shiftKey && !event.metaKey) {
        fired = true
        event.preventDefault()
        toggle()
      }
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      // Re-arm as soon as the pair is broken, not once both are up — so holding
      // Ctrl and tapping Alt again toggles again.
      if (isChordModifier(event.key) && !(event.ctrlKey && event.altKey)) {
        fired = false
      }
    }

    // Alt+Tab and friends take the keyup with them; forget the chord on the way out.
    const handleBlur = () => {
      fired = false
    }

    window.addEventListener("keydown", handleKeyDown)
    window.addEventListener("keyup", handleKeyUp)
    window.addEventListener("blur", handleBlur)

    return () => {
      window.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("keyup", handleKeyUp)
      window.removeEventListener("blur", handleBlur)
    }
  }, [toggle])

  // Every open starts fresh, and a seeded one lands part-way through a command:
  // "Assign app" arrives with the control already filled in, so only the apps
  // are left to pick. Closing deliberately leaves the state alone so the exit
  // animation plays over what was on screen; this clears it on the way back in,
  // before the first frame is painted, so the last session never flashes up.
  useLayoutEffect(() => {
    if (!isOpen) {
      appliedSeed.current = null
      return
    }

    const seedKey = seed
      ? `${seed.commandId}:${(seed.tokens ?? [])
          .flat()
          .map((token) => token.id)
          .join(",")}`
      : "none"

    if (appliedSeed.current === seedKey) {
      return
    }

    appliedSeed.current = seedKey

    setActiveCommandId(seed?.commandId ?? null)
    setTokens(seed?.tokens ?? [])
    setQuery("")
    setHighlighted("")
    setSelectedChip(null)
  }, [isOpen, seed])

  const argIndex = activeCommand ? activeArgumentIndex(activeCommand, tokens) : -1
  const activeArgument = activeCommand?.args?.[argIndex] ?? null
  const isReady = activeCommand ? canRunCommand(activeCommand, tokens) : false

  // Filtered and ranked here rather than by cmdk (see `matchScore`). Groups then
  // fall into place on their own: each is listed where its best match ranks.
  const options = useMemo(() => {
    if (!activeCommand) {
      return rankOptions(
        commands.map<CommandOption>((command) => ({
          id: command.id,
          label: command.name,
          hint: commandSignature(command),
          keywords: [
            command.description,
            ...(command.keywords ?? []),
            ...(command.group ? [command.group] : []),
          ],
          group: command.group ?? ROOT_GROUP,
          icon: command.icon ?? <RiTerminalBoxLine className="text-muted-foreground" />,
          data: command,
        })),
        query,
      )
    }

    if (!activeArgument) {
      return []
    }

    const taken = new Set(argumentTokens(tokens, argIndex).map((token) => token.id))
    const available = rankOptions(
      activeArgument.options(tokens, query).filter((option) => !taken.has(option.id)),
      query,
    )

    // Typing a name that matches nothing still offers it, always last: it echoes
    // the query back, so it would outrank every real match.

    const trimmedQuery = query.trim()
    const freeTextOption =
      trimmedQuery && activeArgument.freeText
        ? activeArgument.freeText(trimmedQuery, tokens)
        : null

    if (
      freeTextOption &&
      !taken.has(freeTextOption.id) &&
      !available.some((option) => option.id === freeTextOption.id)
    ) {
      return [...available, freeTextOption]
    }

    return available
  }, [activeCommand, activeArgument, argIndex, commands, query, tokens])

  const grouped = useMemo(() => {
    const groups = new Map<string, CommandOption[]>()

    for (const option of options) {
      const key = option.group ?? (activeCommand ? (activeArgument?.name ?? "") : ROOT_GROUP)
      const bucket = groups.get(key) ?? []
      bucket.push(option)
      groups.set(key, bucket)
    }

    return Array.from(groups.entries())
  }, [options, activeCommand, activeArgument])

  /**
   * cmdk owns the highlight, and its controlled `value` can lag by a render right
   * after the list changes. Reading the selected item back off the DOM keeps Tab
   * and Enter acting on whatever is actually lit up.
   */
  const highlightedOption = useCallback(() => {
    const selected = rootRef.current?.querySelector<HTMLElement>(
      "[cmdk-item][data-selected=\"true\"]",
    )
    const value = normalizeValue(selected?.getAttribute("data-value") ?? highlighted)

    return options.find((option) => normalizeValue(optionValue(option)) === value) ?? null
  }, [options, highlighted])

  const runCommand = useCallback(
    (command: PaletteCommand, withTokens: CommandTokens) => {
      void Promise.resolve(command.run(withTokens)).catch(() => {
        // The command owns its own error reporting; the palette just steps aside.
      })

      close()
    },
    [close],
  )

  const selectCommand = useCallback(
    (command: PaletteCommand) => {
      // Nothing to collect — picking it is running it.
      if (!command.args || command.args.length === 0) {
        runCommand(command, [])
        return
      }

      setActiveCommandId(command.id)
      setTokens([])
      setQuery("")
      setHighlighted("")
      setSelectedChip(null)
    },
    [runCommand],
  )

  const acceptOption = useCallback(
    (option: CommandOption) => {
      if (!activeCommand || argIndex < 0) {
        return
      }

      setTokens((current) => {
        const next = [...current]

        while (next.length <= argIndex) {
          next.push([])
        }

        const slot = activeCommand.args?.[argIndex]
        const accepted: CommandToken = { ...option }

        next[argIndex] = slot?.variadic ? [...next[argIndex], accepted] : [accepted]

        return next
      })

      setQuery("")
      setHighlighted("")
      setSelectedChip(null)
    },
    [activeCommand, argIndex],
  )

  /**
   * Takes an option and runs the command if that was the last thing it needed,
   * otherwise moves on to the next argument. What Enter and a plain click do;
   * Tab and Shift+click queue the option up instead, to pick more.
   */
  const commitOption = useCallback(
    (option: CommandOption) => {
      if (!activeCommand || argIndex < 0) {
        return
      }

      const slot = activeCommand.args?.[argIndex]
      const nextTokens = [...tokens]

      while (nextTokens.length <= argIndex) {
        nextTokens.push([])
      }

      nextTokens[argIndex] = slot?.variadic ? [...nextTokens[argIndex], option] : [option]

      if (canRunCommand(activeCommand, nextTokens)) {
        runCommand(activeCommand, nextTokens)
        return
      }

      setTokens(nextTokens)
      setQuery("")
      setHighlighted("")
      setSelectedChip(null)
    },
    [activeCommand, argIndex, runCommand, tokens],
  )

  /** The accepted arguments, flattened in the order they are drawn. */
  const chips = useMemo(
    () =>
      activeCommand
        ? tokens.flatMap((slot, slotIndex) =>
            slot.map((token, tokenIndex) => ({ token, slotIndex, tokenIndex })),
          )
        : [],
    [activeCommand, tokens],
  )

  const removeChip = useCallback((slotIndex: number, tokenIndex: number) => {
    setTokens((current) => {
      const next = [...current]
      next[slotIndex] = (next[slotIndex] ?? []).filter((_, index) => index !== tokenIndex)
      return next
    })
  }, [])

  /** Backspace on an empty query peels tokens back off, then the command itself. */
  const popToken = useCallback(() => {
    if (!activeCommand) {
      return
    }

    const lastFilled = [...tokens].reduce(
      (found, slot, index) => (slot.length > 0 ? index : found),
      -1,
    )

    if (lastFilled === -1) {
      reset()
      return
    }

    setTokens((current) => {
      const next = [...current]
      next[lastFilled] = next[lastFilled].slice(0, -1)
      return next
    })
  }, [activeCommand, tokens, reset])

  /**
   * Reorders a chip within its own argument. Arguments are positional, so a chip
   * never crosses into a neighbouring slot — only the order of a repeatable one
   * (which app comes first) is the user's to change.
   */
  const moveChip = useCallback(
    (chipIndex: number, direction: -1 | 1) => {
      const chip = chips[chipIndex]
      const target = chips[chipIndex + direction]

      if (!chip || !target || chip.slotIndex !== target.slotIndex) {
        return
      }

      setTokens((current) => {
        const next = [...current]
        const slot = [...(next[chip.slotIndex] ?? [])]
        const [moved] = slot.splice(chip.tokenIndex, 1)
        slot.splice(target.tokenIndex, 0, moved)
        next[chip.slotIndex] = slot
        return next
      })

      setSelectedChip(chipIndex + direction)
    },
    [chips],
  )

  /** True when the text caret is at the very start, so the left arrow can step out. */
  const caretAtStart = () => {
    const input = inputRef.current

    return !input || (input.selectionStart === 0 && input.selectionEnd === 0)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const takeOver = () => {
      event.preventDefault()
      event.stopPropagation()
    }

    // --- moving the cursor through the chips ------------------------------
    if (event.key === "ArrowLeft" && chips.length > 0) {
      if (selectedChip === null && caretAtStart()) {
        takeOver()
        setSelectedChip(chips.length - 1)
        return
      }

      if (selectedChip !== null) {
        takeOver()

        if (event.altKey) {
          moveChip(selectedChip, -1)
        } else {
          setSelectedChip(Math.max(0, selectedChip - 1))
        }

        return
      }
    }

    if (event.key === "ArrowRight" && selectedChip !== null) {
      takeOver()

      if (event.altKey) {
        moveChip(selectedChip, 1)
        return
      }

      setSelectedChip(selectedChip === chips.length - 1 ? null : selectedChip + 1)
      return
    }

    if ((event.key === "Home" || event.key === "End") && chips.length > 0) {
      if (event.key === "End" && selectedChip !== null) {
        takeOver()
        setSelectedChip(null)
        return
      }

      if (event.key === "Home" && (selectedChip !== null || caretAtStart())) {
        takeOver()
        setSelectedChip(0)
        return
      }
    }

    if (selectedChip !== null) {
      if (event.key === "Backspace" || event.key === "Delete") {
        takeOver()

        const chip = chips[selectedChip]

        if (chip) {
          removeChip(chip.slotIndex, chip.tokenIndex)
          setSelectedChip(
            chips.length <= 1 ? null : Math.max(0, Math.min(selectedChip - 1, chips.length - 2)),
          )
        }

        return
      }

      // Anything that types a character drops the selection and carries on into
      // the input, so the chips never swallow what the user meant to search for.
      if (event.key.length === 1 && !event.metaKey && !event.ctrlKey) {
        setSelectedChip(null)
      }
    }

    if (event.key === "Tab") {
      event.preventDefault()
      event.stopPropagation()

      const option = highlightedOption()

      if (!option) {
        return
      }

      if (!activeCommand) {
        selectCommand(option.data as PaletteCommand)
        return
      }

      acceptOption(option)
      return
    }

    if (event.key === "Enter") {
      event.preventDefault()
      event.stopPropagation()

      if (!activeCommand) {
        const option = highlightedOption()

        if (option) {
          selectCommand(option.data as PaletteCommand)
        }

        return
      }

      // Enter commits. If the command still wants a value, it takes the
      // highlighted one on the way — so a single app needs one keystroke, and
      // Tab is what queues up more.
      if (isReady) {
        runCommand(activeCommand, tokens)
        return
      }

      const option = highlightedOption()

      if (option) {
        commitOption(option)
      }

      return
    }

    if (event.key === "Backspace" && query === "" && activeCommand) {
      event.preventDefault()
      event.stopPropagation()
      popToken()
      return
    }

    if (event.key === "Escape") {
      if (selectedChip !== null) {
        takeOver()
        setSelectedChip(null)
        return
      }

      if (activeCommand) {
        takeOver()
        reset()
        inputRef.current?.focus()
      }
    }
  }

  const placeholder = activeCommand
    ? (activeArgument?.placeholder ?? `Run ${activeCommand.name}`)
    : "Type a command, e.g. add"

  return (
    <CommandDialog
      open={isOpen}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          close()
        }
      }}
      title="Command palette"
      description="Run a command. Tab accepts a value, Enter runs the command."
      className="sm:max-w-xl"
    >
      <Command
        shouldFilter={false}
        value={highlighted}
        onValueChange={setHighlighted}
        onKeyDownCapture={handleKeyDown}
        // cmdk's root and list both take focus on a click, which took the caret
        // out of the input: click a command, start typing its argument, and
        // nothing went in. A click anywhere in the palette now leaves focus in
        // the input; one on the input itself still places the caret.
        onMouseDown={(event) => {
          if (event.target !== inputRef.current) {
            event.preventDefault()
          }
        }}
        ref={rootRef}
        className="p-0"
      >
        {/* One bar: the command, its arguments as chips, then the caret. Arrow keys
            walk the cursor out of the text and between the chips; Alt+Arrow moves a
            chip along; Backspace deletes the selected one. */}
        <div
          data-slot="command-input-wrapper"
          role="group"
          aria-label="Command and arguments"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              event.preventDefault()
              setSelectedChip(null)
              inputRef.current?.focus()
            }
          }}
          className="flex flex-wrap items-center gap-1 border-b border-input/60 p-2"
        >
          <RiSearchLine className="size-4 shrink-0 opacity-50" />

          {activeCommand ? (
            <span className="flex h-6 shrink-0 items-center border border-primary/40 bg-primary/10 px-1.5 font-mono text-xs text-primary">
              {activeCommand.name}
            </span>
          ) : null}

          {chips.map((chip, index) => (
            <Fragment key={`${chip.slotIndex}-${chip.tokenIndex}-${chip.token.id}`}>
              {selectedChip === index ? <ChipCaret /> : null}
              <Chip
                token={chip.token}
                selected={selectedChip === index}
                onSelect={() => setSelectedChip(index)}
                onRemove={() => {
                  removeChip(chip.slotIndex, chip.tokenIndex)
                  setSelectedChip(null)
                  inputRef.current?.focus()
                }}
              />
            </Fragment>
          ))}

          <CommandPrimitive.Input
            ref={inputRef}
            value={query}
            onValueChange={setQuery}
            placeholder={selectedChip === null ? placeholder : ""}
            data-slot="command-input"
            onMouseDown={() => setSelectedChip(null)}
            className={`h-6 min-w-32 flex-1 bg-transparent text-sm outline-hidden disabled:cursor-not-allowed disabled:opacity-50 ${
              // Only one cursor on screen at a time: while a chip holds it, the
              // text caret gets out of the way.
              selectedChip === null ? "" : "caret-transparent"
            }`}
          />
        </div>

        {/* A fixed height rather than a maximum, so the palette stays the same
            size as results come and go and can sit centred without jumping. */}
        <CommandList className="h-72">
          <CommandEmpty>
            {activeArgument?.emptyLabel ?? "Nothing matches that."}
          </CommandEmpty>

          {grouped.map(([group, groupOptions]) => (
            <CommandGroup key={group} heading={group}>
              {groupOptions.map((option) => (
                <CommandItem
                  key={option.id}
                  value={optionValue(option)}
                  // cmdk's select callback carries no event, so note Shift here.
                  onPointerDown={(event) => {
                    shiftClickRef.current = event.shiftKey
                  }}
                  onSelect={() => {
                    if (!activeCommand) {
                      selectCommand(option.data as PaletteCommand)
                      return
                    }

                    // A click takes the option and carries on, as Enter does;
                    // Shift+click queues it to pick more, as Tab does.
                    if (shiftClickRef.current) {
                      shiftClickRef.current = false
                      acceptOption(option)
                      return
                    }

                    commitOption(option)
                  }}
                >
                  <OptionIcon option={option} />
                  <span className="truncate">{option.label}</span>
                  {option.hint ? (
                    <CommandShortcut className="font-mono normal-case tracking-normal">
                      {option.hint}
                    </CommandShortcut>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>

        <div className="flex items-center justify-between gap-3 border-t px-3 py-1.5 text-[11px] text-muted-foreground">
          <span className="min-w-0 truncate">
            {activeCommand ? (
              activeCommand.description
            ) : (
              <KbdGroup>
                <Kbd>Ctrl</Kbd>
                <Kbd>Alt</Kbd>
              </KbdGroup>
            )}
          </span>

          <span className="flex shrink-0 items-center gap-3">
            {activeCommand ? (
              <span className="flex items-center gap-1.5">
                <KbdGroup>
                  <Kbd>Tab</Kbd>
                  <Kbd>⇧ Click</Kbd>
                </KbdGroup>
                add
              </span>
            ) : null}

            {activeCommand && chips.length > 0 ? (
              <span className="flex items-center gap-1.5">
                <KbdGroup>
                  <Kbd>Alt</Kbd>
                  <Kbd>←</Kbd>
                  <Kbd>→</Kbd>
                </KbdGroup>
                move
              </span>
            ) : null}

            <span className="flex items-center gap-1.5">
              <Kbd>
                <RiCornerDownLeftLine />
              </Kbd>
              {activeCommand ? (isReady ? "Run" : "Add & run") : "Select"}
            </span>
          </span>
        </div>
      </Command>
    </CommandDialog>
  )
}
