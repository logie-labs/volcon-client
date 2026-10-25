import MappingSection from "./mapping/mapping";
import NotificationsSection from "./notifications/notifications";
import SettingsSection from "./settings/settings";

export const sections = {
  mapping: MappingSection,
  notifications: NotificationsSection,
  settings: SettingsSection,
} as const;

export const sectionLabels = {
  mapping: "mapping",
  notifications: "notifications",
  settings: "settings",
} as const;

export type SectionKey = keyof typeof sections;
