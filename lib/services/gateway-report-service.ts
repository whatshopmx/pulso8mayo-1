import { db } from "@/lib/db";
import { eq, and, gte, lte, sql, desc, isNull, isNotNull } from "drizzle-orm";
import {
  gatewayTransactions,
  branches,
  companyBankAccounts,
  bankTransactions,
  users,
} from "@/lib/db/schema";
import {
  parseGatewayReport,
  type AcquirerType,
  type ParseGatewayReportResult,
} from "./gateway-report-parser";
import { ApiError } from "@/lib/api/error";

export interface ImportGatewayReportParams {
  companyId: string;
  branchId: string;
  acquirer: AcquirerType;
  fileName: string;
  buffer: Buffer;
  userId: string;
  rawFileUrl?: string;
  /**
   * Cuenta propia a la que aterriza el neto del reporte. Opcional: los import
   * históricos no la traían y `null` significa «aún no conciliado», no
   * «sin cuenta». La cuenta dada de baja o de otra empresa se rechaza — un id
   * ajeno no se acepta ni se revela su existencia.
   */
  destinationBankAccountId?: string;
}

export interface ImportGatewayReportResult {
  fileName: string;
  acquirer: AcquirerType;
  totalParsed: number;
  insertedCount: number;
  duplicateCount: number;
  totalGrossCents: number;
  totalFeeCents: number;
  totalFeeVatCents: number;
  totalNetCents: number;
}

export interface GetGatewayTransactionsQuery {
  companyId: string;
  branchId?: string;
  acquirer?: AcquirerType;
  startDate?: string;
  endDate?: string;
  /** Sólo filas sin cuenta destino declarada ("sin conciliar"). */
  unassigned?: boolean;
  limit?: number;
  offset?: number;
}

export class GatewayReportService {
  /**
   * Importa un archivo de reporte de pasarela (Clip, MP, bancos), normaliza transacciones
   * y las guarda en la base de datos detectando duplicados idempotentemente.
   */
  static async importReport(
    params: ImportGatewayReportParams
  ): Promise<ImportGatewayReportResult> {
    const {
      companyId,
      branchId,
      acquirer,
      fileName,
      buffer,
      userId,
      rawFileUrl,
      destinationBankAccountId,
    } = params;

    // 1. Validar que la sucursal existe y pertenece a la compañía
    const [branch] = await db
      .select({ id: branches.id })
      .from(branches)
      .where(and(eq(branches.id, branchId), eq(branches.companyId, companyId)))
      .limit(1);

    if (!branch) {
      throw ApiError.badRequest("La sucursal seleccionada no es válida.");
    }

    // 1b. La cuenta destino existe, está activa y es de esta empresa — misma
    // validación de multi-tenant que la cuenta de origen en
    // `bank-statement-service.ts` y la partida de `createPaymentRun`.
    if (destinationBankAccountId) {
      const [account] = await db
        .select({ id: companyBankAccounts.id })
        .from(companyBankAccounts)
        .where(
          and(
            eq(companyBankAccounts.id, destinationBankAccountId),
            eq(companyBankAccounts.companyId, companyId),
            eq(companyBankAccounts.active, true)
          )
        )
        .limit(1);
      if (!account) {
        throw ApiError.badRequest(
          "La cuenta destino no existe en el catálogo activo de esta empresa."
        );
      }
    }

    // 2. Parsear el archivo con detección de formato y columnas
    const parsed: ParseGatewayReportResult = await parseGatewayReport(
      buffer,
      fileName,
      acquirer
    );

    if (parsed.transactions.length === 0) {
      throw ApiError.badRequest(
        "No se encontraron transacciones válidas en el archivo."
      );
    }

    // 3. Insertar transacciones ignorando duplicados por (companyId, acquirer, externalId)
    let insertedCount = 0;
    const batchSize = 100;

    for (let i = 0; i < parsed.transactions.length; i += batchSize) {
      const chunk = parsed.transactions.slice(i, i + batchSize);
      const valuesToInsert = chunk.map((tx) => ({
        companyId,
        branchId,
        acquirer: parsed.acquirer,
        externalId: tx.externalId,
        authorizationCode: tx.authorizationCode,
        transactionDate: tx.transactionDate,
        cardLast4: tx.cardLast4,
        cardBrand: tx.cardBrand,
        cardType: tx.cardType,
        grossAmountCents: tx.grossAmountCents,
        feeAmountCents: tx.feeAmountCents,
        feeVatCents: tx.feeVatCents,
        netAmountCents: tx.netAmountCents,
        settlementDate: tx.settlementDate,
        batchNumber: tx.batchNumber,
        status: tx.status,
        destinationBankAccountId: destinationBankAccountId ?? null,
        rawReportFileUrl: rawFileUrl || null,
        importedBy: userId,
      }));

      const inserted = await db
        .insert(gatewayTransactions)
        .values(valuesToInsert)
        .onConflictDoNothing({
          target: [
            gatewayTransactions.companyId,
            gatewayTransactions.acquirer,
            gatewayTransactions.externalId,
          ],
        })
        .returning({ id: gatewayTransactions.id });

      insertedCount += inserted.length;
    }

    const duplicateCount = parsed.transactions.length - insertedCount;

    return {
      fileName,
      acquirer: parsed.acquirer,
      totalParsed: parsed.transactions.length,
      insertedCount,
      duplicateCount,
      totalGrossCents: parsed.totalGrossCents,
      totalFeeCents: parsed.totalFeeCents,
      totalFeeVatCents: parsed.totalFeeVatCents,
      totalNetCents: parsed.totalNetCents,
    };
  }

