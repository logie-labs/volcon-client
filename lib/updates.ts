"use client"

import { useSyncExternalStore } from "react"

import { getSettingsSnapshot } from "@/components/sections/settings/settings-config"
import { openPlace } from "@/lib/navigation-history"
import { toast } from "@/lib/notifications"
import { releasesApiUrl } from "@/lib/project"
import { appVersion } from "@/lib/version"

/**
 * Whether there's a newer version of Volcon, from the releases published on
 * GitHub. Checked when asked on the Updates page, and when Volcon starts if
 * Settings allows - once a day at most, since every check is a request to
 * GitHub and nothing changes that often.
 *
 * The answer is kept between launches, so About and the Updates page can say
 * where things stood without asking again. Installing isn't done here: a newer
 * version is offered as its release page, to download from.
 */

export type Release = {
  /** Its version, without the tag's "v": "0.3.0". */
  version: string
  name: string
  /** What's new, as written on GitHub, in Markdown. */
  notes: string
  /** Its page on GitHub, where it's downloaded from. */
  url: string
  publishedAt: string | null
  prerelease: boolean
}

export type UpdateResult =
  | { status: "current"; installed: string; latest: Release | null }
  | { status: "available"; installed: string; latest: Release }
  /** Nothing to compare against: no releases yet, or none that can be seen. */
  | { status: "unpublished"; installed: string | null; reason: string }
  | { status: "failed"; installed: string | null; reason: string }

type Snapshot = {
  checking: boolean
  result: UpdateResult | null
  checkedAt: number | null
}

const storageKey = "volcon.updates"
const DAY_MS = 24 * 60 * 60 * 1000

let snapshot: Snapshot = { checking: false, result: null, checkedAt: null }
/** The newest version already announced, so each is only announced once. */
let announced: string | null = null
let restored = false
let running: Promise<UpdateResult> | null = null
const listeners = new Set<() => void>()

function restore() {
  if (restored || typeof window === "undefined") {
    return
  }

  restored = true

  try {
    const stored = JSON.parse(window.localStorage.getItem(storageKey) ?? "null") as {
      result?: UpdateResult
      checkedAt?: number
      announced?: string
    } | null

    snapshot = {
      checking: false,
      result: stored?.result ?? null,
      checkedAt: typeof stored?.checkedAt === "number" ? stored.checkedAt : null,
    }
    announced = typeof stored?.announced === "string" ? stored.announced : null
  } catch {
    // Unreadable: it just hasn't been checked yet, as far as anyone can tell.
  }
}

function save() {
  try {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({ result: snapshot.result, checkedAt: snapshot.checkedAt, announced })
    )
  } catch {
    // Blocked storage: the answer lasts until Volcon closes.
  }
}

function update(next: Snapshot) {
  snapshot = next
  listeners.forEach((listener) => listener())
}

/**
 * A version as numbers, and what follows a hyphen if anything does: "v0.3.0"
 * and "0.3.0-beta.2" both read.
 */
function parseVersion(text: string) {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?/.exec(text.trim())

  return match
    ? {
        parts: [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)],
        pre: match[4] ?? null,
      }
    : null
}

/** Which of two pre-release labels is later, the way semantic versioning orders them. */
function comparePrerelease(a: string, b: string) {
  const left = a.split(".")
  const right = b.split(".")

  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const x = left[index]
    const y = right[index]

    if (x === undefined) {
      return -1
    }

    if (y === undefined) {
      return 1
    }

    const xNumber = /^\d+$/.test(x)
    const yNumber = /^\d+$/.test(y)

    if (xNumber && yNumber && Number(x) !== Number(y)) {
      return Number(x) - Number(y)
    }

    if (xNumber !== yNumber) {
      return xNumber ? -1 : 1
    }

    if (!xNumber && x !== y) {
      return x < y ? -1 : 1
    }
  }

  return 0
}

/** Positive if `a` is the later version, negative if `b` is, zero if they're the same. */
export function compareVersions(a: string, b: string) {
  const left = parseVersion(a)
  const right = parseVersion(b)

  if (!left || !right) {
    return 0
  }

  for (let index = 0; index < 3; index++) {
    if (left.parts[index] !== right.parts[index]) {
      return left.parts[index] - right.parts[index]
    }
  }

  // A release comes after its own pre-releases.
  if (left.pre === right.pre) {
    return 0
  }

  if (left.pre === null) {
    return 1
  }

  if (right.pre === null) {
    return -1
  }

  return comparePrerelease(left.pre, right.pre)
}

type GitHubRelease = {
  tag_name?: string
  name?: string | null
  body?: string | null
  html_url?: string
  published_at?: string | null
  draft?: boolean
  prerelease?: boolean
}

