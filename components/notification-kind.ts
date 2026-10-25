import {
  RiCheckLine,
  RiCloseCircleLine,
  RiErrorWarningLine,
  RiInformationLine,
} from "@remixicon/react"

import type { NotificationKind } from "@/lib/notifications"

/**
 * How each kind looks wherever a notification is drawn. The colour is carried
 * by the icon alone, so a message reads as a message rather than as the title
 * bar or the row changing state.
 */
export const notificationKindStyle: Record<
  NotificationKind,
  { icon: typeof RiCheckLine; tone: string; dot: string; label: string }
> = {
  success: {
    icon: RiCheckLine,
    tone: "text-primary",
    dot: "bg-primary",
    label: "Done",
  },
  error: {
    icon: RiCloseCircleLine,
    tone: "text-destructive",
    dot: "bg-destructive",
    label: "Failed",
  },
  warning: {
    icon: RiErrorWarningLine,
    tone: "text-amber-500",
    dot: "bg-amber-500",
    label: "Warning",
  },
  info: {
    icon: RiInformationLine,
    tone: "text-foreground/70",
    dot: "bg-foreground/70",
    label: "Note",
  },
}

/** Worst first, which is the order somebody scanning a log cares about. */
export const notificationKinds: NotificationKind[] = [
  "error",
  "warning",
  "success",
  "info",
]
