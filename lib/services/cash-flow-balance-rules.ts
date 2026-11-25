/**
 * FIN-01 — Reglas puras para distinguir saldo bancario conciliado de caja proyectada.
 *
 * Sin dependencias de runtime/DB: compartido entre `cash-flow-service.ts` (servidor)
 * y los componentes de flujo de efectivo (`cash-flow-hero`, `opening-balance-card`,
 * `cash-flow-summary-card`, `cash-flow-calendar`).
 *
 * Invariantes:
 * 1. El saldo inicial siempre declara fuente, fecha efectiva y cuenta(s).
 * 2. Si no existe ancla bancaria ni supuesto capturado (`initialBalanceCents === null`),
 *    NO se calcula ni renderiza un saldo absoluto aparente (`$0.00`, runway `30+ días`, etc.).
 * 3. Toda trayectoria futura de flujo de caja permanece etiquetada como estimación
 *    (`Proyección estimada`), nunca como saldo bancario confirmado.
 */

export type CashBalanceSource =
  | "BANK_RECONCILED"
  | "MANUAL_BRANCH"
  | "MANUAL_COMPANY"
  | "NO_ANCHOR";

export type LegacyOpeningBalanceSource = "ACCOUNTS" | "BRANCH" | "COMPANY" | "NONE";

export interface ReconciledBankAccountBalance {
  id: string;
  label: string;
  bankName?: string;
  accountLastFour: string;
  /** Fecha del ancla de apertura capturada del banco (`YYYY-MM-DD`). */
  openingAsOfDate?: string;
  /** Fecha efectiva del último movimiento conciliado o del ancla (`YYYY-MM-DD`). */
  asOfDate?: string;
  openingBalanceCents?: number;
  /** Saldo conciliado: apertura + movimientos bancarios `MATCHED` desde el ancla. */
  reconciledBalanceCents?: number;
  /** Saldo según estado de cuenta importado (`MATCHED` + `UNMATCHED`, sin `IGNORED`). */
  statementBalanceCents?: number;
  /** Importe neto de movimientos importados aún pendientes de conciliar (`UNMATCHED`). */
  unmatchedDeltaCents?: number;
  unmatchedCount?: number;
  /** Alias compatible con contratos existentes: igual a `reconciledBalanceCents`. */
  balanceCents: number;
}

export interface OpeningBalanceContract {
  source: LegacyOpeningBalanceSource;
  /** FIN-01: fuente normalizada del saldo, distinguiendo conciliado vs manual vs sin ancla. */
  balanceSource?: CashBalanceSource;
  sourceLabel?: string;
  isBankAnchored?: boolean;
  /** Saldo bancario conciliado total cuando `isBankAnchored === true`; `null` si no hay ancla bancaria. */
  reconciledBalanceCents?: number | null;
  /** Movimientos bancarios importados pendientes de conciliar (`UNMATCHED`) en cuentas ancladas. */
  unmatchedBankDeltaCents?: number;
  unmatchedBankCount?: number;
  accountBreakdown?: ReconciledBankAccountBalance[] | null;
  unanchoredAccountsCount?: number;
  /** Fecha efectiva del saldo (`YYYY-MM-DD`); `null` cuando no existe ancla ni captura. */
  asOfDate: string | null;
  ageInDays: number | null;
  isStale: boolean;
}

export interface CashFlowProjectionMeta {
  isEstimate: true;
  label: string;
  hasAbsoluteBalance: boolean;
  hasBankAnchor: boolean;
  disclaimer: string;
}

export const CASH_BALANCE_SOURCE_LABELS: Record<CashBalanceSource, string> = {
  BANK_RECONCILED: "Saldo bancario conciliado",
  MANUAL_BRANCH: "Supuesto manual de sucursal (sin ancla bancaria)",
  MANUAL_COMPANY: "Supuesto manual de grupo (sin ancla bancaria)",
  NO_ANCHOR: "Sin ancla bancaria",
};

export const CASH_FLOW_PROJECTION_DISCLAIMER =
  "Proyección estimada: las entradas y saldos futuros son una estimación operativa, no saldo bancario confirmado.";

export function toCashBalanceSource(source: LegacyOpeningBalanceSource): CashBalanceSource {
  switch (source) {
    case "ACCOUNTS":
      return "BANK_RECONCILED";
    case "BRANCH":
      return "MANUAL_BRANCH";
    case "COMPANY":
      return "MANUAL_COMPANY";
    default:
      return "NO_ANCHOR";
  }
}

export function cashBalanceSourceLabel(source: CashBalanceSource): string {
  return CASH_BALANCE_SOURCE_LABELS[source];
}

