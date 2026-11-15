type NavigationEntry = { title?: string; url?: string; groupLabel?: string };
export type NavigationLink = { title: string; url: string };
export type NavigationGroup = { label: string | null; items: NavigationLink[] };

/** Preserve every destination while turning the existing headings into groups. */
export function groupNavigation(items: NavigationEntry[]): NavigationGroup[] {
  const groups: NavigationGroup[] = [{ label: null, items: [] }];
  for (const item of items) {
    if (item.groupLabel) groups.push({ label: item.groupLabel, items: [] });
    else if (item.title && item.url) groups[groups.length - 1].items.push({ title: item.title, url: item.url });
  }
  return groups.filter(group => group.items.length > 0);
}
