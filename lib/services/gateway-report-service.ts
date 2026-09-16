import { db } from "@/lib/db";
import { eq, and, gte, lte, sql, desc } from "drizzle-orm";
import {
  gatewayTransactions,
  branches,
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
        importedAt: gatewayTransactions.createdAt,
        importedByName: users.name,
      })
      .from(gatewayTransactions)
      .leftJoin(branches, eq(gatewayTransactions.branchId, branches.id))
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
}
