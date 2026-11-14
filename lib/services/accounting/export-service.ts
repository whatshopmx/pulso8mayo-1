import { and, desc, eq, isNull, sql } from "drizzle-orm";
import PDFDocument from "pdfkit";
import { z, ZodError } from "zod";
import { ApiError, isApiError } from "@/lib/api/error";
import { resolveBranchScope } from "@/lib/branch-scope";
import {
  accountingPeriodCloses,
  branches,
  companies,
  users,
} from "@/lib/db/schema";
import { withCompanyContext } from "@/lib/db/tenant-context";
import { hasPermission, type Role } from "@/lib/permissions";
import { logDataAccess } from "@/lib/security/audit";
import {
  getPeriodCloseBlockersIn,
  monthBounds,
  type CloseBlocker,
  type TrialBalanceSnapshotRow,
} from "./close-service";

export interface ExportContext {
  companyId: string;
  actorId: string;
  role: Role;
}

export const exportQuerySchema = z
  .object({
    year: z.coerce.number().int().min(2000).max(2100),
    month: z.coerce.number().int().min(1).max(12),
    version: z.coerce.number().int().min(1).max(10000).optional(),
    branchId: z.uuid().nullable().optional(),
    format: z.enum(["csv", "pdf"]).default("csv"),
  })
  .strict();

export interface ExportJournalLineRow {
  journalId: string;
  journalNumber: number | null;
  accountingDate: string;
  branchId: string | null;
  branchName: string | null;
  description: string;
  accountCode: string;
  accountName: string;
  debitCents: number;
  creditCents: number;
  memo: string | null;
}

export interface CloseDossier {
  companyName: string;
  period: string;
  year: number;
  month: number;
  version: number;
  versionStatus: "ACTIVE" | "SUPERSEDED" | "OPEN";
  scopeLabel: string;
  branchId: string | null;
  coverageSummary: string;
  closedAt: string | null;
  reopenReason: string | null;
  journalCount: number;
  maxJournalNumber: number;
  totalDebitCents: number;
  totalCreditCents: number;
  trialBalance: TrialBalanceSnapshotRow[];
  journals: ExportJournalLineRow[];
  blockers: CloseBlocker[];
}

const FORMULA_PREFIX_RE = /^[\s]*[=+\-@\t\r]/;

