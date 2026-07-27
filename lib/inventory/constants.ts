export const CATEGORIES = [
  { value: "Materia Prima", label: "Materia Prima" },
  { value: "Producto Terminado", label: "Producto Terminado" },
  { value: "Ingredientes Secos", label: "Ingredientes Secos" },
  { value: "Frescos / Perecederos", label: "Frescos / Perecederos" },
  { value: "Limpieza", label: "Limpieza" },
  { value: "Empaque", label: "Empaque" },
  { value: "Equipamiento", label: "Equipamiento" },
  { value: "Insumo", label: "Insumo" },
  { value: "Otro", label: "Otro" },
] as const;

export const UNITS = [
  { value: "KG", label: "KG" },
  { value: "L", label: "L" },
  { value: "PIEZA", label: "Pieza / Unidad" },
  { value: "CAJA", label: "Caja" },
  { value: "BOLSA", label: "Bolsa" },
  { value: "OTRO", label: "Otro" },
] as const;

export const LOCATION_TYPES = [
    { value: "DRY_STORAGE", label: "Almacén Seco" },
    { value: "REFRIGERATOR", label: "Refrigerador" },
    { value: "FREEZER", label: "Congelador" },
    { value: "BAR", label: "Bar" },
    { value: "KITCHEN", label: "Cocina" },
    { value: "PRODUCTION", label: "Producción" },
    { value: "PACKAGING", label: "Empaque" },
    { value: "OTHER", label: "Otro" },
] as const;

export type Category = (typeof CATEGORIES)[number]["value"];
export type Unit = (typeof UNITS)[number]["value"];
export type LocationType = (typeof LOCATION_TYPES)[number]["value"];

export const ORG_TYPES = [
    { value: "CENTRAL", label: "Central / Almacén General" },
    { value: "BRANCH", label: "Sucursal" },
    { value: "VIRTUAL", label: "Virtual" },
    { value: "TRANSIT", label: "Tránsito" },
] as const;

export type OrgType = (typeof ORG_TYPES)[number]["value"];
