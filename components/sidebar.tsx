"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { SectionKey } from "@/components/sections/index";
import { RiEqualizer3Line, RiNotification3Line, RiSettings3Line } from "@remixicon/react";
import { useUnreadCount } from "@/lib/notifications";
import { useSettingsConfig } from "@/components/sections/settings/settings-config";

interface Props {
  active: SectionKey;
  onChange: (key: SectionKey) => void;
}

function SidebarButton({
  id,
  icon,
  active,
  onChange,
  marked = false,
  tooltip,
}: Props & {
  id: SectionKey;
  icon: React.ReactNode;
  /** A dot in the corner, for something waiting to be looked at. */
  marked?: boolean;
  /** Names the screen on hover, unless turned off in Settings. */
  tooltip: boolean;
}) {
  const isActive = active === id;
  const name = id.charAt(0).toUpperCase() + id.slice(1);

  return (
    <Tooltip disableHoverablePopup disabled={!tooltip}>
      <TooltipTrigger
        render={
          <button
            className={`w-14 h-14 transition-all hover:opacity-70 flex items-center justify-center relative hover: group ${
                    isActive ? "opacity-100!" : "opacity-50"
                }`}
            // Named for a screen reader whether the tooltip shows or not.
            aria-label={name}
            aria-current={isActive ? "page" : undefined}
            onClick={() => onChange(id)}
          />
        }
      >

          <div
              className={`transition-all! `}
          >
            {icon}
          </div>

          {/* Which screen is showing, beyond the icon being brighter: a line
              at the edge that grows into view when it's picked. */}
          <span
            aria-hidden
            className={`pointer-events-none absolute left-0 w-[2px] bg-foreground transition-all duration-200 ease-in-out ${
              isActive ? "h-3 opacity-100" : "h-1 opacity-0"
            }`}
          />

          {marked ? (
            <span
              aria-hidden
              className="pointer-events-none absolute top-3.5 right-3.5 size-1.5 bg-primary"
            />
          ) : null}
      </TooltipTrigger>

      <TooltipContent
        side="right"
        sideOffset={-10}
        className="select-none pointer-events-none! capitalize"
      >
        <p>{name}</p>
      </TooltipContent>
    </Tooltip>
  );
}

export function Sidebar({ active, onChange }: Props) {
  const unread = useUnreadCount();
  const settings = useSettingsConfig();
  const { unreadBadge } = settings.notifications;
  const tooltip = settings.appearance.sidebarTooltips;

  return (
    <TooltipProvider>
      <div
        className="w-14 flex flex-col justify-between items-center border-r bg-muted/30 no-sidebar-transition"
        style={{ height: "calc(100svh - var(--window-toolbar-height))" }}
      >
        <div className="flex flex-col gap-2">
          <SidebarButton id="mapping" icon={<RiEqualizer3Line />} active={active} onChange={onChange} tooltip={tooltip} />
        </div>

        <div className="flex flex-col gap-2">
          {/* A dot rather than a count: the question is only whether anything
              happened while you were elsewhere. */}
          <SidebarButton
            id="notifications"
            icon={<RiNotification3Line />}
            active={active}
            onChange={onChange}
            marked={unreadBadge && unread > 0 && active !== "notifications"}
            tooltip={tooltip}
          />
          <SidebarButton id="settings" icon={<RiSettings3Line />} active={active} onChange={onChange} tooltip={tooltip} />
        </div>
      </div>
    </TooltipProvider>
  );
}
