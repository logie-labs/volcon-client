"use client";

import { useEffect } from "react";

import { RiFireLine } from "@remixicon/react";
import { Sidebar } from "@/components/sidebar";
import { SectionShell } from "@/components/sections/section-shell";
import { useActiveSection } from "@/components/sections/active-section-context";
import { WindowToolbar } from "@/components/window-toolbar";
import { CommandPalette } from "@/components/command-palette/command-palette";
import { useAppCommands } from "@/components/command-palette/app-commands";
import { useRegisterCommands } from "@/components/command-palette/command-palette-context";
import { startSettingsSync, useSettingsConfig } from "@/components/sections/settings/settings-config";
import { SettingsUndoDialog } from "@/components/sections/settings/settings-undo";
import { goBack, goForward } from "@/lib/navigation-history";
import { startUpdateChecks } from "@/lib/updates";
import { useTheme } from "next-themes";

/** The mouse's side buttons, as `MouseEvent.button` numbers them. */
const MOUSE_BACK = 3;
const MOUSE_FORWARD = 4;

export default function Page() {
  const { active, setActive } = useActiveSection();
  const settings = useSettingsConfig();
  const { mouseButtons, altArrows } = settings.navigation;
  const { setTheme } = useTheme();

  // The theme follows the setting wherever it's changed - Settings, the command
  // palette, an Undo on the Notifications screen - not only while Settings is open.
  useEffect(() => {
    setTheme(settings.appearance.theme);
  }, [settings.appearance.theme, setTheme]);

  // The mouse's back and forward buttons step through where you've been,
  // while they're on in Settings.
  useEffect(() => {
    const isSideButton = (event: MouseEvent) =>
      event.button === MOUSE_BACK || event.button === MOUSE_FORWARD;

    // Kept from the webview whether they navigate here or not: left to it, its
    // own back and forward would take the window off the app's page entirely.
    const onDown = (event: MouseEvent) => {
      if (isSideButton(event)) {
        event.preventDefault();
      }
    };

    const onUp = (event: MouseEvent) => {
      if (!isSideButton(event)) {
        return;
      }

      event.preventDefault();

      if (!mouseButtons) {
        return;
      }

      if (event.button === MOUSE_BACK) {
        goBack();
      } else {
        goForward();
      }
    };

    window.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);

    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
    };
  }, [mouseButtons]);

  // Alt+Left and Alt+Right, the keyboard's back and forward.
  useEffect(() => {
    if (!altArrows) {
      return;
    }

    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return;
      }

      // Not while typing, where the arrows belong to the text.
      if ((event.target as HTMLElement | null)?.closest("input, textarea, [contenteditable='true']")) {
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goBack();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        goForward();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [altArrows]);

  // Screen-level commands live here because this is what owns the current screen
  // and stays mounted whichever one is showing.
  useRegisterCommands(useAppCommands({ setSection: setActive }));

  // Some settings are stored here but applied elsewhere - the controller and
  // logging settings in the backend, the startup ones in Windows - so they're
  // handed over on launch, on every change, and checked against what the
  // backend reports for as long as the window is open. This is the main window:
  // the only place that edits them, and so the only place that should be
  // telling anything else about them.
  useEffect(() => startSettingsSync(), []);

  // A look for a newer version, if Settings allows and it's been a day.
  useEffect(() => startUpdateChecks(), []);

  return (
    <div className="relative flex h-full overflow-hidden bg-background text-foreground">
      <WindowToolbar title={<RiFireLine className="h-4 w-4" />} />
      <main className="absolute inset-x-0 bottom-0 top-(--window-toolbar-height) flex overflow-hidden">
        <Sidebar active={active} onChange={setActive} />
        <SectionShell active={active} />
      </main>
      <CommandPalette />
      {/* Here rather than on the Settings screen: an Undo that asks first can
          be pressed from anywhere. */}
      <SettingsUndoDialog />
    </div>
  );
}