import { invoke, type InvokeArgs } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { hasTauriRuntime } from "./tauri-runtime";

type EventCallback = (event: unknown) => void;

export type BridgeCommand =
  | "list_inputs"
  | "select_input"
  | "activate_preset"
  | "list_assignments"
  | "begin_learn"
  | "poll_learn"
  | "start_learn"
  | "assign_control"
  | "remove_control"
  | "set_app_levels"
  | "release_apps"
  | "set_volume_curve"
  | "set_deadzone"
  | "set_logging"
  | "preview_overlay"
  | "get_peaks"
  | "stop_peaks"
  | "refresh_sessions"
  | "get_state"
  | "ping";

export type AppLevel = {
  app: string;
  /** Per-app gain on top of the control's position, 0-1. */
  trim: number;
  muted: boolean;
};

export type ProcessDetails = {
  pid: number;
  name: string;
  executable_path?: string | null;
  icon?: string | null;
};

async function callBridge<T>(command: BridgeCommand, payload?: unknown) {
  if (!hasTauriRuntime()) {
    throw new Error("Not running under Tauri");
  }

  return invoke<T>("bridge_dispatch", {
    command,
    payload: payload ?? null,
  });
}

async function invokeNative<T>(command: string, payload?: InvokeArgs) {
  if (!hasTauriRuntime()) {
    throw new Error("Not running under Tauri");
  }

  return invoke<T>(command, payload ?? {});
}

export function invokeBridge<T>(command: BridgeCommand, payload?: unknown) {
  return callBridge<T>(command, payload);
}

export function listInputs() {
  return callBridge<{ ok: boolean; inputs: string[]; selected: string | null }>("list_inputs");
}

export function selectInput(portName: string) {
  return callBridge<{ ok: boolean; selected: string }>("select_input", { portName });
}

/**
 * Pushes a trim/mute edit straight at the audio thread. Deliberately does not
 * touch the config on disk, so it is cheap enough to call on every pointer move
 * of a trim slider; persistence rides along with the usual preset save.
 */
export function setAppLevels(control: number, apps: AppLevel[], value?: number) {
  return callBridge<{ ok: boolean; applied: number; value: number }>("set_app_levels", {
    control,
    apps,
    value,
  });
}

/**
 * Sets how a control's position maps to a volume level. Lives in the backend
 * because that mapping happens on the audio thread, between the MIDI message and
 * the mixer — the UI never sees the values in between.
 */
export function setVolumeCurve(enabled: boolean, strength: number) {
  return callBridge<{ ok: boolean; enabled: boolean; strength: number }>("set_volume_curve", {
    enabled,
    strength,
  });
}

/**
 * Sets how far a control at rest has to move, in percent of its travel, before
 * the movement counts; once it's moving, every step does. Applied in the MIDI
 * callback, so wobble from a noisy control never reaches the levels or the
 * overlay at all.
 */
export function setDeadzone(percent: number) {
  return callBridge<{ ok: boolean; percent: number }>("set_deadzone", { percent });
}

/**
 * Sets how much the backend writes to its log. Verbose adds every controller
 * message and volume change on top of the level. Answers with what's in force.
 */
export function setLogging(level: string, verbose: boolean) {
  return callBridge<{ ok: boolean; level: string; verbose: boolean }>("set_logging", {
    level,
    verbose,
  });
}

/**
 * Raises the overlay as though the last control used had moved, so where it
 * appears and how long it stays can be seen from Settings.
 */
export function previewOverlay() {
  return callBridge<{ ok: boolean; control: number }>("preview_overlay");
}

/**
 * The live left and right peak of each app, as linear amplitudes from 0 to 1.
 * Asking is what keeps the backend measuring, so this is polled for as long as
 * a level meter is on screen; an app with nothing playing reads as silence.
 */
export function getPeaks(apps: string[]) {
  return callBridge<{ ok: boolean; peaks: Record<string, [number, number]> }>("get_peaks", {
    apps,
  });
}

/**
 * Stops the backend measuring levels straight away and lets it release what it
 * was holding to do so, for when the last meter leaves the screen or meters are
 * turned off. Without it the backend still stops, a moment after the last poll.
 */
export function stopPeaks() {
  return callBridge<{ ok: boolean }>("stop_peaks");
}

/** Lifts any mute off apps whose assignment was just removed. */
export function releaseApps(apps: string[]) {
  return callBridge<{ ok: boolean; released: number }>("release_apps", { apps });
}

export function activatePreset(
  presetId: string,
  controllerId?: string,
  assignments?: Array<{
    control: number;
    app: string;
    label?: string | null;
    path?: string | null;
    trim?: number;
    muted?: boolean;
  }>,
) {
  return callBridge<{ ok: boolean; activePresetId: string; selected: string | null }>("activate_preset", {
    presetId,
    controllerId,
    assignments,
  });
}

export function listAssignments() {
  return callBridge<{ ok: boolean; assignments: Array<{ control: number; app: string; label?: string | null }> }>(
    "list_assignments",
  );
}

export function startLearn(timeoutSeconds?: number) {
  return callBridge<{ ok: boolean; control: number; value: number; sequence: number }>("start_learn", {
    timeoutSeconds,
  });
}

export function beginLearn() {
  return callBridge<{ ok: boolean; afterSequence: number }>("begin_learn");
}

