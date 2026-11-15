import { describe, expect, it } from "vitest";
import { groupNavigation } from "@/lib/ui/navigation-groups";

describe("navegación progresiva sin perder destinos", () => {
  const items = [
    { title: "Panel", url: "/dashboard/inventory" },
    { groupLabel: "Operar" },
    { title: "Conteo", url: "/dashboard/inventory/stock-count" },
    { groupLabel: "Comprar" },
    { title: "Órdenes", url: "/dashboard/inventory/purchase-orders" },
    { title: "Proveedores", url: "/dashboard/inventory/suppliers" },
  ];
  it("conserva el orden, enlaces y etiquetas al agrupar", () => {
    expect(groupNavigation(items)).toEqual([
      { label: null, items: [items[0]] },
      { label: "Operar", items: [items[2]] },
      { label: "Comprar", items: [items[4], items[5]] },
    ]);
  });
  it("no crea grupos vacíos cuando el filtrado por rol quita enlaces", () => {
    expect(groupNavigation([{ groupLabel: "Configurar" }])).toEqual([]);
    expect(groupNavigation([])).toEqual([]);
  });
});
