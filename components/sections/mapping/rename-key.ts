"use client"

import { useEffect, useEffectEvent } from "react"

/**
 * Where keys are typing. Sliders and checkboxes are inputs too, but nothing is
 * typed into them, so F2 still renames while one has focus.
 */
const TEXT_FIELD =
  "textarea, [contenteditable='true'], input:not([type=range], [type=checkbox], [type=radio], [type=button])"

/** Something open over the page, whose keys they are while it's open. */
const OPEN_OVER_PAGE = "[role=dialog], [role=alertdialog], [role=menu], [role=listbox]"

/**
 * F2, the key that renames things in Windows. Calls `onRename` when it's
 * pressed on the page, but not while typing, and not with a dialog or menu open
 * over the page.
 */
export function useRenameKey(onRename: () => void) {
  const rename = useEffectEvent(onRename)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== "F2" ||
        event.repeat ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      ) {
        return
      }

      const target = event.target instanceof Element ? event.target : null

      if (target?.closest(TEXT_FIELD) || document.querySelector(OPEN_OVER_PAGE)) {
        return
      }

      event.preventDefault()
      rename()
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])
}