export function pollLearn(afterSequence: number) {
  return callBridge<{
    ok: boolean;
    ready: boolean;
    control?: number;
    value?: number;
    sequence?: number;
  }>("poll_learn", {
    afterSequence,
  });
}

export function assignControl(control: number, app: string, label?: string, path?: string | null) {
  return callBridge<{ ok: boolean; assignments: Array<{ control: number; app: string; label?: string | null; path?: string | null }> }>(
    "assign_control",
    {
      control,
      app,
      label,
      path,
    },
  );
}

export function removeControl(control: number, app?: string) {
  return callBridge<{ ok: boolean; removed: number; assignments: Array<{ control: number; app: string; label?: string | null }> }>(
    "remove_control",
    {
      control,
      app,
    },
  );
}

export function refreshSessions() {
  return callBridge<{ ok: boolean; sessions: string[] }>("refresh_sessions");
}

export function listAudioSessions() {
  return invokeNative<ProcessDetails[]>("audio_list_sessions");
}

export function listRunningProcesses() {
  return invokeNative<ProcessDetails[]>("process_list_running");
}

/** Executable names of every running process. Cheap enough to poll. */
export function listRunningProcessNames() {
  return invokeNative<string[]>("process_list_running_names");
}

export function getProcessDetails(pid: number) {
  return invokeNative<ProcessDetails>("process_get_details", { pid });
}

export function getProcessIcon(pid: number) {
  return invokeNative<string | null>("process_get_icon", { pid });
}

export function getIconByPath(path: string) {
  return invokeNative<string | null>("process_get_icon_by_path", { path });
}

/**
 * An executable's icon drawn at `size` pixels from the largest image it holds,
 * so it stays sharp when shown large. A data URL, or null if it has none.
 */
export function getIconHd(path: string, size = 128) {
  return invokeNative<string | null>("process_get_icon_hd", { path, size });
}

export function getState() {
  return callBridge<{
    ok: boolean;
    selected: string | null;
    assignments: Array<{ control: number; app: string; label?: string | null }>;
    lastControl: number | null;
    lastValue: number | null;
    curve: { enabled: boolean; strength: number };
    /** Missing from builds older than the settings check. */
    deadzone?: number;
    /** Missing from builds older than the diagnostics settings. */
    logging?: { level: string; verbose: boolean };
  }>("get_state");
}

export type DiagnosticsInfo = {
  appVersion: string;
  tauriVersion: string;
  os: string;
  logDir: string | null;
  logging: { level: string; verbose: boolean };
  /** How the source folder stands right now; development builds only. */
  source?: SourceState | null;
};

export type SourceState = { commit: string; changed: boolean };

/** Versions, the OS and where the log is, for a bug report. */
export function getDiagnosticsInfo() {
  return invokeNative<DiagnosticsInfo>("diagnostics_info");
}

/** Opens the folder holding the app's log in Explorer. */
export function openLogsFolder() {
  return invokeNative<void>("open_logs_folder");
}

/**
 * Writes a settings backup to the Downloads folder, numbering the name rather
 * than overwriting an earlier one. Resolves to where it went.
 */
export function saveSettingsBackup(fileName: string, contents: string) {
  return invokeNative<string>("save_settings_backup", { fileName, contents });
}

/** Opens Explorer with the file selected. */
export function revealInExplorer(path: string) {
  return invokeNative<void>("reveal_in_explorer", { path });
}

/** Opens one of the app's own links in the default browser. */
export function openExternal(url: string) {
  return invokeNative<void>("open_external", { url });
}

/** Whether Windows starts Volcon when you sign in. */
export function getLaunchAtSignIn() {
  return invokeNative<boolean>("launch_at_sign_in");
}

/** Has Windows start Volcon at sign-in, or stop; answers with what Windows is set to now. */
export function setLaunchAtSignIn(enabled: boolean) {
  return invokeNative<boolean>("set_launch_at_sign_in", { enabled });
}

/** Where a downloaded update stands, as the backend reports it. */
export type UpdateDownloadState =
  | { phase: "idle" }
  | { phase: "downloading"; version: string; received: number; total: number }
  | { phase: "ready"; version: string; failedAtLaunch: boolean }
  | { phase: "failed"; version: string; reason: string };

export function getUpdateDownloadState() {
  return invokeNative<UpdateDownloadState>("update_state");
}

/** Starts downloading an update's installer, in the background. */
export function startUpdateDownload(request: {
  version: string;
  url: string;
  size: number;
  sha256: string | null;
}) {
  return invokeNative<void>("update_download", { request });
}

export function cancelUpdateDownload() {
  return invokeNative<void>("update_cancel");
}

export function discardUpdateDownload() {
  return invokeNative<void>("update_discard");
}

/** Installs the downloaded update: Volcon closes, and opens again updated. */
export function installUpdateNow() {
  return invokeNative<void>("update_install_now");
}

export function ping() {
  return callBridge<{ ok: boolean; message: string }>("ping");
}

export function listenEvents(cb: EventCallback) {
  if (!hasTauriRuntime()) return () => {};

  const unlisten = listen<unknown>("bridge:event", (e) => {
    cb(e.payload);
  });

  return async () => {
    const remove = await unlisten;
    if (typeof remove === "function") {
      remove();
    }
  };
}
