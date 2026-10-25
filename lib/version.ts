"use client"

import { invoke } from "@tauri-apps/api/core"

export async function appVersion(): Promise<string> {
  if (typeof window === "undefined") {
    return "unknown"
  }

  return invoke<string>("get_app_version")
}