/**
 * Which build this is: the commit it was built from, whether the code had
 * changes not yet committed, and when. Written in when the app is built - see
 * `env` in next.config.mjs - so rebuilds can be told apart in Settings, under
 * About. A development build fills these in when the dev server starts.
 */

const commit = process.env.NEXT_PUBLIC_BUILD_COMMIT || null

export const buildInfo = {
  /** The full commit hash, or null outside a git checkout. */
  commit,
  /** The first seven characters, as git shows them. */
  shortCommit: commit ? commit.slice(0, 7) : null,
  /** Built with changes that weren't committed yet. */
  changed: process.env.NEXT_PUBLIC_BUILD_CHANGED === "1",
  /** When it was built, as an ISO date. */
  builtAt: process.env.NEXT_PUBLIC_BUILD_TIME || null,
  /** A development build rather than an installed one. */
  development: process.env.NODE_ENV !== "production",
}

/** "25 Oct 2026, 2:14 pm". */
export function describeBuildTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}
