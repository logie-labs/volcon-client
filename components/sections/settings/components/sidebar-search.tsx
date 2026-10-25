"use client"

import { Search } from "lucide-react"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type SearchFormProps = {
  value: string
  onValueChange: (value: string) => void
  /** Enter: open the best match. */
  onSubmit?: () => void
}

export function SearchForm({ value, onValueChange, onSubmit }: SearchFormProps) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit?.()
      }}
      className="relative"
    >
      <Label htmlFor="search-settings" className="sr-only">
        Search settings
      </Label>
      <Input
        id="search-settings"
        type="search"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && value) {
            event.preventDefault()
            onValueChange("")
          }
        }}
        placeholder="Search settings..."
        autoComplete="off"
        spellCheck={false}
        className="pl-8 [&::-webkit-search-cancel-button]:hidden"
      />
      <Search className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 opacity-50 select-none" />
    </form>
  )
}
