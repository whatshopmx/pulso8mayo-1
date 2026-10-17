/**
 * Helpers compartidos de clasificación de excepciones.
 *
 * Extraídos de `group-exceptions-service.ts` para que los adaptadores hacia la
 * tabla canónica (`exceptions`) y el feed legacy clasifiquen idéntico. Módulo
 * puro: sin `db`.
 */
import type {
  ExceptionDomain,
  ExceptionSeverity,
  QsrRiskCategory,
} from "../exception-types";

export type { ExceptionDomain, ExceptionSeverity, QsrRiskCategory };

export type QsrActionType =
  | "AUDIT_DRAWER"
  | "INSPECT_EQUIPMENT"
  | "TRANSFER_STOCK"
  | "WHATSAPP_CALL"
  | "REVIEW_WORKFLOW"
  | "AUTHORIZE_SHIFT"
  | "RESOLVE_ALERT";

export interface QsrActionMeta {
  type: QsrActionType;
  label: string;
  url: string;
  whatsappSuggestedMessage?: string;
}

export function normalizeIncidentSeverity(s: string | null): ExceptionSeverity {
  switch (s) {
    case "FATAL":
      return "fatal";
    case "CRITICAL":
      return "critical";
    case "HIGH":
      return "high";
    case "WARNING":
      return "warning";
    default:
      return "info";
  }
}

export function normalizeEquipmentSeverity(s: string | null): ExceptionSeverity {
  switch (s) {
    case "CRITICAL":
      return "critical";
    case "HIGH":
      return "high";
    case "MEDIUM":
      return "warning";
    default:
      return "info";
  }
}

export function normalizeInventorySeverity(s: string | null): ExceptionSeverity {
  switch (s) {
    case "CRITICA":
      return "critical";
    case "ALTA":
      return "high";
    case "MEDIA":
      return "warning";
    default:
      return "info";
  }
}

export const INVENTORY_ALERT_TITLES: Record<string, string> = {
  LOW_STOCK: "Stock bajo en insumo clave",
  OUT_OF_STOCK: "Desabasto de insumo en turno",
  EXPIRING_SOON: "Insumo por vencer (caducidad)",
  EXPIRED: "Insumo vencido detectado",
  PRICE_INCREASE: "Alza de precio en compra",
  HIGH_VARIANCE: "Variación alta en porcionado",
  ANOMALOUS_WASTE: "Merma anómala registrada",
  YIELD_DROP: "Caída de rendimiento en receta",
};

export function normalizeNom035Priority(p: string | null): ExceptionSeverity {
  switch (p) {
    case "URGENT":
      return "critical";
    case "HIGH":
      return "high";
    case "MEDIUM":
      return "warning";
    default:
      return "info";
  }
}

export function classifyQsrIncident(
  title: string,
  desc: string | null,
  incidentId: string,
): {
  qsrCategory: QsrRiskCategory;
  impact: string;
  action: QsrActionMeta;
} {
  const text = `${title} ${desc ?? ""}`.toLowerCase();
  if (
    text.includes("temp") ||
    text.includes("frio") ||
    text.includes("frío") ||
    text.includes("refrig") ||
    text.includes("congel") ||
    text.includes("nom-251") ||
    text.includes("higiene") ||
    text.includes("sanit") ||
    text.includes("plaga")
  ) {
    return {
      qsrCategory: "INOCUIDAD",
      impact: "Riesgo de inocuidad alimentaria o sanción sanitaria NOM-251",
      action: {
        type: "INSPECT_EQUIPMENT",
        label: "Inspeccionar en Turno",
        url: `/dashboard/incidents/${incidentId}`,
        whatsappSuggestedMessage: `Alerta sanitaria detectada en sucursal. Por favor revisar de inmediato la cámara de frío y registrar lectura de temperatura.`,
      },
    };
  }
  if (
    text.includes("caja") ||
    text.includes("dinero") ||
    text.includes("arqueo") ||
    text.includes("terminal") ||
    text.includes("tpv") ||
    text.includes("cobro") ||
    text.includes("robo") ||
    text.includes("faltante")
  ) {
    return {
      qsrCategory: "DINERO",
      impact: "Dinero en riesgo o descuadre de cobro",
      action: {
        type: "AUDIT_DRAWER",
        label: "Auditar Corte POS/TPV",
        url: `/dashboard/incidents/${incidentId}`,
      },
    };
  }
  if (
    text.includes("merma") ||
    text.includes("stock") ||
    text.includes("desabasto") ||
    text.includes("insumo") ||
    text.includes("carne") ||
    text.includes("pollo") ||
    text.includes("queso")
  ) {
    return {
      qsrCategory: "ABASTO",
      impact: "Riesgo de desabasto o merma crítica en servicio",
      action: {
        type: "TRANSFER_STOCK",
        label: "Transferir Insumos",
        url: `/dashboard/incidents/${incidentId}`,
      },
    };
  }
  if (
    text.includes("personal") ||
    text.includes("retardo") ||
    text.includes("falta") ||
    text.includes("asistencia") ||
    text.includes("turno")
  ) {
    return {
      qsrCategory: "PERSONAL",
      impact: "Falta o retardo en plantilla operativa",
      action: {
        type: "AUTHORIZE_SHIFT",
        label: "Revisar Asistencia",
        url: `/dashboard/labor/approvals`,
      },
    };
  }
  return {
    qsrCategory: "INOCUIDAD",
    impact: "Desviación operativa en línea de servicio",
    action: {
      type: "REVIEW_WORKFLOW",
      label: "Revisar Incidente",
      url: `/dashboard/incidents/${incidentId}`,
    },
  };
}