  /**
   * Consulta las transacciones importadas de pasarela con filtros de fecha, sucursal y adquirente.
   */
  static async getTransactions(query: GetGatewayTransactionsQuery) {
    const {
      companyId,
      branchId,
      acquirer,
      startDate,
      endDate,
      unassigned,
      limit = 100,
      offset = 0,
    } = query;

    const conditions = [eq(gatewayTransactions.companyId, companyId)];

    if (branchId && branchId !== "ALL") {
      conditions.push(eq(gatewayTransactions.branchId, branchId));
    }
    if (acquirer) {
      conditions.push(eq(gatewayTransactions.acquirer, acquirer));
    }
    if (unassigned) {
      // "Sin conciliar" = aún sin cuenta destino declarada, no "sin cuenta":
      // la fila puede asignarse después.
      conditions.push(isNull(gatewayTransactions.destinationBankAccountId));
    }
    if (startDate) {
      conditions.push(
        gte(gatewayTransactions.transactionDate, new Date(startDate))
      );
    }
    if (endDate) {
      // Incluir el día completo de endDate
      const endDateTime = new Date(endDate);
      endDateTime.setHours(23, 59, 59, 999);
      conditions.push(lte(gatewayTransactions.transactionDate, endDateTime));
    }

    const whereClause = and(...conditions);

    // Consulta de registros paginados
    const items = await db
      .select({
        id: gatewayTransactions.id,
        companyId: gatewayTransactions.companyId,
        branchId: gatewayTransactions.branchId,
        branchName: branches.name,
        acquirer: gatewayTransactions.acquirer,
        externalId: gatewayTransactions.externalId,
        authorizationCode: gatewayTransactions.authorizationCode,
        transactionDate: gatewayTransactions.transactionDate,
        cardLast4: gatewayTransactions.cardLast4,
        cardBrand: gatewayTransactions.cardBrand,
        cardType: gatewayTransactions.cardType,
        grossAmountCents: gatewayTransactions.grossAmountCents,
        feeAmountCents: gatewayTransactions.feeAmountCents,
        feeVatCents: gatewayTransactions.feeVatCents,
        netAmountCents: gatewayTransactions.netAmountCents,
        settlementDate: gatewayTransactions.settlementDate,
        batchNumber: gatewayTransactions.batchNumber,
        status: gatewayTransactions.status,
        destinationAccountLastFour: companyBankAccounts.accountLastFour,
        importedAt: gatewayTransactions.createdAt,
        importedByName: users.name,
      })
      .from(gatewayTransactions)
      .leftJoin(branches, eq(gatewayTransactions.branchId, branches.id))
      .leftJoin(
        companyBankAccounts,
        eq(companyBankAccounts.id, gatewayTransactions.destinationBankAccountId)
      )
      .leftJoin(users, eq(gatewayTransactions.importedBy, users.id))
      .where(whereClause)
      .orderBy(desc(gatewayTransactions.transactionDate))
      .limit(limit)
      .offset(offset);

    // Totales agregados sin paginación
    const [aggregates] = await db
      .select({
        totalCount: sql<number>`count(*)::int`,
        sumGross: sql<number>`coalesce(sum(${gatewayTransactions.grossAmountCents}), 0)::int`,
        sumFee: sql<number>`coalesce(sum(${gatewayTransactions.feeAmountCents}), 0)::int`,
        sumFeeVat: sql<number>`coalesce(sum(${gatewayTransactions.feeVatCents}), 0)::int`,
        sumNet: sql<number>`coalesce(sum(${gatewayTransactions.netAmountCents}), 0)::int`,
      })
      .from(gatewayTransactions)
      .where(whereClause);

    return {
      items,
      total: aggregates?.totalCount ?? 0,
      summary: {
        totalGrossCents: aggregates?.sumGross ?? 0,
        totalFeeCents: aggregates?.sumFee ?? 0,
        totalFeeVatCents: aggregates?.sumFeeVat ?? 0,
        totalNetCents: aggregates?.sumNet ?? 0,
      },
    };
  }

