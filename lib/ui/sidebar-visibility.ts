import type { Role } from "@/lib/permissions";

/** Visibility uses route identity so editorial label changes cannot remove access. */
export function isSidebarSectionVisible(role: Role, url: string): boolean {
  if (role === "EMPLEADO") return url === "/dashboard/workflows";
  if (role === "READONLY") return ["/dashboard", "/dashboard/compliance", "/dashboard/performance"].includes(url);
  if (role === "GERENTE" || role === "SUPERVISOR") return url !== "/dashboard/company";
  return true;
}
