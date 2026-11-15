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
import { groupNavigation, type NavigationLink } from "@/lib/ui/navigation-groups"

export type NavSubItem =
  | { title: string; url: string; groupLabel?: never }
  | { groupLabel: string; title?: never; url?: never }

export type NavSection = {
  title: string
  url: string
  icon?: LucideIcon
  items?: NavSubItem[]
  collapseGroups?: boolean
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
          activeSection = section.url
        }
      }
      // Fall back to the section root when no leaf matches (e.g. a detail
      // route like /dashboard/equipment/[id] that has no link of its own).
      const sectionLen = matchLength(pathname, section.url)
      if (sectionLen > best) {
        best = sectionLen
        activeUrl = undefined
        activeSection = section.url
      }
    }

    return { activeUrl, activeSection }
  }, [items, pathname])

  // Manual expand/collapse wins until the next navigation, at which point the
  // section you landed in opens itself again.
  const [expansion, setExpansion] = React.useState<{ path: string; values: Record<string, boolean> }>({ path: pathname, values: {} })
  const overrides = expansion.path === pathname ? expansion.values : {}
  const renderLink = (subItem: NavigationLink) => (
    <SidebarMenuSubItem key={subItem.url}>
      <SidebarMenuSubButton asChild isActive={subItem.url === activeUrl}>
        <Link href={subItem.url} aria-current={subItem.url === activeUrl ? "page" : undefined}>
          <span>{subItem.title}</span>
        </Link>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  )

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{t("platform")}</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => {
          const isSectionActive = activeSection === item.url
          const isOpen = overrides[item.url] ?? isSectionActive

          return (
            <Collapsible
              key={item.url}
              asChild
              open={isOpen}
              onOpenChange={(open) =>
                setExpansion((prev) => ({ path: pathname, values: { ...(prev.path === pathname ? prev.values : {}), [item.url]: open } }))
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
                    {groupNavigation(item.items ?? []).map(group =>
                      item.collapseGroups && group.label ? (
                        <SidebarMenuSubItem key={group.label}>
                          <details key={`${group.label}:${pathname}`} open={group.items.some(link => link.url === activeUrl)}>
                            <summary className="cursor-pointer rounded-md px-2 py-2 text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-ring">
                              {group.label}
                            </summary>
                            <SidebarMenuSub className="mx-1 mr-0">{group.items.map(renderLink)}</SidebarMenuSub>
                          </details>
                        </SidebarMenuSubItem>
                      ) : <React.Fragment key={group.label ?? "root"}>
                        {group.label && <li className="px-2 pt-3 pb-1 text-xs font-medium text-muted-foreground">{group.label}</li>}
                        {group.items.map(renderLink)}
                      </React.Fragment>
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
