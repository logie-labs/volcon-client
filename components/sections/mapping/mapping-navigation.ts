/**
 * Asking the Mapping screen to show a mapping's own screen, or the grid, from
 * outside it - going back or forward through history, say. Heard at once if
 * the screen is open, and opened on when it next is if not.
 */

/** A mapping's id, null for the grid, or undefined when nothing's been asked. */
let pendingView: string | null | undefined

export const mappingViewRequestEvent = "volcon:mapping-view"

export function requestMappingView(mappingId: string | null) {
  pendingView = mappingId

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(mappingViewRequestEvent, { detail: mappingId }))
  }
}

/** What was last asked for, until the Mapping screen has opened on it. */
export function pendingMappingView() {
  return pendingView
}

export function clearPendingMappingView() {
  pendingView = undefined
}
