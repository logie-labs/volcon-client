"use client"

import { useSyncExternalStore } from "react"

import { getSettingsSnapshot } from "@/components/sections/settings/settings-config"
import {
  cancelUpdateDownload,
  discardUpdateDownload,
  getUpdateDownloadState,
  installUpdateNow,
  openExternal,
  startUpdateDownload,
  type UpdateDownloadState,
} from "@/lib/bridge-client"
import { openPlace } from "@/lib/navigation-history"
import { toast } from "@/lib/notifications"
import { releasesApiUrl } from "@/lib/project"
import { hasTauriRuntime } from "@/lib/tauri-runtime"
import { appVersion } from "@/lib/version"

/**
 * Whether there's a newer version of Volcon, and getting it.
 *
 * Checked against the releases published on GitHub: when asked on the Updates
 * page, and when Volcon starts if Settings allows - once a day at most, since
 * every check is a request to GitHub and nothing changes that often. A newer
 * version is downloaded in the background when asked, checked, then installed
 * silently: straight away if asked, or else the next time Volcon starts. One
 * can be skipped, and then isn't offered again.
 *
 * The last answer is kept between launches, so About and the Updates page can
 * say where things stood without asking again - and forgotten once another
 * version is running, since it was about the old one.
 */

/** A release's installer: where it's downloaded from, its size and checksum. */
export type Installer = {
  url: string
  size: number
  /** As GitHub lists it, "sha256:…"; older releases may not have one. */
  sha256: string | null
}

export type Release = {
  /** Its version, without the tag's "v": "0.3.0". */
  version: string
  name: string
  /** What's new, as written on GitHub, in Markdown. */
  notes: string
  /** Its page on GitHub. */
  url: string
  publishedAt: string | null
  prerelease: boolean
  /** The installer to download, if the release has one. */
  installer: Installer | null
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
  /** The update being downloaded, or downloaded, as the backend has it. */
  download: UpdateDownloadState
  /** A version chosen not to be offered again. */
  skipped: string | null
}

const storageKey = "volcon.updates"
const DAY_MS = 24 * 60 * 60 * 1000
const idle: UpdateDownloadState = { phase: "idle" }

let snapshot: Snapshot = { checking: false, result: null, checkedAt: null, download: idle, skipped: null }
/** The newest version already announced, so each is only announced once. */
let announced: string | null = null
/** The version that ran last time, to say when it's changed. */
let lastVersion: string | null = null
let restored = false
let listening = false
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
      skipped?: string
      lastVersion?: string
    } | null

    snapshot = {
      ...snapshot,
      result: stored?.result ?? null,
      checkedAt: typeof stored?.checkedAt === "number" ? stored.checkedAt : null,
      skipped: typeof stored?.skipped === "string" ? stored.skipped : null,
    }
    announced = typeof stored?.announced === "string" ? stored.announced : null
    lastVersion = typeof stored?.lastVersion === "string" ? stored.lastVersion : null
  } catch {
    // Unreadable: it just hasn't been checked yet, as far as anyone can tell.
  }
}

function save() {
  try {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        result: snapshot.result,
        checkedAt: snapshot.checkedAt,
        announced,
        skipped: snapshot.skipped,
        lastVersion,
      })
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

type GitHubAsset = {
  name?: string
  browser_download_url?: string
  size?: number
  digest?: string | null
  state?: string
}

type GitHubRelease = {
  tag_name?: string
  name?: string | null
  body?: string | null
  html_url?: string
  published_at?: string | null
  draft?: boolean
  prerelease?: boolean
  assets?: GitHubAsset[]
}

/** The release's installer, among whatever else is attached to it. */
function installerOf(release: GitHubRelease): Installer | null {
  const asset = (release.assets ?? []).find(
    (asset) =>
      asset.name?.endsWith("-setup.exe") &&
      asset.browser_download_url &&
      typeof asset.size === "number" &&
      (asset.state === undefined || asset.state === "uploaded")
  )

  return asset
    ? { url: asset.browser_download_url!, size: asset.size!, sha256: asset.digest ?? null }
    : null
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
    installer: installerOf(release),
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

      update({ ...snapshot, checking: false, result, checkedAt: Date.now() })
      save()
      return result
    })
    .finally(() => {
      running = null
    })

  return running
}

/** Says a newer version is out, once for each version, unless it's been skipped. */
function announce(result: Extract<UpdateResult, { status: "available" }>) {
  const { latest, installed } = result

  if (announced === latest.version || snapshot.skipped === latest.version) {
    return
  }

  announced = latest.version
  save()

  toast.info(`Volcon ${latest.version} is available`, {
    source: "app",
    description: latest.installer
      ? `You have ${installed}. Download it here and it installs itself.`
      : `You have ${installed}. See what's new in Settings, under Updates.`,
    key: `update-available:${latest.version}`,
    event: {
      type: "update-available",
      installed,
      latest: latest.version,
      url: latest.url,
      prerelease: latest.prerelease,
    },
    action: latest.installer
      ? {
          label: "Download",
          // Over to the Updates page, where it can be seen coming in.
          onClick: () => {
            void downloadUpdate(latest)
            openPlace("settings", "updates")
          },
        }
      : { label: "See what's new", onClick: () => openPlace("settings", "updates") },
  })
}