function toRelease(release: GitHubRelease): Release | null {
  const parsed = release.tag_name ? parseVersion(release.tag_name) : null

  if (!parsed || !release.html_url) {
    return null
  }

  const version = release.tag_name!.trim().replace(/^v/, "")

  return {
    version,
    name: release.name?.trim() || `Volcon ${version}`,
    notes: release.body ?? "",
    url: release.html_url,
    publishedAt: release.published_at ?? null,
    prerelease: Boolean(release.prerelease),
  }
}

async function ask(prereleases: boolean): Promise<UpdateResult> {
  let installed: string | null = null

  try {
    installed = await appVersion()
  } catch {
    // Without the backend there's no version to compare, which is said below.
  }

  let response: Response

  try {
    response = await fetch(releasesApiUrl, { headers: { Accept: "application/vnd.github+json" } })
  } catch {
    return { status: "failed", installed, reason: "Couldn't reach GitHub. Check the connection and try again." }
  }

  // A private repository reads as not there at all.
  if (response.status === 404) {
    return { status: "unpublished", installed, reason: "Volcon's releases aren't public yet." }
  }

  if (response.status === 403 || response.status === 429) {
    return {
      status: "failed",
      installed,
      reason: "GitHub is turning checks away for the moment. Try again in a while.",
    }
  }

  if (!response.ok) {
    return { status: "failed", installed, reason: `GitHub answered with an error (${response.status}).` }
  }

  let releases: GitHubRelease[]

  try {
    releases = (await response.json()) as GitHubRelease[]
  } catch {
    return { status: "failed", installed, reason: "GitHub's answer couldn't be read." }
  }

  const latest =
    (Array.isArray(releases) ? releases : [])
      .filter((release) => !release.draft && (prereleases || !release.prerelease))
      .map(toRelease)
      .filter((release): release is Release => release !== null)
      .sort((a, b) => compareVersions(b.version, a.version))[0] ?? null

  if (!latest) {
    return {
      status: "unpublished",
      installed,
      reason: prereleases ? "No versions have been released yet." : "No versions have been released yet, apart from any test ones.",
    }
  }

  if (!installed) {
    return { status: "failed", installed, reason: "Couldn't tell which version is installed." }
  }

  return compareVersions(latest.version, installed) > 0
    ? { status: "available", installed, latest }
    : { status: "current", installed, latest }
}

/**
 * Asks GitHub now. A check already under way is shared rather than repeated.
 * A newer version found by asking is one you've seen, so it isn't announced
 * again later; one found by the check at startup is announced by that.
 */
export function checkForUpdates({
  prereleases,
  atStartup = false,
}: {
  prereleases: boolean
  atStartup?: boolean
}) {
  restore()

  if (running) {
    return running
  }

  update({ ...snapshot, checking: true })

  running = ask(prereleases)
    .then((result) => {
      if (result.status === "available" && !atStartup) {
        announced = result.latest.version
      }

      update({ checking: false, result, checkedAt: Date.now() })
      save()
      return result
    })
    .finally(() => {
      running = null
    })

  return running
}

/** Says a newer version is out, once for each version. */
function announce(result: Extract<UpdateResult, { status: "available" }>) {
  if (announced === result.latest.version) {
    return
  }

  announced = result.latest.version
  save()

  toast.info(`Volcon ${result.latest.version} is available`, {
    source: "app",
    description: `You have ${result.installed}. See what's new in Settings, under Updates.`,
    key: `update-available:${result.latest.version}`,
    event: {
      type: "update-available",
      installed: result.installed,
      latest: result.latest.version,
      url: result.latest.url,
      prerelease: result.latest.prerelease,
    },
    action: { label: "See what's new", onClick: () => openPlace("settings", "updates") },
  })
}

/**
 * Checks when Volcon starts, if Settings says to and the last check was more
 * than a day ago. Quiet unless there's something new.
 */
export function startUpdateChecks() {
  restore()

  const { autoCheck, prereleases } = getSettingsSnapshot().updates

  if (!autoCheck) {
    return
  }

  if (snapshot.checkedAt !== null && Date.now() - snapshot.checkedAt < DAY_MS) {
    // Still worth saying, if the last check found something not yet announced.
    if (snapshot.result?.status === "available") {
      announce(snapshot.result)
    }

    return
  }

  void checkForUpdates({ prereleases, atStartup: true }).then((result) => {
    if (result.status === "available") {
      announce(result)
    }
  })
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const empty: Snapshot = { checking: false, result: null, checkedAt: null }

/** Where the check stands: whether one is running, and the last answer and when. */
export function useUpdates(): Snapshot {
  return useSyncExternalStore(
    subscribe,
    () => {
      restore()
      return snapshot
    },
    () => empty
  )
}
