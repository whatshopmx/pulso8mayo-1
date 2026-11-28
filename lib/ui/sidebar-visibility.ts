import { hasAccess, type UserRole } from "@/lib/rbac/permissions";

export type SidebarNavChild =
  | { groupLabel: string }
  | { title: string; url: string; [key: string]: unknown };

export interface SidebarNavSection {
  title: string;
  url: string;
  items?: SidebarNavChild[];
  [key: string]: unknown;
}

/**
 * Filtra las secciones e ítems del sidebar derivando visibilidad directamente
 * desde `ROUTE_PERMISSIONS` (`hasAccess`).
 *
 * Garantías:
 * 1. Ningún enlace renderizado en el sidebar puede apuntar a una ruta 403.
 * 2. Las secciones sin hijos visibles se ocultan por completo.
 * 3. Los separadores `groupLabel` huérfanos (sin enlaces debajo) se eliminan.
 * 4. `EMPLEADO` no ve "Comando de Red" (`/dashboard`), pues aterriza en
 *    `/dashboard/workflows`.
 */
export function filterSidebarSections<T extends SidebarNavSection>(
  role: UserRole,
  sections: readonly T[],
): T[] {
  const result: T[] = [];

  for (const section of sections) {
    if (role === "EMPLEADO" && section.url === "/dashboard") {
      continue;
    }

    const rawItems = section.items ?? [];
    const allowedItems = rawItems.filter((item) => {
      if ("groupLabel" in item && typeof item.groupLabel === "string") {
        return true;
      }
      const url = (item as { url?: string }).url;
      if (!url) return false;
      return hasAccess(role, url);
    });

    // Eliminar groupLabels que quedaron sin enlaces visibles debajo
    const cleanedItems: SidebarNavChild[] = [];
    for (let i = 0; i < allowedItems.length; i++) {
      const current = allowedItems[i];
      if ("groupLabel" in current && typeof current.groupLabel === "string") {
        const next = allowedItems[i + 1];
        if (!next || ("groupLabel" in next && typeof next.groupLabel === "string")) {
          continue;
        }
      }
      cleanedItems.push(current);
    }

    const hasLinkItem = cleanedItems.some(
      (item) => !("groupLabel" in item) && Boolean((item as { url?: string }).url),
    );
    if (!hasLinkItem) {
      continue;
    }

    result.push({
      ...section,
      items: cleanedItems,
    });
  }

  return result;
}

/** Compatibilidad retroactiva para consultas rápidas de visibilidad por sección. */
export function isSidebarSectionVisible(role: UserRole, url: string): boolean {
  if (role === "EMPLEADO") {
    return url === "/dashboard/workflows" || url === "/dashboard/labor";
  }
  if (role === "READONLY") {
    return ["/dashboard", "/dashboard/compliance", "/dashboard/performance"].includes(url);
  }
  if (role === "SUPERVISOR") {
    return url !== "/dashboard/company";
  }
  return true;
}