/** Neutraliza fórmulas de Excel/Sheets/LibreOffice ante cualquier prefijo peligroso. */
export function sanitizeCsvText(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const raw = String(value);
  const safe = FORMULA_PREFIX_RE.test(raw) ? `'${raw}` : raw;
  if (/[",\n\r']/.test(safe)) {
    return `"${safe.replaceAll('"', '""')}"`;
  }
  return safe;
}

function formatCentsPlain(cents: number): string {
  return (cents / 100).toFixed(2);
}

function formatMxn(cents: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

export async function buildCloseDossier(
  ctx: ExportContext,
  input: Omit<z.input<typeof exportQuerySchema>, "format">,
): Promise<CloseDossier> {
  try {
    const data = exportQuerySchema.omit({ format: true }).parse(input);
    if (!hasPermission(ctx.role, "accounting", "read")) {
      throw ApiError.forbidden("No tienes permiso para exportar expedientes contables.");
    }

    const principal = z
      .object({ companyId: z.uuid(), actorId: z.string().trim().min(1).max(160) })
      .parse({ companyId: ctx.companyId, actorId: ctx.actorId });

    const { periodStart, periodEnd, monthStr } = monthBounds(data.year, data.month);
    const periodLabel = `${data.year}-${monthStr}`;

    const dossier = await withCompanyContext({ companyId: principal.companyId }, async tx => {
      const [actor] = await tx
        .select({ id: users.id, branchId: users.branchId })
        .from(users)
        .where(
          and(
            eq(users.id, principal.actorId),
            eq(users.companyId, principal.companyId),
            eq(users.role, ctx.role),
            eq(users.active, true),
            isNull(users.deletedAt),
          ),
        )
        .limit(1);
      if (!actor) throw ApiError.forbidden("El actor no está activo en esta empresa con ese permiso.");

      const scope = resolveBranchScope(ctx.role, actor.branchId);
      if (scope.kind === "NONE") {
        throw ApiError.forbidden("No tienes una sucursal asignada para exportar expedientes.");
      }

      let effectiveBranchId: string | null = data.branchId ?? null;
      if (scope.kind === "BRANCH") {
        if (data.branchId && data.branchId !== scope.branchId) {
          throw ApiError.forbidden("No tienes acceso a esta sucursal.");
        }
        effectiveBranchId = scope.branchId;
      }

      const [company] = await tx
        .select({ name: companies.name })
        .from(companies)
        .where(eq(companies.id, principal.companyId))
        .limit(1);

      let branchName: string | null = null;
      if (effectiveBranchId) {
        const [branch] = await tx
          .select({ id: branches.id, name: branches.name })
          .from(branches)
          .where(and(eq(branches.id, effectiveBranchId), eq(branches.companyId, principal.companyId)))
          .limit(1);
        if (!branch) throw ApiError.notFound("La sucursal indicada no existe en esta empresa.");
        branchName = branch.name;
      }

      // Load requested or active close version
      let closeRow: typeof accountingPeriodCloses.$inferSelect | undefined;
      if (data.version !== undefined) {
        const [found] = await tx
          .select()
          .from(accountingPeriodCloses)
          .where(
            and(
              eq(accountingPeriodCloses.companyId, principal.companyId),
              eq(accountingPeriodCloses.year, data.year),
              eq(accountingPeriodCloses.month, data.month),
              eq(accountingPeriodCloses.version, data.version),
            ),
          )
          .limit(1);
        if (!found) {
          throw ApiError.notFound(`No existe la versión ${data.version} del cierre ${periodLabel}.`);
        }
        closeRow = found;
      } else {
        const [active] = await tx
          .select()
          .from(accountingPeriodCloses)
          .where(
            and(
              eq(accountingPeriodCloses.companyId, principal.companyId),
              eq(accountingPeriodCloses.year, data.year),
              eq(accountingPeriodCloses.month, data.month),
            ),
          )
          .orderBy(desc(accountingPeriodCloses.version))
          .limit(1);
        closeRow = active;
      }

      const branchFilter = effectiveBranchId ? sql`AND j.branch_id = ${effectiveBranchId}` : sql``;
      const versionNumberCap =
        closeRow && closeRow.maxJournalNumber > 0
          ? sql`AND j.number <= ${closeRow.maxJournalNumber}`
          : sql``;

      // Load POSTED journals in [periodStart, periodEnd] scoped by branch & close maxJournalNumber
      const linesRes = await tx.execute<{
        journal_id: string;
        journal_number: number | null;
        accounting_date: string;
        branch_id: string | null;
        branch_name: string | null;
        description: string;
        account_code: string;
        account_name: string;
        debit_cents: string;
        credit_cents: string;
        memo: string | null;
      }>(sql`
        SELECT
          j.id AS journal_id,
          j.number AS journal_number,
          j.accounting_date::text AS accounting_date,
          j.branch_id,
          b.name AS branch_name,
          j.description,
          a.code AS account_code,
          a.name AS account_name,
          l.debit_cents::text AS debit_cents,
          l.credit_cents::text AS credit_cents,
          l.memo
        FROM accounting_journals j
        JOIN accounting_journal_lines l ON l.company_id = j.company_id AND l.journal_id = j.id
        JOIN accounting_accounts a ON a.company_id = l.company_id AND a.id = l.account_id
        LEFT JOIN branches b ON b.company_id = j.company_id AND b.id = j.branch_id
        WHERE j.company_id = ${principal.companyId}
          AND j.status = 'POSTED'
          AND j.accounting_date >= ${periodStart}
          AND j.accounting_date <= ${periodEnd}
          ${branchFilter}
          ${versionNumberCap}
        ORDER BY j.accounting_date ASC, j.number ASC NULLS LAST, l.line_number ASC
      `);

      const journals: ExportJournalLineRow[] = linesRes.rows.map(r => ({
        journalId: r.journal_id,
        journalNumber: r.journal_number,
        accountingDate: r.accounting_date,
        branchId: r.branch_id,
        branchName: r.branch_name,
        description: r.description,
        accountCode: r.account_code,
        accountName: r.account_name,
        debitCents: Number(r.debit_cents),
        creditCents: Number(r.credit_cents),
        memo: r.memo,
      }));

      let trialBalance: TrialBalanceSnapshotRow[] = [];
      let journalCount = 0;
      let maxJournalNumber = 0;
      let totalDebitCents = 0;
      let totalCreditCents = 0;

      if (closeRow && !effectiveBranchId) {
        // Reproduce exact frozen company close totals and trial balance
        trialBalance = (closeRow.trialBalance as unknown as TrialBalanceSnapshotRow[]) ?? [];
        journalCount = closeRow.journalCount;
        maxJournalNumber = closeRow.maxJournalNumber;
        totalDebitCents = closeRow.totalDebitCents;
        totalCreditCents = closeRow.totalCreditCents;
      } else {
        // Branch-scoped or open period: compute directly from scoped POSTED journals
        const tbRes = await tx.execute<{
          account_id: string;
          code: string;
          name: string;
          kind: TrialBalanceSnapshotRow["kind"];
          normal_balance: TrialBalanceSnapshotRow["normalBalance"];
          opening_debit: string;
          opening_credit: string;
          period_debit: string;
          period_credit: string;
        }>(sql`
          SELECT
            a.id AS account_id,
            a.code,
            a.name,
            a.kind,
            a.normal_balance,
            coalesce(sum(CASE WHEN j.accounting_date < ${periodStart} THEN l.debit_cents ELSE 0 END), 0)::text AS opening_debit,
            coalesce(sum(CASE WHEN j.accounting_date < ${periodStart} THEN l.credit_cents ELSE 0 END), 0)::text AS opening_credit,
            coalesce(sum(CASE WHEN j.accounting_date >= ${periodStart} AND j.accounting_date <= ${periodEnd} THEN l.debit_cents ELSE 0 END), 0)::text AS period_debit,
            coalesce(sum(CASE WHEN j.accounting_date >= ${periodStart} AND j.accounting_date <= ${periodEnd} THEN l.credit_cents ELSE 0 END), 0)::text AS period_credit
          FROM accounting_accounts a
          JOIN accounting_journal_lines l ON l.company_id = a.company_id AND l.account_id = a.id
          JOIN accounting_journals j ON j.company_id = l.company_id AND j.id = l.journal_id
            AND j.status = 'POSTED' AND j.accounting_date <= ${periodEnd}
            ${branchFilter}
            ${versionNumberCap}
          WHERE a.company_id = ${principal.companyId}
          GROUP BY a.id, a.code, a.name, a.kind, a.normal_balance
          ORDER BY a.code ASC
        `);
        trialBalance = tbRes.rows.map(r => {
          const od = Number(r.opening_debit);
          const oc = Number(r.opening_credit);
          const pd = Number(r.period_debit);
          const pc = Number(r.period_credit);
          return {
            accountId: r.account_id,
            code: r.code,
            name: r.name,
            kind: r.kind,
            normalBalance: r.normal_balance,
            openingDebitCents: od,
            openingCreditCents: oc,
            periodDebitCents: pd,
            periodCreditCents: pc,
            closingDebitCents: od + pd,
            closingCreditCents: oc + pc,
          };
        });
        const uniqueJournals = new Set(journals.map(j => j.journalId));
        journalCount = uniqueJournals.size;
        maxJournalNumber = journals.reduce((m, j) => Math.max(m, j.journalNumber ?? 0), 0);
        totalDebitCents = journals.reduce((s, j) => s + j.debitCents, 0);
        totalCreditCents = journals.reduce((s, j) => s + j.creditCents, 0);
      }

      const blockers =
        closeRow && closeRow.status === "ACTIVE"
          ? []
          : await getPeriodCloseBlockersIn(tx, principal.companyId, data.year, data.month);

      const version = closeRow?.version ?? 0;
      const versionStatus = closeRow ? closeRow.status : "OPEN";
      const scopeLabel = effectiveBranchId ? `Sucursal: ${branchName}` : "Consolidado Empresa";
      const coverageSummary = closeRow
        ? `Cierre v${version} (${versionStatus}) · ${journalCount} pólizas hasta folio #${maxJournalNumber} · ${blockers.length} pendiente(s)`
        : `Preliminar abierto · ${journalCount} pólizas publicadas · ${blockers.length} pendiente(s)`;

      return {
        companyName: company?.name ?? "Empresa",
        period: periodLabel,
        year: data.year,
        month: data.month,
        version,
        versionStatus,
        scopeLabel,
        branchId: effectiveBranchId,
        coverageSummary,
        closedAt: closeRow?.closedAt ? closeRow.closedAt.toISOString() : null,
        reopenReason: closeRow?.reopenReason ?? null,
        journalCount,
        maxJournalNumber,
        totalDebitCents,
        totalCreditCents,
        trialBalance,
        journals,
        blockers,
      } satisfies CloseDossier;
    });

    await logDataAccess({
      userId: ctx.actorId,
      companyId: ctx.companyId,
      branchId: dossier.branchId,
      action: "EXPORT",
      resource: "accounting_close_dossier",
      resourceId: `${dossier.period}:v${dossier.version}`,
      decision: { allowed: true, reason: dossier.coverageSummary },
    });

    return dossier;
  } catch (error) {
    if (isApiError(error)) throw error;
    if (error instanceof ZodError) {
      throw ApiError.badRequest(error.issues[0]?.message ?? "Revisa los parámetros de exportación.");
    }
    throw ApiError.internal("No se pudo generar el expediente contable del cierre.");
  }
}

export async function exportCloseCsv(
  ctx: ExportContext,
  input: Omit<z.input<typeof exportQuerySchema>, "format">,
): Promise<{ filename: string; content: string }> {
  const d = await buildCloseDossier(ctx, input);
  const lines: string[] = [];

  lines.push(["Campo", "Valor"].join(","));
  lines.push(["Empresa", sanitizeCsvText(d.companyName)].join(","));
  lines.push(["Periodo", sanitizeCsvText(d.period)].join(","));
  lines.push(["Version", sanitizeCsvText(`v${d.version}`)].join(","));
  lines.push(["Estado", sanitizeCsvText(d.versionStatus)].join(","));
  lines.push(["Alcance", sanitizeCsvText(d.scopeLabel)].join(","));
  lines.push(["Cobertura", sanitizeCsvText(d.coverageSummary)].join(","));
  lines.push(["Polizas", String(d.journalCount)].join(","));
  lines.push(["TotalCargosMXN", formatCentsPlain(d.totalDebitCents)].join(","));
  lines.push(["TotalAbonosMXN", formatCentsPlain(d.totalCreditCents)].join(","));
  lines.push("");

  lines.push("[BALANZA_COMPROBACION]");
  lines.push("Codigo,Cuenta,Naturaleza,AperturaCargos,AperturaAbonos,PeriodoCargos,PeriodoAbonos,CierreCargos,CierreAbonos");
  for (const row of d.trialBalance) {
    lines.push(
      [
        sanitizeCsvText(row.code),
        sanitizeCsvText(row.name),
        sanitizeCsvText(row.normalBalance),
        formatCentsPlain(row.openingDebitCents),
        formatCentsPlain(row.openingCreditCents),
        formatCentsPlain(row.periodDebitCents),
        formatCentsPlain(row.periodCreditCents),
        formatCentsPlain(row.closingDebitCents),
        formatCentsPlain(row.closingCreditCents),
      ].join(","),
    );
  }
  lines.push("");

  lines.push("[POLIZAS]");
  lines.push("Folio,Fecha,Sucursal,Descripcion,Cuenta,NombreCuenta,CargoMXN,AbonoMXN,Memo");
  for (const j of d.journals) {
    lines.push(
      [
        sanitizeCsvText(j.journalNumber ?? ""),
        sanitizeCsvText(j.accountingDate),
        sanitizeCsvText(j.branchName ?? "Corporativo"),
        sanitizeCsvText(j.description),
        sanitizeCsvText(j.accountCode),
        sanitizeCsvText(j.accountName),
        formatCentsPlain(j.debitCents),
        formatCentsPlain(j.creditCents),
        sanitizeCsvText(j.memo ?? ""),
      ].join(","),
    );
  }
  lines.push("");

  lines.push("[PENDIENTES]");
  lines.push("Codigo,Cantidad,Motivo");
  for (const b of d.blockers) {
    lines.push([sanitizeCsvText(b.code), String(b.count), sanitizeCsvText(b.message)].join(","));
  }

  return {
    filename: `expediente-cierre-${d.period}-v${d.version}.csv`,
    content: lines.join("\n"),
  };
}

export async function exportClosePdf(
  ctx: ExportContext,
  input: Omit<z.input<typeof exportQuerySchema>, "format">,
): Promise<{ filename: string; buffer: Buffer }> {
  const d = await buildCloseDossier(ctx, input);

  const buffer = await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: "LETTER" });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(16).text(`Expediente de Cierre Contable — ${d.period} (v${d.version} ${d.versionStatus})`);
    doc.moveDown(0.5);
    doc.fontSize(10).text(`Empresa: ${d.companyName}`);
    doc.text(`Alcance: ${d.scopeLabel}`);
    doc.text(`Cobertura: ${d.coverageSummary}`);
    doc.text(`Pólizas: ${d.journalCount} · Total Cargos: ${formatMxn(d.totalDebitCents)} · Total Abonos: ${formatMxn(d.totalCreditCents)}`);
    if (d.reopenReason) {
      doc.text(`Motivo de reapertura: ${d.reopenReason}`);
    }
    doc.moveDown();

    doc.fontSize(12).text("Balanza de Comprobación");
    doc.fontSize(9);
    if (d.trialBalance.length === 0) {
      doc.text("Sin movimientos en la balanza para el periodo.");
    } else {
      for (const row of d.trialBalance) {
        doc.text(
          `${row.code} ${row.name} | Periodo C: ${formatMxn(row.periodDebitCents)} / A: ${formatMxn(row.periodCreditCents)} | Cierre C: ${formatMxn(row.closingDebitCents)} / A: ${formatMxn(row.closingCreditCents)}`,
        );
      }
    }
    doc.moveDown();

    doc.fontSize(12).text("Detalle de Pólizas Publicadas");
    doc.fontSize(9);
    if (d.journals.length === 0) {
      doc.text("Sin pólizas publicadas en el periodo.");
    } else {
      for (const j of d.journals.slice(0, 150)) {
        doc.text(
          `#${j.journalNumber ?? "—"} | ${j.accountingDate} | ${j.branchName ?? "Corp"} | ${j.accountCode} ${j.accountName} | C ${formatMxn(j.debitCents)} / A ${formatMxn(j.creditCents)} | ${j.description}`,
        );
      }
    }
    doc.moveDown();

    doc.fontSize(12).text("Pendientes Bloqueantes");
    doc.fontSize(9);
    if (d.blockers.length === 0) {
      doc.text("Sin pendientes bloqueantes.");
    } else {
      for (const b of d.blockers) {
        doc.text(`- [${b.code}] (${b.count}): ${b.message}`);
      }
    }

    doc.end();
  });

  return {
    filename: `expediente-cierre-${d.period}-v${d.version}.pdf`,
    buffer,
  };
}
