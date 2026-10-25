"use client"

import { useEffect, useRef } from "react"

import type { SectionKey } from "@/components/sections/index"
import { requestMappingView } from "@/components/sections/mapping/mapping-navigation"
import { requestSettingsSection } from "@/components/sections/settings/settings-config"

/**
 * Back and forward between the places you've been, the way a browser does,
 * for the mouse's side buttons. A place is a screen and, within it, the page
 * it was on: a settings page, or one mapping's screen rather than the grid.
 *
 * Going back or forward doesn't redraw anything itself. It asks each screen
 * for the place, the same way the sidebar, the palette or a click would, so it
 * arrives with the same transitions as getting there by hand.
 */
export type Place = {
  section: SectionKey
  page: string | null
}

const MAX_PLACES = 50

const places: Place[] = []
let index = -1
let active: SectionKey | null = null

/** The page each screen was last on, kept while another is showing. */
const lastPages = new Map<SectionKey, string | null>()

/** Shows a screen, set by whatever owns which one is showing. */
let showSection: ((section: SectionKey) => void) | null = null

const samePlace = (a: Place | undefined, b: Place) =>
  a !== undefined && a.section === b.section && a.page === b.page

/** A new place, after the one we're at. Anything ahead of it is gone, as in a browser. */
function push(place: Place) {
  if (samePlace(places[index], place)) {
    return
  }

  places.splice(index + 1)
  places.push(place)

  if (places.length > MAX_PLACES) {
    places.shift()
  }

  index = places.length - 1
}

/** Lets history switch screens. Returns a function that takes that back. */
export function registerSectionSwitcher(switcher: (section: SectionKey) => void) {
  showSection = switcher

  return () => {
    if (showSection === switcher) {
      showSection = null
    }
  }
}

/** Where the app opened: the start of history, with nothing to go back to. */
export function startAt(section: SectionKey) {
  active = section
  places.length = 0
  index = -1
  push({ section, page: lastPages.get(section) ?? null })
}

/** The screen showing changed. */
export function sectionShown(section: SectionKey) {
  active = section

  // Already where history has us - arrived at by going back, say.
  if (places[index]?.section === section) {
    return
  }

  push({ section, page: lastPages.get(section) ?? null })
}

/**
 * The page a screen is on, reported by the screen. Its first report after it
 * opens refines the place recorded when it was switched to, rather than adding
 * another: one trip to a screen is one step back.
 */
export function pageShown(section: SectionKey, page: string | null, first: boolean) {
  lastPages.set(section, page)

  if (section !== active) {
    return
  }

  if (first && places[index]?.section === section) {
    places[index] = { section, page }
    return
  }

  push({ section, page })
}

function goTo(target: number) {
  const place = places[target]

  if (!place || !showSection) {
    return
  }

  index = target
  lastPages.set(place.section, place.page)

  // The page first, so a screen that isn't open yet opens straight onto it.
  if (place.section === "settings" && place.page) {
    requestSettingsSection(place.page)
  }

  if (place.section === "mapping") {
    requestMappingView(place.page)
  }

  showSection(place.section)
}

/**
 * Goes to a screen, and a page on it, from anywhere - a notification's button,
 * say - the way picking it by hand would: as a new step, with the screen's own
 * transition. Does nothing before the app has said how to switch screens.
 */
export function openPlace(section: SectionKey, page: string | null = null) {
  if (section === "settings" && page) {
    requestSettingsSection(page)
  }

  if (section === "mapping") {
    requestMappingView(page)
  }

  showSection?.(section)
}

export function goBack() {
  if (index > 0) {
    goTo(index - 1)
  }
}

export function goForward() {
  if (index < places.length - 1) {
    goTo(index + 1)
  }
}

/** Reports the page a screen is on whenever it changes, for history to follow. */
export function usePageInHistory(section: SectionKey, page: string | null) {
  const first = useRef(true)

  useEffect(() => {
    pageShown(section, page, first.current)
    first.current = false
  }, [section, page])
}
