"use client"

/**
 * A dialog that grows out of whatever opened it, and shrinks back into it.
 *
 * Adapted from Motion Primitives' Morphing Dialog
 * (https://motion-primitives.com/docs/morphing-dialog), with these changes for
 * Volcon:
 *
 * - The trigger is a focusable element rather than a `<button>`, so it can hold
 *   buttons and sliders of its own. A press that starts on one of those - any
 *   element marked `data-morphing-dialog-ignore` - is left to it, including a
 *   slider drag that ends somewhere else on the trigger.
 * - It opens below the title bar, and closes on a press of its backdrop rather
 *   than any press outside it, so the window's own buttons and anything the
 *   dialog opens over itself (a menu, a select) keep working.
 * - It can be controlled, so something other than its trigger can open it.
 * - Square, with the app's backdrop and icons.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react"
import { createPortal } from "react-dom"
import {
  AnimatePresence,
  motion,
  MotionConfig,
  type Transition,
  type Variant,
} from "motion/react"
import { RiCloseLine } from "@remixicon/react"

import { cn } from "@/lib/utils"

/** Marks a control inside a trigger whose presses belong to it, not the dialog. */
export const MORPHING_DIALOG_IGNORE = "data-morphing-dialog-ignore"

const IGNORE_SELECTOR = `[${MORPHING_DIALOG_IGNORE}]`

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'

/** Quick and nearly bounceless, to match the app's other screen changes. */
const defaultTransition: Transition = {
  type: "spring",
  bounce: 0.05,
  duration: 0.3,
}

type MorphingDialogContextValue = {
  isOpen: boolean
  setIsOpen: (open: boolean) => void
  uniqueId: string
  triggerRef: RefObject<HTMLDivElement | null>
}

const MorphingDialogContext = createContext<MorphingDialogContextValue | null>(
  null
)

function useMorphingDialog() {
  const context = useContext(MorphingDialogContext)

  if (!context) {
    throw new Error("useMorphingDialog must be used within a MorphingDialog")
  }

  return context
}

