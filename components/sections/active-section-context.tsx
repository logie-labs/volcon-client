"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

import { SectionKey, sections } from "@/components/sections/index";
import { loadSettingsConfig } from "@/components/sections/settings/settings-config";
import { registerSectionSwitcher, sectionShown, startAt } from "@/lib/navigation-history";

const activeSectionStorageKey = "volcon.active-section";
const defaultSection: SectionKey = "mapping";

function isSectionKey(value: string | null): value is SectionKey {
  return value !== null && value in sections;
}

type ActiveSectionContextValue = {
  active: SectionKey;
  setActive: (section: SectionKey) => void;
  subscribeReselect: (section: SectionKey, listener: () => void) => () => void;
};

const ActiveSectionContext = createContext<ActiveSectionContextValue | null>(null);

export function ActiveSectionProvider({
  children,
  initialActive,
}: {
  children: React.ReactNode;
  initialActive?: SectionKey;
}) {
  const fallback = initialActive ?? defaultSection;
  const [active, setActive] = useState<SectionKey>(fallback);
  const reselectListeners = useRef(new Map<SectionKey, Set<() => void>>());
  // History only follows once the screen the app opens on is settled, so the
  // default it renders first doesn't become a step back.
  const historyStarted = useRef(false);

  useEffect(() => {
    if (historyStarted.current) {
      sectionShown(active);
    }
  }, [active]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const opening = (() => {
      if (!loadSettingsConfig().startup.reopenLastSection) {
        return null;
      }

      const storedSection = window.localStorage.getItem(activeSectionStorageKey);

      if (isSectionKey(storedSection)) {
        return storedSection;
      }

      if (storedSection !== null) {
        window.localStorage.setItem(activeSectionStorageKey, defaultSection);
      }

      return null;
    })();

    // History starts where the app opens, before the screen has switched to
    // it, so the switch finds itself already recorded.
    startAt(opening ?? fallback);
    historyStarted.current = true;

    if (opening) {
      queueMicrotask(() => setActive(opening));
    }
  }, [fallback]);

  // Going back or forward switches screens directly: not as a pick in the
  // sidebar, which would go back to a screen's top level if it's already
  // showing.
  useEffect(
    () =>
      registerSectionSwitcher((section) => {
        setActive(section);

        if (typeof window !== "undefined") {
          window.localStorage.setItem(activeSectionStorageKey, section);
        }
      }),
    [],
  );

  const updateActiveSection = (section: SectionKey) => {
    // Picking the section that's already showing is a request to go back to
    // its top level, the way tapping the current tab does on a phone.
    if (section === active) {
      reselectListeners.current.get(section)?.forEach((listener) => listener());
      return;
    }

    setActive(section);

    if (typeof window !== "undefined") {
      window.localStorage.setItem(activeSectionStorageKey, section);
    }
  };

  const subscribeReselect = useCallback((section: SectionKey, listener: () => void) => {
    const listeners = reselectListeners.current.get(section) ?? new Set<() => void>();
    listeners.add(listener);
    reselectListeners.current.set(section, listeners);

    return () => {
      listeners.delete(listener);
    };
  }, []);

  return (
    <ActiveSectionContext.Provider
      value={{ active, setActive: updateActiveSection, subscribeReselect }}
    >
      {children}
    </ActiveSectionContext.Provider>
  );
}

export function useActiveSection() {
  const context = useContext(ActiveSectionContext);

  if (!context) {
    throw new Error("useActiveSection must be used within ActiveSectionProvider");
  }

  return context;
}

/**
 * Runs `onReselect` when `section` is picked again while it's already showing,
 * so a section can go back to its top level the way a phone's tabs do.
 */
export function useSectionReselect(section: SectionKey, onReselect: () => void) {
  const { subscribeReselect } = useActiveSection();
  const handler = useRef(onReselect);

  useEffect(() => {
    handler.current = onReselect;
  });

  useEffect(
    () => subscribeReselect(section, () => handler.current()),
    [section, subscribeReselect],
  );
}