/** The release a download is of, if it's the one the last check found. */
function releaseFor(version: string) {
  const result = snapshot.result
  return result?.status === "available" && result.latest.version === version ? result.latest : null
}

/** Said when a download finishes or fails, for when the Updates page isn't open. */
function adoptDownload(next: UpdateDownloadState) {
  const previous = snapshot.download
  update({ ...snapshot, download: next })

  if (previous.phase !== "downloading") {
    return
  }

  if (next.phase === "ready") {
    toast.success(`Volcon ${next.version} is ready to install`, {
      source: "app",
      description: "It installs the next time Volcon starts, or now, in a moment.",
      key: `update-ready:${next.version}`,
      action: { label: "Update now", onClick: () => void installNow() },
    })
  } else if (next.phase === "failed") {
    const release = releaseFor(next.version)

    toast.error(`Couldn't download Volcon ${next.version}`, {
      source: "app",
      description: "Nothing was changed. Try again, or download it from GitHub.",
      detail: next.reason,
      key: `update-failed:${next.version}`,
      action: release ? { label: "Try again", onClick: () => void downloadUpdate(release) } : undefined,
    })
  }
}

/** Follows the backend's download from here on, starting with where it stands. */
function listenForDownloads() {
  if (listening || !hasTauriRuntime()) {
    return
  }

  listening = true

  void getUpdateDownloadState()
    .then((state) => update({ ...snapshot, download: state }))
    .catch(() => {})
  void import("@tauri-apps/api/event")
    .then(({ listen }) => listen<UpdateDownloadState>("update:state", (event) => adoptDownload(event.payload)))
    .catch(() => {})
}

/**
 * Downloads a release's installer in the background, to install silently. A
 * release without one is opened on GitHub instead.
 */
export async function downloadUpdate(release: Release) {
  restore()

  if (!release.installer) {
    void openExternal(release.url).catch(() => {})
    return
  }

  if (snapshot.skipped === release.version) {
    update({ ...snapshot, skipped: null })
    save()
  }

  try {
    await startUpdateDownload({
      version: release.version,
      url: release.installer.url,
      size: release.installer.size,
      sha256: release.installer.sha256,
    })
  } catch (error) {
    toast.error(`Couldn't download Volcon ${release.version}`, {
      source: "app",
      detail: error instanceof Error ? error.message : String(error),
      key: `update-failed:${release.version}`,
    })
  }
}

export function cancelDownload() {
  void cancelUpdateDownload().catch(() => {})
}

/** Installs the downloaded update now: Volcon closes, and opens again updated. */
export async function installNow() {
  try {
    await installUpdateNow()
  } catch (error) {
    toast.error("Couldn't install the update", {
      source: "app",
      detail: error instanceof Error ? error.message : String(error),
    })
  }
}

/** Stops offering a version, and throws away its download if there is one. */
export function skipVersion(version: string) {
  restore()
  update({ ...snapshot, skipped: version })
  save()

  const download = snapshot.download

  if (download.phase !== "idle" && download.version === version) {
    void discardUpdateDownload().catch(() => {})
  }
}

export function unskipVersion() {
  restore()
  update({ ...snapshot, skipped: null })
  save()
}

/**
 * When Volcon starts: says so if it's just been updated, forgets an answer that
 * was about the version that ran before, then checks if Settings says to and
 * the last check was more than a day ago. Quiet unless there's something new.
 */
export async function startUpdateChecks() {
  restore()
  listenForDownloads()

  const installed = await appVersion().catch(() => null)

  if (installed) {
    const answeredFor = snapshot.result?.installed

    if (answeredFor && answeredFor !== installed) {
      update({ ...snapshot, result: null, checkedAt: null })
    }

    if (lastVersion && compareVersions(installed, lastVersion) > 0) {
      toast.success(`Volcon updated to ${installed}`, {
        source: "app",
        description: `From ${lastVersion}. See what's new in Settings, under Updates.`,
        key: `updated:${installed}`,
        action: { label: "What's new", onClick: () => openPlace("settings", "updates") },
      })
    }

    lastVersion = installed
    save()
  }

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

const empty: Snapshot = { checking: false, result: null, checkedAt: null, download: idle, skipped: null }

/**
 * Where updates stand: whether a check is running and its last answer, the
 * download, and any version skipped.
 */
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
