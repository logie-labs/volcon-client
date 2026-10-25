"use client"

import type { SettingsNavGroup, SettingsSectionId } from "../settings-registry"
import { SearchForm } from "./sidebar-search"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

type SettingsSidebarProps = React.ComponentProps<"aside"> & {
  /** The page showing, or null while search results are. */
  activeId: SettingsSectionId | null
  query: string
  onQueryChange: (value: string) => void
  onSubmitQuery: () => void
  onSelectSection: (id: SettingsSectionId) => void
  groups: SettingsNavGroup[]
}

export function SettingsSidebar({
  className,
  activeId,
  query,
  onQueryChange,
  onSubmitQuery,
  onSelectSection,
  groups,
  ...props
}: SettingsSidebarProps) {
  return (
    <aside
      className={cn(
        "no-sidebar-transition flex h-full w-[min(18rem,calc(100%-3rem))] shrink-0 flex-col border-r bg-muted/20 text-sm text-foreground",
        className
      )}
      {...props}
    >
      <div className="border-b p-3">
        <SearchForm value={query} onValueChange={onQueryChange} onSubmit={onSubmitQuery} />
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <nav aria-label="Settings pages" className="flex flex-col gap-1 p-2">
          {groups.map((group) => (
            <section key={group.id} className="px-1 py-2">
              <h2 className="px-2 pb-2 text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">
                {group.title}
              </h2>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const active = activeId === item.id

                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-current={active ? "page" : undefined}
                      onClick={() => onSelectSection(item.id)}
                      className={cn(
                        "flex w-full items-center gap-3 border-l-2 border-transparent p-2 text-left transition-all duration-100 outline-none hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-ring/50",
                        active && "border-primary bg-muted!"
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-7 shrink-0 items-center justify-center text-muted-foreground transition-colors",
                          active && "text-foreground"
                        )}
                      >
                        <item.icon className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1 truncate">{item.title}</span>
                    </button>
                  )
                })}
              </div>
            </section>
          ))}
        </nav>
      </ScrollArea>
    </aside>
  )
}
