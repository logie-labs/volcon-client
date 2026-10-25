"use client"

import { createContext, useContext, useEffect, useState, type ReactNode } from "react"

type ToolbarIndicatorContextValue = {
  indicator: ReactNode | null
  setIndicator: (indicator: ReactNode | null) => void
}

const ToolbarIndicatorContext = createContext<ToolbarIndicatorContextValue | null>(null)

export function ToolbarIndicatorProvider({ children }: { children: ReactNode }) {
  const [indicator, setIndicator] = useState<ReactNode | null>(null)

  return (
    <ToolbarIndicatorContext.Provider value={{ indicator, setIndicator }}>
      {children}
    </ToolbarIndicatorContext.Provider>
  )
}

export function useToolbarIndicator() {
  const context = useContext(ToolbarIndicatorContext)

  if (!context) {
    throw new Error("useToolbarIndicator must be used within ToolbarIndicatorProvider")
  }

  return context
}

/**
 * Lets a section publish content into the window toolbar for as long as it's mounted/relevant,
 * clearing it automatically on unmount or when `indicator` becomes null.
 */
export function useSetToolbarIndicator(indicator: ReactNode | null) {
  const { setIndicator } = useToolbarIndicator()

  useEffect(() => {
    setIndicator(indicator)

    return () => setIndicator(null)
  }, [indicator, setIndicator])
}
