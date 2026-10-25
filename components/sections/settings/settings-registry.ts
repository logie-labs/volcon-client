import {
  RiArchive2Line,
  RiArrowLeftRightLine,
  RiBugLine,
  RiDownloadCloud2Line,
  RiEqualizer3Line,
  RiInformationLine,
  RiLayout2Line,
  RiNotification3Line,
  RiPaintBrushLine,
  RiShutDownLine,
  RiUsbLine,
  RiWindowLine,
} from "@remixicon/react"

import type { ComponentType } from "react"

import {
  AboutSection,
  AppearanceSection,
  BackupSection,
  BehaviourSection,
  ControllerSection,
  DiagnosticsSection,
  MappingSection,
  NavigationSection,
  NotificationsSection,
  OverlaySection,
  StartupSection,
  UpdatesSection,
} from "./components/settings-section-components"
import {
  settingsGroupTitles,
  settingsPages,
  type SettingsGroupId,
  type SettingsPageInfo,
  type SettingsSectionId,
} from "./settings-schema"

export type { SettingsGroupId, SettingsSectionId } from "./settings-schema"

export type SettingsSectionDefinition = SettingsPageInfo & {
  icon: ComponentType<{ className?: string }>
  component: ComponentType
}

export type SettingsNavGroup = {
  id: SettingsGroupId
  title: string
  items: SettingsSectionDefinition[]
}

/**
 * What each page looks like in the sidebar and what draws it. The Sections
 * pages use the same icons as the screens they belong to in the app's own
 * sidebar, so the two read as one.
 */
const pageUi: Record<SettingsSectionId, Pick<SettingsSectionDefinition, "icon" | "component">> = {
  appearance: { icon: RiPaintBrushLine, component: AppearanceSection },
  startup: { icon: RiShutDownLine, component: StartupSection },
  behaviour: { icon: RiWindowLine, component: BehaviourSection },
  navigation: { icon: RiArrowLeftRightLine, component: NavigationSection },
  overlay: { icon: RiLayout2Line, component: OverlaySection },
  mapping: { icon: RiEqualizer3Line, component: MappingSection },
  notifications: { icon: RiNotification3Line, component: NotificationsSection },
  controller: { icon: RiUsbLine, component: ControllerSection },
  diagnostics: { icon: RiBugLine, component: DiagnosticsSection },
  backup: { icon: RiArchive2Line, component: BackupSection },
  updates: { icon: RiDownloadCloud2Line, component: UpdatesSection },
  about: { icon: RiInformationLine, component: AboutSection },
}

export const settingsSections: SettingsSectionDefinition[] = settingsPages.map((page) => ({
  ...page,
  ...pageUi[page.id],
}))

export const settingsSectionMap = Object.fromEntries(
  settingsSections.map((section) => [section.id, section])
) as Record<SettingsSectionId, SettingsSectionDefinition>

export const settingsNavGroups: SettingsNavGroup[] = (
  Object.keys(settingsGroupTitles) as SettingsGroupId[]
).map((id) => ({
  id,
  title: settingsGroupTitles[id],
  items: settingsSections.filter((section) => section.group === id),
}))