export function describeOpeningBalance(
  openingBalance: OpeningBalanceContract | undefined,
  initialBalanceCents: number | null,
  scope?: { branchId: string | null; branchName: string | null },
): {
  balanceSource: CashBalanceSource;
  sourceLabel: string;
  isBankAnchored: boolean;
  hasAbsoluteBalance: boolean;
  effectiveAsOfDate: string | null;
  accountsSummary: string | null;
  projectionDisclaimer: string;
} {
  const legacySource: LegacyOpeningBalanceSource =
    initialBalanceCents === null ? "NONE" : (openingBalance?.source ?? "NONE");
  const balanceSource = openingBalance?.balanceSource ?? toCashBalanceSource(legacySource);
  const isBankAnchored =
    balanceSource === "BANK_RECONCILED" &&
    initialBalanceCents !== null &&
    (openingBalance?.accountBreakdown?.length ?? 0) > 0;

  const accounts = openingBalance?.accountBreakdown ?? [];
  let accountsSummary: string | null = null;
  if (isBankAnchored && accounts.length === 1) {
    const a = accounts[0];
    accountsSummary = `${a.bankName ? `${a.bankName} · ` : ""}${a.label} ····${a.accountLastFour}`;
  } else if (isBankAnchored && accounts.length > 1) {
    accountsSummary = `${accounts.length} cuentas bancarias ancladas (${accounts
      .map((a) => `····${a.accountLastFour}`)
      .join(", ")})`;
  } else if (balanceSource === "MANUAL_BRANCH") {
    accountsSummary = scope?.branchName ? `Caja/supuesto de ${scope.branchName}` : "Supuesto de sucursal";
  } else if (balanceSource === "MANUAL_COMPANY") {
    accountsSummary = "Supuesto consolidado de empresa (sin cuenta bancaria anclada)";
  }

  const effectiveAsOfDate =
    openingBalance?.asOfDate ??
    (accounts.length > 0
      ? accounts
          .map((a) => a.asOfDate ?? a.openingAsOfDate ?? null)
          .filter((d): d is string => Boolean(d))
          .sort()
          .at(-1) ?? null
      : null);

  return {
    balanceSource,
    sourceLabel: openingBalance?.sourceLabel ?? cashBalanceSourceLabel(balanceSource),
    isBankAnchored,
    hasAbsoluteBalance: initialBalanceCents !== null,
    effectiveAsOfDate,
    accountsSummary,
    projectionDisclaimer: CASH_FLOW_PROJECTION_DISCLAIMER,
  };
}

export interface CashFlowHeroMetrics {
  /** `null` cuando no hay saldo inicial / ancla bancaria o faltan entradas estimadas. */
  minBalanceCents: number | null;
  minBalanceDate: string | null;
  firstNegativeDay: string | null;
  /** `null` cuando no se puede afirmar un saldo absoluto sin ancla/base. */
  runwayDays: number | null;
  endingBalanceCents: number | null;
  /** `null` cuando `inflow.basis === "NONE"` (sin historial de ventas). */
  totalInflowCents: number | null;
  totalOutflowCents: number;
  netFlowCents: number | null;
  hasAbsoluteBalance: boolean;
  hasBankAnchor: boolean;
  statusLevel: "UNANCHORED" | "HEALTHY" | "WARNING" | "CRITICAL";
}

/**
 * Calcula los indicadores de liquidez para `CashFlowHero` sin fabricar un saldo
 * absoluto aparente (`$0.00` ni `30+ días`) cuando falta ancla bancaria / saldo base.
 */
export function computeCashFlowHeroMetrics(
  projection: {
    initialBalanceCents: number | null;
    openingBalance?: OpeningBalanceContract;
    days: Array<{
      date: string;
      projectedInflowCents: number | null;
      projectedOutflowCents: number;
      cumulativeBalanceCents: number | null;
    }>;
  },
  horizonDays: number,
): CashFlowHeroMetrics {
  const days = projection.days ?? [];
  const hasBankAnchor =
    projection.openingBalance?.source === "ACCOUNTS" &&
    projection.initialBalanceCents !== null &&
    (projection.openingBalance.accountBreakdown?.length ?? 0) > 0;

  let hasAnyInflow = false;
  let totalInflowSum = 0;
  let totalOutflowCents = 0;

  for (const day of days) {
    if (day.projectedInflowCents !== null) {
      hasAnyInflow = true;
      totalInflowSum += day.projectedInflowCents;
    }
    totalOutflowCents += day.projectedOutflowCents;
  }

  const totalInflowCents = hasAnyInflow ? totalInflowSum : null;
  const netFlowCents = totalInflowCents === null ? null : totalInflowCents - totalOutflowCents;

  const daysWithBalance = days.filter(
    (d): d is typeof d & { cumulativeBalanceCents: number } => d.cumulativeBalanceCents !== null,
  );

  // Regla FIN-01: si no hay saldo base o no hay serie acumulada calculable,
  // nunca devolver $0.00 ni runway aparente.
  if (projection.initialBalanceCents === null || daysWithBalance.length === 0) {
    return {
      minBalanceCents: null,
      minBalanceDate: null,
      firstNegativeDay: null,
      runwayDays: null,
      endingBalanceCents: null,
      totalInflowCents,
      totalOutflowCents,
      netFlowCents,
      hasAbsoluteBalance: false,
      hasBankAnchor,
      statusLevel: "UNANCHORED",
    };
  }

  let minBalanceCents = projection.initialBalanceCents;
  let minBalanceDate: string | null = null;
  let firstNegativeDay: string | null = null;
  let runwayDays = horizonDays;

  days.forEach((day, index) => {
    if (day.cumulativeBalanceCents !== null) {
      if (day.cumulativeBalanceCents < minBalanceCents) {
        minBalanceCents = day.cumulativeBalanceCents;
        minBalanceDate = day.date;
      }
      if (day.cumulativeBalanceCents < 0 && firstNegativeDay === null) {
        firstNegativeDay = day.date;
        runwayDays = index + 1;
      }
    }
  });

  const endingBalanceCents = daysWithBalance[daysWithBalance.length - 1].cumulativeBalanceCents;

  let statusLevel: "HEALTHY" | "WARNING" | "CRITICAL" = "HEALTHY";
  if (minBalanceCents < 0 || runwayDays < 14) {
    statusLevel = "CRITICAL";
  } else if (runwayDays < horizonDays || minBalanceCents < 50_000_00) {
    statusLevel = "WARNING";
  }

  return {
    minBalanceCents,
    minBalanceDate,
    firstNegativeDay,
    runwayDays,
    endingBalanceCents,
    totalInflowCents,
    totalOutflowCents,
    netFlowCents,
    hasAbsoluteBalance: true,
    hasBankAnchor,
    statusLevel,
  };
}