  /**
   * Reporte de cruce de plataforma: "venta cobrada por la plataforma vs neto
   * aterrizado". Por adquirente y período: SUM(gross), SUM(fee), SUM(net) de
   * `gateway_transactions` contra los movimientos bancarios MATCHED de las
   * entradas (fase B), más el % de comisión efectiva. La fila del banco viene
   * del cruce manual confirmado — sin cruce, el banco queda 0 y el hueco es
   * visible, no oculto.
   */
  static async getPlatformCrossReport(params: {
    companyId: string;
    acquirer?: AcquirerType;
    startDate?: string;
    endDate?: string;
  }) {
    const conditions = [
      eq(bankTransactions.companyId, params.companyId),
      eq(bankTransactions.matchStatus, "MATCHED"),
      isNotNull(bankTransactions.matchedGatewayTransactionId),
    ];

    const gatewayFilter = and(
      eq(gatewayTransactions.companyId, params.companyId),
      params.acquirer ? eq(gatewayTransactions.acquirer, params.acquirer) : undefined,
      params.startDate
        ? gte(gatewayTransactions.transactionDate, new Date(params.startDate))
        : undefined,
      params.endDate
        ? lte(gatewayTransactions.transactionDate, new Date(params.endDate))
        : undefined
    );

    const rows = await db
      .select({
        acquirer: gatewayTransactions.acquirer,
        transactionCount: sql<number>`count(*)::int`,
        grossCents: sql<number>`coalesce(sum(${gatewayTransactions.grossAmountCents}), 0)::int`,
        feeCents: sql<number>`coalesce(sum(${gatewayTransactions.feeAmountCents}), 0)::int`,
        feeVatCents: sql<number>`coalesce(sum(${gatewayTransactions.feeVatCents}), 0)::int`,
        netCents: sql<number>`coalesce(sum(${gatewayTransactions.netAmountCents}), 0)::int`,
        bankMatchedCents: sql<number>`coalesce(sum(${bankTransactions.amountCents}), 0)::int`,
      })
      .from(bankTransactions)
      .innerJoin(
        gatewayTransactions,
        eq(gatewayTransactions.id, bankTransactions.matchedGatewayTransactionId)
      )
      .where(and(...conditions, gatewayFilter))
      .groupBy(gatewayTransactions.acquirer)
      .orderBy(desc(sql`coalesce(sum(${gatewayTransactions.netAmountCents}), 0)`));

    return rows.map((row) => ({
      ...row,
      /** Comisión efectiva en puntos base (fee / gross). */
      effectiveRateBps:
        row.grossCents > 0 ? Math.round((row.feeCents / row.grossCents) * 10_000) : 0,
    }));
  }

  /**
   * Asignar (o corregir) la cuenta destino de filas ya importadas — la
   * asignación retroactiva del import histórico. La cuenta se valida contra
   * el catálogo ACTIVO de la misma empresa (mismo criterio de importReport);
   * `null` significa "sin conciliar de nuevo", visible como badge, nunca
   * oculto. La fila movida conserva su idempotencia de import — esto no es
   * re-estampado, es la conciliación de la persona que cruza.
   */
  static async assignDestination(input: {
    companyId: string;
    transactionId: string;
    /** `null` = desasignar (corrección de dedo), visible de nuevo como "Sin destino". */
    destinationBankAccountId: string | null;
  }): Promise<void> {
    if (input.destinationBankAccountId) {
      const [account] = await db
        .select({ id: companyBankAccounts.id })
        .from(companyBankAccounts)
        .where(
          and(
            eq(companyBankAccounts.id, input.destinationBankAccountId),
            eq(companyBankAccounts.companyId, input.companyId),
            eq(companyBankAccounts.active, true)
          )
        )
        .limit(1);
      if (!account) {
        throw ApiError.badRequest(
          "La cuenta destino no existe en el catálogo activo de esta empresa."
        );
      }
    }

    const [updated] = await db
      .update(gatewayTransactions)
      .set({
        destinationBankAccountId: input.destinationBankAccountId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(gatewayTransactions.id, input.transactionId),
          eq(gatewayTransactions.companyId, input.companyId)
        )
      )
      .returning({ id: gatewayTransactions.id });

    if (!updated) {
      throw ApiError.notFound(
        "La transacción de pasarela no existe en esta empresa."
      );
    }
  }
}
