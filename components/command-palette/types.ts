import type { ReactNode } from "react"

/** One selectable value for an argument slot, or one command in the root list. */
export type CommandOption = {
  /** Stable within its slot; also what the palette de-duplicates on. */
  id: string
  label: string
  /** Right-aligned meta, e.g. "2 processes". */
  hint?: string
  /** Extra text the fuzzy filter should match on. */
  keywords?: string[]
  iconSrc?: string | null
  icon?: ReactNode
  /** Heading this option is listed under. */
  group?: string
  /** Carried through to `run` untouched, so a command needn't re-derive it. */
  data?: unknown
}

export type CommandToken = CommandOption & {
  /** True when the user typed a value that matched no option. */
  freeText?: boolean
}

/** Accepted tokens, one array per argument slot. */
export type CommandTokens = CommandToken[][]

export type CommandArgument = {
  name: string
  placeholder: string
  /**
   * Repeatable. Tab accepts one and stays on this slot, so several values can be
   * queued before the command is committed.
   */
  variadic?: boolean
  optional?: boolean
  /** Shown in place of the list when `options` comes back empty. */
  emptyLabel?: string
  /** What this slot offers, given everything accepted so far. */
  options: (accepted: CommandTokens, query: string) => CommandOption[]
  /**
   * Turns raw input into a token when it matches no option — how an app that
   * isn't running yet still gets named.
   */
  freeText?: (value: string, accepted: CommandTokens) => CommandOption | null
}

export type PaletteCommand = {
  id: string
  /** What the user types, e.g. "add". */
  name: string
  description: string
  keywords?: string[]
  /** Heading in the root list, e.g. "Mapping". */
  group?: string
  icon?: ReactNode
  args?: CommandArgument[]
  run: (tokens: CommandTokens) => void | Promise<void>
}

/** Opens the palette part-way through a command, e.g. with its target filled in. */
export type CommandSeed = {
  commandId: string
  tokens?: CommandTokens
}

export function argumentTokens(tokens: CommandTokens, index: number) {
  return tokens[index] ?? []
}

/**
 * The slot the user is filling: the first one that still wants a value, and
 * thereafter a variadic slot, which keeps accepting until the command is run.
 */
export function activeArgumentIndex(command: PaletteCommand, tokens: CommandTokens) {
  const args = command.args ?? []

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]

    if (argument.variadic || argumentTokens(tokens, index).length === 0) {
      return index
    }
  }

  return args.length - 1
}

export function canRunCommand(command: PaletteCommand, tokens: CommandTokens) {
  const args = command.args ?? []

  return args.every(
    (argument, index) => argument.optional || argumentTokens(tokens, index).length > 0,
  )
}

/** "add <control> <apps…>" — the signature shown next to a command in the list. */
export function commandSignature(command: PaletteCommand) {
  return (command.args ?? [])
    .map((argument) => `<${argument.name}${argument.variadic ? "…" : ""}>`)
    .join(" ")
}
