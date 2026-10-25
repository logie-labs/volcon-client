import { getCurrentWindow } from "@tauri-apps/api/window"

import { hasTauriRuntime } from "./tauri-runtime"

const withWindow = async <T>(fn: (appWindow: ReturnType<typeof getCurrentWindow>) => Promise<T>) => {
  if (!hasTauriRuntime()) {
    return null
  }

  return fn(getCurrentWindow())
}

export const tauriWindow = {
  async minimize() {
    await withWindow((appWindow) => appWindow.minimize())
  },

  async close() {
    await withWindow((appWindow) => appWindow.close())
  },

  async toggleMaximize() {
    await withWindow(async (appWindow) => {
      const maximized = await appWindow.isMaximized()

      if (maximized) {
        await appWindow.unmaximize()
        return
      }

      await appWindow.maximize()
    })
  },

  async isMaximized() {
    return (await withWindow((appWindow) => appWindow.isMaximized())) ?? false
  },

  onResize(handler: () => void) {
    if (!hasTauriRuntime()) {
      return () => {}
    }

    const appWindow = getCurrentWindow()
    let unlisten: null | (() => void) = null

    appWindow.onResized(() => {
      handler()
    }).then((cleanup) => {
      unlisten = cleanup
    })

    return () => {
      if (unlisten) {
        unlisten()
      }
    }
  },
}
