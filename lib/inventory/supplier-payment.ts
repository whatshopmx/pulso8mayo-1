// lib/inventory/supplier-payment.ts
//
// Vocabulario único de condiciones de pago a proveedor: forma de pago y días de
// crédito. Un solo módulo para el formulario, el detalle y la lista — la lección
// de `waste-labels.ts`, donde tres mapas locales se fueron desincronizando hasta
// que uno perdió un valor del enum.
//
// Los códigos SAT permiten conciliar contra el CFDI recibido el día que
// `invoices` guarde su `formaPago` (hoy no la guarda).

import type { supplierPaymentMethodEnum } from "@/lib/db/schema";

export type SupplierPaymentMethod =
  (typeof supplierPaymentMethodEnum.enumValues)[number];

/** Etiqueta ES + código del catálogo c_FormaPago del SAT. */
export const SUPPLIER_PAYMENT_METHODS: Record<
  SupplierPaymentMethod,
  { label: string; satCode: string }
> = {
  TRANSFER: { label: "Transferencia electrónica", satCode: "03" },
  CASH: { label: "Efectivo", satCode: "01" },
  CHECK: { label: "Cheque nominativo", satCode: "02" },
  CREDIT_CARD: { label: "Tarjeta de crédito", satCode: "04" },
  DEBIT_CARD: { label: "Tarjeta de débito", satCode: "28" },
  OTHER: { label: "Otra", satCode: "99" },
};

/** Opciones para un Select, en orden de uso real en el sector. */
export const SUPPLIER_PAYMENT_METHOD_OPTIONS = (
  Object.keys(SUPPLIER_PAYMENT_METHODS) as SupplierPaymentMethod[]
).map((value) => ({
  value,
  label: SUPPLIER_PAYMENT_METHODS[value].label,
  satCode: SUPPLIER_PAYMENT_METHODS[value].satCode,
}));

/** Null/desconocido → "Sin especificar": no se asume transferencia. */
export function paymentMethodLabel(method: string | null | undefined): string {
  if (!method) return "Sin especificar";
  return SUPPLIER_PAYMENT_METHODS[method as SupplierPaymentMethod]?.label ?? method;
}

/** 0 (o null) = contado; de otro modo, crédito a N días. */
export function paymentTermsLabel(days: number | null | undefined): string {
  const d = days ?? 0;
  return d === 0 ? "Contado" : `Crédito ${d} días`;
}

/**
 * Línea completa para listas y detalle: "Crédito 30 días · Transferencia
 * electrónica". Con la forma sin especificar se omite la segunda mitad en vez
 * de imprimir "Sin especificar" pegado a la condición.
 */
export function paymentConditionsLabel(
  days: number | null | undefined,
  method: string | null | undefined
): string {
  const terms = paymentTermsLabel(days);
  return method ? `${terms} · ${paymentMethodLabel(method)}` : terms;
}
