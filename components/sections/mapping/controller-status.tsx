import React from "react";
import { TextMorph } from "@/components/ui/text-morph";

type Props = {
  state: "connected" | "busy" | "disconnected" | "waiting";
  className?: string;
  waitingLabel?: string;
  hideIndicator?: boolean;
};

export function ControllerStatus({ state, className, waitingLabel = "Waiting for Preset", hideIndicator = false }: Props) {
  const containerBg =
    state === "connected"
      ? "bg-primary/10"
      : state === "busy"
        ? "bg-amber-500/10"
        : state === "waiting"
        ? "bg-muted/30"
        : "bg-destructive/10";
  const dotBg =
    state === "connected"
      ? "bg-primary"
      : state === "busy"
        ? "bg-amber-500"
        : state === "waiting"
          ? "bg-muted-foreground"
          : "bg-destructive";
  const textColor =
    state === "connected"
      ? "text-primary"
      : state === "busy"
        ? "text-amber-500"
        : state === "waiting"
          ? "text-muted-foreground"
          : "text-destructive";
  const label =
    state === "connected"
      ? "Controller Connected"
      : state === "busy"
        ? "Controller In Use Elsewhere"
      : state === "waiting"
        ? waitingLabel
        : "Controller Disconnected";

  return (
    <div
      className={`flex flex-row items-center gap-2 h-full px-3 transition-colors duration-200 ${containerBg} ${className || ""}`}
      role="status"
      aria-live="polite"
    >
      {!hideIndicator ? (
        <div className={`size-2 ${dotBg} transition-colors duration-200`}>
          {/* The grey "waiting" light is off, so it stays still. */}
          {state !== "waiting" ? <div className={`size-2 ${dotBg} animate-ping`} /> : null}
        </div>
      ) : null}

      <TextMorph as="span" className={`${textColor} text-xs transition-colors duration-200`}>
        {label}
      </TextMorph>
    </div>
  );
}

export default ControllerStatus;
