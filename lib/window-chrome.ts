/**
 * The custom title bar is window chrome rather than part of the page: whatever
 * the page has open, the title bar stays visible and usable. These are the parts
 * of that rule that live outside the toolbar itself.
 */

/**
 * In px. The one place this is set: app/layout.tsx publishes it to CSS as
 * `--window-toolbar-height`, which the layout and the overlays offset by.
 */
export const WINDOW_TOOLBAR_HEIGHT = 32

/** Marks the title bar, so a modal can tell a click on it from one on the page. */
export const WINDOW_TOOLBAR_ATTRIBUTE = "data-window-toolbar"

/**
 * Collision padding for floating content (selects, menus, tooltips), so it
 * treats the bottom of the title bar as the top of the screen and flips or
 * shifts rather than sliding up over it.
 */
export function belowWindowToolbar(padding = 0) {
  return {
    top: WINDOW_TOOLBAR_HEIGHT + padding,
    right: padding,
    bottom: padding,
    left: padding,
  }
}

/**
 * For a modal's `onOpenChange`. Dragging, minimising or maximising the window
 * isn't an interaction with the page, so a press on the title bar shouldn't
 * dismiss whatever the page has open. Cancels the change when that's what it
 * was, and says whether it did.
 */
export function keepOpenOnWindowToolbar(
  open: boolean,
  details: { reason: string; event: Event; cancel: () => void }
) {
  if (
    !open &&
    details.reason === "outside-press" &&
    details.event.target instanceof Element &&
    details.event.target.closest(`[${WINDOW_TOOLBAR_ATTRIBUTE}]`)
  ) {
    details.cancel()
    return true
  }

  return false
}
