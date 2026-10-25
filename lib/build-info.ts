/**
 * Which build this is: the commit it was built from, whether the code had
 * changes not yet committed, and when. Written in when the app is built - see
 * `env` in next.config.mjs - so rebuilds can be told apart in Settings, under
 * About. A development build fills these in when the dev server starts.
 */

const commit = process.env.NEXT_PUBLIC_BUILD_COMMIT || null
const development = process.env.NODE_ENV !== "production"

export const buildInfo = {
  /** The full commit hash, or null outside a git checkout. */
  commit,
  /** The first seven characters, as git shows them. */
  shortCommit: commit ? commit.slice(0, 7) : null,
  /**
   * A development build started with changes that weren't committed yet.
   * Never said of an installed build: that's named by its commit alone, the
   * one on GitHub, whatever the folder it was built in held.
   */
  changed: development && process.env.NEXT_PUBLIC_BUILD_CHANGED === "1",
  /** When it was built, as an ISO date. */
  builtAt: process.env.NEXT_PUBLIC_BUILD_TIME || null,
  /** A development build rather than an installed one. */
  development,
}

/**
 * The commit to name, and whether to say it has changes on top. A
 * development build goes by `source` - the folder as it stands now, read by
 * the backend - so it stays true as you commit, falling back to how things
 * were when the dev server started. An installed build ignores `source` and
 * never has changes.
 */
export function describeCommit(source?: { commit: string; changed: boolean } | null) {
  const live = development ? source : null
  const full = live?.commit ?? commit

  return {
    commit: full,
    shortCommit: full ? full.slice(0, 7) : null,
    changed: live ? live.changed : buildInfo.changed,
  }
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
