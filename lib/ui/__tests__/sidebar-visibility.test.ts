import { describe, expect, it } from "vitest";
import { hasAccess, type UserRole } from "@/lib/rbac/permissions";
import { filterSidebarSections } from "@/lib/ui/sidebar-visibility";
import { APP_SIDEBAR_NAV } from "@/components/app-sidebar";

const ALL_ROLES: UserRole[] = [
  "SUPER_ADMIN",
  "OWNER",
  "ADMIN",
  "GERENTE",
  "SUPERVISOR",
  "EMPLEADO",
  "READONLY",
];

function collectLinks(role: UserRole): string[] {
  const sections = filterSidebarSections(role, APP_SIDEBAR_NAV);
  const urls: string[] = [];
  for (const section of sections) {
    for (const item of section.items ?? []) {
      if (!("groupLabel" in item) && typeof item.url === "string") {
        urls.push(item.url);
      }
    }
  }
  return urls;
}

describe("Task 12: Sidebar visibility derived from ROUTE_PERMISSIONS", () => {
  it.each(ALL_ROLES)(
    "ZERO-403 INVARIANT: every visible sidebar link for %s passes hasAccess()",
    (role) => {
      const sections = filterSidebarSections(role, APP_SIDEBAR_NAV);
      expect(sections.length).toBeGreaterThan(0);

      for (const section of sections) {
        const items = section.items ?? [];
        const links = items.filter((item) => !("groupLabel" in item));
        expect(links.length, `${role} section ${section.title} must not be empty`).toBeGreaterThan(0);

        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if ("groupLabel" in item) {
            const next = items[i + 1];
            expect(next && !("groupLabel" in next), `${role} orphan groupLabel ${item.groupLabel}`).toBe(true);
          } else {
            expect(hasAccess(role, item.url), `${role} → ${item.url}`).toBe(true);
          }
        }
      }
    },
  );

  it("EMPLEADO sees Flujos de Trabajo (incl. Mis Tareas) and Personal self-service (Cambios de Turno, Vacaciones, Permisos), never management routes", () => {
    const urls = collectLinks("EMPLEADO");
    expect(urls).toContain("/dashboard/workflows");
    expect(urls).toContain("/dashboard/my-tasks");
    expect(urls).toContain("/dashboard/execute");
    expect(urls).toContain("/dashboard/incidents");
    expect(urls).toContain("/dashboard/evidence");
    expect(urls).toContain("/dashboard/labor/shift-changes");
    expect(urls).toContain("/dashboard/labor/vacations");
    expect(urls).toContain("/dashboard/labor/leave");

    // Must NOT see network command, builder, history, finance, employees, company
    expect(urls).not.toContain("/dashboard");
    expect(urls).not.toContain("/dashboard/builder");
    expect(urls).not.toContain("/dashboard/workflows/history");
    expect(urls).not.toContain("/dashboard/employees");
    expect(urls).not.toContain("/dashboard/finance");
    expect(urls).not.toContain("/dashboard/team");
  });

  it("GERENTE sees /dashboard/team under Organización, never /dashboard/executive or /dashboard/compliance/payroll or /dashboard/company/operating-config", () => {
    const urls = collectLinks("GERENTE");
    expect(urls).toContain("/dashboard/team");
    expect(urls).toContain("/dashboard/builder");
    expect(urls).toContain("/dashboard/budgets");
    expect(urls).not.toContain("/dashboard/executive");
    expect(urls).not.toContain("/dashboard/compliance/payroll");
    expect(urls).not.toContain("/dashboard/company/operating-config");
    expect(urls).not.toContain("/dashboard/company/subscription");
  });

  it("SUPERVISOR sees Caja Chica and Cortes de Ventas, never Constructor/Plantillas or corporate Finance", () => {
    const urls = collectLinks("SUPERVISOR");
    expect(urls).toContain("/dashboard/finance/petty-cash");
    expect(urls).toContain("/dashboard/sales");
    expect(urls).not.toContain("/dashboard/builder");
    expect(urls).not.toContain("/dashboard/builder/templates");
    expect(urls).not.toContain("/dashboard/finance");
    expect(urls).not.toContain("/dashboard/finance/expenses");
    expect(urls).not.toContain("/dashboard/budgets");
    expect(urls).not.toContain("/dashboard/team");
  });

  it("SUPER_ADMIN, OWNER, and ADMIN see Dirección & P&L and Nómina", () => {
    for (const role of ["SUPER_ADMIN", "OWNER", "ADMIN"] as UserRole[]) {
      const urls = collectLinks(role);
      expect(urls, role).toContain("/dashboard/executive");
      expect(urls, role).toContain("/dashboard/compliance/payroll");
      expect(urls, role).toContain("/dashboard/company/subscription");
    }
  });
});
