export const hasTauriRuntime = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window