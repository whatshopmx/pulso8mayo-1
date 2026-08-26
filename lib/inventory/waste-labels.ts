// lib/inventory/waste-labels.ts
//
// Vocabulario compartido de mermas (plan-mermas-historial Task 2). Un solo
// módulo sirve al historial, el detalle y futuros links desde movimientos/
// reportes — evita el drift "motivo del form" vs "motivo del historial".
//
// Criterio OQ-1: STAFF y COURTESY son CONSUMO INTERNO (regalo a cliente,
// comida de personal), no desperdicio. No suman a la pérdida real en ningún
// lado — ni aquí, ni en inventory-reports-service, ni en el KPI del dashboard.

import type { VariantProps } from "class-variance-authority";
import { badgeVariants } from "@/components/ui/badge";
import type { inventoryWasteReasonEnum } from "@/lib/db/schema";

/** Variante de badge disponible (derivada de cva, sin duplicar la unión). */
type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;

export type WasteReason = (typeof inventoryWasteReasonEnum.enumValues)[number];

/** Etiqueta ES + variante de badge por motivo. */
export const REASON_LABELS: Record<WasteReason, { label: string; variant: BadgeVariant }> = {
  EXPIRED: { label: "Caducidad", variant: "destructive" },
  DAMAGED: { label: "Dañado", variant: "warning" },
  QUALITY: { label: "Calidad", variant: "warning" },
  SPILLAGE: { label: "Derrame", variant: "warning" },
  OTHER: { label: "Otro", variant: "outline" },
  STAFF: { label: "Consumo de personal", variant: "secondary" },
  COURTESY: { label: "Cortesía a cliente", variant: "secondary" },
  // Tasks 4 y 11 (§8.1): completan los 7 tipos de merma del manual.
  HOLD_TIME: { label: "Tiempo de retención", variant: "destructive" },
  PREPARATION: { label: "Preparación", variant: "outline" },
  CUSTOMER_RETURN: { label: "Devolución de cliente", variant: "warning" },
};

/**
 * Origen conocido de la merma (`inventory_waste.origin` es text libre; null =
 * captura manual vía formulario/API). Los tres primeros los escriben los
 * extractores de workflow; los dos de retención, el ciclo de hold times.
 */
export const ORIGIN_LABELS: Record<string, { label: string; variant: BadgeVariant }> = {
  workflow_merma: { label: "Workflow WhatsApp", variant: "default" },
  diferencia_conteo: { label: "Varianza de conteo", variant: "warning" },
  lote_insuficiente: { label: "Producción", variant: "outline" },
  // Task 5 (§6.4): descarte por tiempo de retención vencido. Se distinguen a
  // propósito — que el cron haya tenido que cerrarla solo dice que la línea
  // quedó desatendida, y eso es una señal operativa, no un detalle técnico.
  hold_time: { label: "Retención (confirmada)", variant: "outline" },
  hold_time_auto: { label: "Retención (sin confirmar)", variant: "warning" },
};

/** Origen null → captura manual. Función para no duplicar el default. */
export function originLabel(origin: string | null | undefined): { label: string; variant: BadgeVariant } {
  if (!origin) return { label: "Captura manual", variant: "secondary" };
  return ORIGIN_LABELS[origin] ?? { label: origin, variant: "outline" };
}

/** STAFF/COURTESY son consumo interno: no inflan el % de merma real (OQ-1). */
export function isInternalConsumption(reason: string): boolean {
  return reason === "STAFF" || reason === "COURTESY";
}

/**
 * Task 3 (§8.1): etiquetas del flujo de aprobación. AUTO no se muestra — es el
 * default y pintar "sin aprobación" en cada fila sería ruido.
 */
export const APPROVAL_LABELS: Record<string, { label: string; variant: BadgeVariant }> = {
  PENDING_APPROVAL: { label: "Por aprobar", variant: "warning" },
  APPROVED: { label: "Aprobada", variant: "outline" },
  REJECTED: { label: "Rechazada", variant: "destructive" },
};

/** Null/undefined/"AUTO" → sin badge. Función para no duplicar el default. */
export function approvalLabel(
  status: string | null | undefined
): { label: string; variant: BadgeVariant } | null {
  if (!status || status === "AUTO") return null;
  return APPROVAL_LABELS[status] ?? { label: status, variant: "outline" };
}

/** Opciones para un Select de filtro de motivo, en orden operativo. */
export const REASON_FILTER_OPTIONS = (
  Object.keys(REASON_LABELS) as WasteReason[]
).map((value) => ({ value, label: REASON_LABELS[value].label }));

/** Opciones para un Select de filtro de origen. */
export const ORIGIN_FILTER_OPTIONS = Object.entries(ORIGIN_LABELS).map(
  ([value, { label }]) => ({ value, label })
);
