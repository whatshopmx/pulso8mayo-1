"use client"

import * as React from "react"
import { ChevronRight, type LucideIcon } from "lucide-react"
import { usePathname } from "next/navigation"
import { useTranslations } from "next-intl"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar"
import Link from "next/link"

export type NavSubItem =
  | { title: string; url: string; groupLabel?: never }
  | { groupLabel: string; title?: never; url?: never }

export type NavSection = {
  title: string
  url: string
  icon?: LucideIcon
  items?: NavSubItem[]
}

/**
 * How well `url` matches the current pathname, as a prefix length.
 * -1 = no match. Longer wins, so `/dashboard/inventory/products` beats
 * `/dashboard/inventory` and `/dashboard` never swallows the whole tree.
 */
function matchLength(pathname: string, url?: string): number {
  if (!url) return -1
  if (pathname === url) return url.length
  if (pathname.startsWith(url + "/")) return url.length
  return -1
}

export function NavMain({ items }: { items: NavSection[] }) {
  const t = useTranslations("navigation")
  const pathname = usePathname()

  // The single deepest matching leaf across every section: exactly one link
  // is ever highlighted, and the section that owns it is the active one.
  const { activeUrl, activeSection } = React.useMemo(() => {
    let best = -1
    let activeUrl: string | undefined
    let activeSection: string | undefined

    for (const section of items) {
      for (const subItem of section.items ?? []) {
        const len = matchLength(pathname, subItem.url)
        if (len > best) {
          best = len
          activeUrl = subItem.url
          activeSection = section.title
        }
      }
      // Fall back to the section root when no leaf matches (e.g. a detail
      // route like /dashboard/equipment/[id] that has no link of its own).
      const sectionLen = matchLength(pathname, section.url)
      if (sectionLen > best) {
        best = sectionLen
        activeUrl = undefined
        activeSection = section.title
      }
    }

    return { activeUrl, activeSection }
  }, [items, pathname])

  // Manual expand/collapse wins until the next navigation, at which point the
  // section you landed in opens itself again.
  const [overrides, setOverrides] = React.useState<Record<string, boolean>>({})
  React.useEffect(() => {
    setOverrides({})
  }, [pathname])

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{t("platform")}</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => {
          const isSectionActive = activeSection === item.title
          const isOpen = overrides[item.title] ?? isSectionActive

          return (
            <Collapsible
              key={item.title}
              asChild
              open={isOpen}
              onOpenChange={(open) =>
                setOverrides((prev) => ({ ...prev, [item.title]: open }))
              }
              className="group/collapsible"
            >
              <SidebarMenuItem>
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton
                    tooltip={item.title}
                    isActive={isSectionActive}
                    aria-current={isSectionActive ? "true" : undefined}
                  >
                    {item.icon && <item.icon />}
                    <span>{item.title}</span>
                    <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                  </SidebarMenuButton>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {item.items?.map((subItem, idx) =>
                      subItem.groupLabel ? (
                        <li
                          key={`group-${idx}`}
                          className="px-2 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground first:pt-1"
                        >
                          {subItem.groupLabel}
                        </li>
                      ) : (
                        <SidebarMenuSubItem key={subItem.title}>
                          <SidebarMenuSubButton
                            asChild
                            isActive={subItem.url === activeUrl}
                          >
                            <Link
                              href={subItem.url}
                              aria-current={
                                subItem.url === activeUrl ? "page" : undefined
                              }
                            >
                              <span>{subItem.title}</span>
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      )
                    )}
                  </SidebarMenuSub>
                </CollapsibleContent>
              </SidebarMenuItem>
            </Collapsible>
          )
        })}
      </SidebarMenu>
    </SidebarGroup>
  )
}