function MorphingDialog({
  children,
  transition = defaultTransition,
  open,
  onOpenChange,
}: {
  children: ReactNode
  transition?: Transition
  /** Controlled open state; leave out to let the trigger manage it. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const isOpen = open ?? uncontrolledOpen
  const uniqueId = useId()
  const triggerRef = useRef<HTMLDivElement>(null)

  const setIsOpen = useCallback(
    (next: boolean) => {
      if (open === undefined) {
        setUncontrolledOpen(next)
      }

      onOpenChange?.(next)
    },
    [open, onOpenChange]
  )

  const value = useMemo(
    () => ({ isOpen, setIsOpen, uniqueId, triggerRef }),
    [isOpen, setIsOpen, uniqueId]
  )

  return (
    <MorphingDialogContext.Provider value={value}>
      <MotionConfig transition={transition}>{children}</MotionConfig>
    </MorphingDialogContext.Provider>
  )
}

function startsOnControl(target: EventTarget | null) {
  return target instanceof Element && target.closest(IGNORE_SELECTOR) !== null
}

function MorphingDialogTrigger({
  children,
  className,
  style,
  "aria-label": ariaLabel,
}: {
  children: ReactNode
  className?: string
  style?: CSSProperties
  "aria-label"?: string
}) {
  const { setIsOpen, isOpen, uniqueId, triggerRef } = useMorphingDialog()
  // Where the press began, so a slider drag released over the rest of the
  // trigger doesn't count as a click on the trigger.
  const pressStartedOnControl = useRef(false)

  return (
    <motion.div
      ref={triggerRef}
      layoutId={`dialog-${uniqueId}`}
      role="button"
      tabIndex={0}
      className={cn(
        "relative cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        className
      )}
      style={style}
      onPointerDown={(event) => {
        pressStartedOnControl.current = startsOnControl(event.target)
      }}
      onClick={(event) => {
        const fromControl =
          pressStartedOnControl.current || startsOnControl(event.target)
        pressStartedOnControl.current = false

        if (!fromControl) {
          setIsOpen(true)
        }
      }}
      onKeyDown={(event) => {
        // Only when the trigger itself has focus: keys pressed on a control
        // inside it are that control's.
        if (event.target !== event.currentTarget) {
          return
        }

        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          setIsOpen(true)
        }
      }}
      aria-haspopup="dialog"
      aria-expanded={isOpen}
      aria-controls={`morphing-dialog-content-${uniqueId}`}
      aria-label={ariaLabel}
    >
      {children}
    </motion.div>
  )
}

function MorphingDialogContent({
  children,
  className,
  style,
}: {
  children: ReactNode
  className?: string
  style?: CSSProperties
}) {
  const { setIsOpen, uniqueId, triggerRef } = useMorphingDialog()
  const containerRef = useRef<HTMLDivElement>(null)

  // Escape closes; Tab stays inside.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        // Only an Escape pressed in this dialog. One pressed in a dialog opened
        // over it - a confirmation, say - is that dialog's to close.
        const active = document.activeElement

        if (
          !active ||
          active === document.body ||
          containerRef.current?.contains(active)
        ) {
          setIsOpen(false)
        }
        return
      }

      if (event.key !== "Tab" || !containerRef.current) {
        return
      }

      const focusable = [
        ...containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      ]
      const first = focusable[0]
      const last = focusable.at(-1)

      if (!first || !last) {
        event.preventDefault()
        return
      }

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [setIsOpen])

  // In on open, and back to the trigger on close. Content only exists while
  // the dialog is open, so mounting is opening.
  useEffect(() => {
    containerRef.current?.focus({ preventScroll: true })
    const trigger = triggerRef.current

    return () => trigger?.focus({ preventScroll: true })
  }, [triggerRef])

  return (
    <motion.div
      ref={containerRef}
      id={`morphing-dialog-content-${uniqueId}`}
      layoutId={`dialog-${uniqueId}`}
      // The dialog grows out of its trigger at full strength instead of
      // crossfading with it, and the trigger is hidden while it's open - kept
      // hidden through its own re-renders, which a crossfade wouldn't do.
      layoutCrossfade={false}
      tabIndex={-1}
      // Free to shrink below its content, so a tall dialog fits the window and
      // its scroll area takes up the difference.
      className={cn("relative min-h-0 overflow-hidden outline-none", className)}
      style={style}
      role="dialog"
      aria-modal="true"
      aria-labelledby={`morphing-dialog-title-${uniqueId}`}
    >
      {children}
    </motion.div>
  )
}

const subscribeToNothing = () => () => {}

function MorphingDialogContainer({ children }: { children: ReactNode }) {
  const { isOpen, uniqueId, setIsOpen } = useMorphingDialog()
  // The portal needs the document, which a prerender doesn't have.
  const isClient = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false
  )

  if (!isClient) {
    return null
  }

  return createPortal(
    <AnimatePresence initial={false} mode="sync">
      {isOpen ? (
        <>
          <motion.div
            key={`backdrop-${uniqueId}`}
            aria-hidden
            className="fixed inset-x-0 top-(--window-toolbar-height) bottom-0 z-50 bg-black/10 supports-backdrop-filter:backdrop-blur-xs"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          <div
            key={`frame-${uniqueId}`}
            // A column, so a dialog taller than the window is shrunk to fit it
            // and the scroll area inside has a real height to scroll within.
            className="fixed inset-x-0 top-(--window-toolbar-height) bottom-0 z-50 flex flex-col items-center justify-center p-6"
            onPointerDown={(event) => {
              // The backdrop itself, not anything sitting on it.
              if (event.target === event.currentTarget) {
                setIsOpen(false)
              }
            }}
          >
            {children}
          </div>
        </>
      ) : null}
    </AnimatePresence>,
    document.body
  )
}

/**
 * A part of the trigger that travels into the dialog as itself, matched by
 * `name`: render one in the trigger and one in the dialog, and the dialog's
 * grows out of the trigger's. Best between parts the same size and shape, which
 * then simply move - an icon tile, a button tile.
 */
function MorphingDialogShared({
  name,
  children,
  className,
  style,
}: {
  name: string
  children: ReactNode
  className?: string
  style?: CSSProperties
}) {
  const { uniqueId } = useMorphingDialog()

  return (
    <motion.div
      layoutId={`dialog-${name}-${uniqueId}`}
      // Travels at full strength rather than crossfading with its other half.
      layoutCrossfade={false}
      className={className}
      style={style}
    >
      {children}
    </motion.div>
  )
}

function MorphingDialogTitle({
  children,
  className,
  style,
}: {
  children: ReactNode
  className?: string
  style?: CSSProperties
}) {
  const { uniqueId } = useMorphingDialog()

  return (
    <motion.div
      id={`morphing-dialog-title-${uniqueId}`}
      layoutId={`dialog-title-container-${uniqueId}`}
      className={className}
      style={style}
      layout
    >
      {children}
    </motion.div>
  )
}

function MorphingDialogSubtitle({
  children,
  className,
  style,
}: {
  children: ReactNode
  className?: string
  style?: CSSProperties
}) {
  const { uniqueId } = useMorphingDialog()

  return (
    <motion.div
      layoutId={`dialog-subtitle-container-${uniqueId}`}
      className={className}
      style={style}
    >
      {children}
    </motion.div>
  )
}

type PresenceVariants = { initial: Variant; animate: Variant; exit: Variant }

/** Fades in once the dialog has mostly grown, and out at once on close. */
const descriptionVariants: PresenceVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { delay: 0.1, duration: 0.15 } },
  exit: { opacity: 0, transition: { duration: 0.05 } },
}

function MorphingDialogDescription({
  children,
  className,
  variants = descriptionVariants,
}: {
  children: ReactNode
  className?: string
  variants?: PresenceVariants
}) {
  return (
    <motion.div
      variants={variants}
      className={className}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      {children}
    </motion.div>
  )
}

function MorphingDialogClose({
  className,
  label = "Close",
}: {
  className?: string
  label?: string
}) {
  const { setIsOpen } = useMorphingDialog()

  return (
    <motion.button
      type="button"
      aria-label={label}
      onClick={() => setIsOpen(false)}
      className={cn(
        "absolute top-3 right-3 z-10 flex size-8 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        className
      )}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { delay: 0.1 } }}
      exit={{ opacity: 0, transition: { duration: 0 } }}
    >
      <RiCloseLine className="size-5" />
    </motion.button>
  )
}

export {
  MorphingDialog,
  MorphingDialogClose,
  MorphingDialogContainer,
  MorphingDialogContent,
  MorphingDialogDescription,
  MorphingDialogShared,
  MorphingDialogSubtitle,
  MorphingDialogTitle,
  MorphingDialogTrigger,
  useMorphingDialog,
}
