/**
 * Contrato compartido del registro de cortes de ventas.
 *
 * Vivía dentro de `app/dashboard/sales/page.tsx`. Se extrajo para que el panel
 * de detalle (`SalesCutDetailSheet`) y la página usen **tipo único** en vez de
 * dos declaraciones que se separan con el primer campo nuevo.
 */

/** Alcance que `/api/sales/cuts` aplicó, tal como lo devuelve (A8). */
export interface CutsScope {
  branchId: string | null;
  startDate: string | null;
  endDate: string | null;
  /** `true` si el rango lo puso la ruta (mes en curso) y no el usuario. */
  rangoPorDefecto: boolean;
  limit: number;
  offset: number;
  truncated: boolean;
}

export interface SalesCut {
  id: string;
  branchId: string;
  branchName: string;
  businessDate: string;
  shift: "MATUTINO" | "VESPERTINO" | "COMPLETO";
  channel: "SALON" | "DELIVERY" | "EVENTOS" | "TOTAL";
  totalSales: number;
  cashSales: number | null;
  cardSales: number | null;
  otherPayments: number | null;
  cashCountedCents: number | null;
  depositedCents: number | null;
  aggregatorSales: Record<string, number> | null;
  /** Fase 4: comisión cobrada por la terminal y depósito recibido. `null` = sin conciliar. */
  commissionCents: number | null;
  tpvDepositCents: number | null;
  ticketCount: number | null;
  avgTicket: number | null;
  source: "UPLOAD" | "WHATSAPP" | "MANUAL_FORM";
  rawFileUrl: string | null;
  status: "VALIDATED" | "PENDING_REVIEW";
  validationNotes: string | null;
  receivedByName: string | null;
  receivedAt: string;
  createdAt: string;
}

/** El canal se guarda como enum; en pantalla se lee como lo nombra la operación. */
export const CHANNEL_LABELS: Record<SalesCut["channel"], string> = {
  SALON: "Salón",
  DELIVERY: "Delivery",
  EVENTOS: "Eventos",
  TOTAL: "Total",
};
