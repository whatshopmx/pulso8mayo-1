/**
 * REC-03B (V2 PostgreSQL nativo): aceptación del protocolo de corrección histórica
 * sobre base desechable aislada en Neon.
 *
 * Verifica:
 * 1. Exige conteo físico concordante, unidad exacta, actor != aprobador (>= ADMIN),
 *    motivo >= 10 caracteres y referencia de respaldo (backupReference).
 * 2. Bloquea cruces entre empresas (403) y mantiene retenidos los lotes AMBIGUOUS (409)
 *    sin ninguna escritura en DB.
 * 3. Aplica al lote SUFFICIENT respaldado: deja `current_quantity === ledger`,
 *    1 movimiento marcador neutral al ledger y 1 auditoría AUD-02 con metadatos
 *    `protocol: "REC-03B"`, `countedBy`, `approverId`, `countedQuantity`, `declaredUnit`,
 *    `backupReference`.
 * 4. Repetición y carrera simultánea en 2 conexiones producen exactamente 1 ajuste
 *    y devuelven `ALREADY_CORRECTED` sin duplicar movimiento ni auditoría.
 */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import { createSalesRuntimeDatabase } from "./helpers/sales-runtime-database";

type ProtocolService = typeof import("@/lib/services/historical-correction-protocol-service");
type Owner = Awaited<ReturnType<typeof createSalesRuntimeDatabase>>["owner"];

const previous = process.env.DATABASE_URL;
let fixture: Awaited<ReturnType<typeof createSalesRuntimeDatabase>> | undefined;
let protocolService: ProtocolService;
let secondPool: Pool | undefined;

const PRE = "2026-09-01T12:00:00Z";
const counterActor = `rec03b-cnt-${randomUUID().slice(0, 8)}`;
const adminApprover = `rec03b-adm-${randomUUID().slice(0, 8)}`;
const REASON = "REC-03B protocolo verificado: conteo físico en sucursal y respaldo confirmado";
const BACKUP_REF = "neon-backup-2026-11-27T04:00:00Z-batch-s1";

const companyA = randomUUID();
const companyB = randomUUID();
const branchA = randomUUID();
const branchB = randomUUID();
const itemA = randomUUID();
const itemB = randomUUID();
const batchSufficient1 = randomUUID();
const batchSufficientRace = randomUUID();
const batchAmbiguous = randomUUID();
const batchOtherCompany = randomUUID();

const rows = <T>(result: unknown) => (result as { rows: T[] }).rows;

async function seedReport(
  owner: Owner,
  branchId: string,
  companyId: string,
  itemId: string,
  qty: number,
) {
  const id = randomUUID();
  await owner.execute(sql`INSERT INTO receiving_reports (id, company_id, branch_id, received_by, received_at)
    VALUES (${id}::uuid, ${companyId}::uuid, ${branchId}::uuid, ${counterActor}, ${PRE}::timestamp)`);
  await owner.execute(sql`INSERT INTO receiving_report_items (receiving_report_id, item_id, received_quantity)
    VALUES (${id}::uuid, ${itemId}::uuid, ${qty})`);
  return id;
}

async function seedBatch(
  owner: Owner,
  input: {
    id: string;
    branchId: string;
    itemId: string;
    initial: number;
    current: number;
    reportId: string;
    movements: Array<{ type: string; qty: number }>;
  },
) {
  const info = JSON.stringify({ receivingReportId: input.reportId });
  await owner.execute(sql`INSERT INTO inventory_batches
      (id, item_id, branch_id, initial_quantity, current_quantity, status, supplier_batch_info, origin, created_at, updated_at)
    VALUES (${input.id}::uuid, ${input.itemId}::uuid, ${input.branchId}::uuid, ${String(input.initial)}::numeric,
      ${String(input.current)}::numeric, 'AVAILABLE', ${info}::jsonb, 'RECEIVING',
      ${PRE}::timestamp, ${PRE}::timestamp)`);
  for (const mv of input.movements) {
    await owner.execute(sql`INSERT INTO inventory_movements
        (branch_id, item_id, batch_id, type, quantity_change, reason, performed_by, timestamp)
      VALUES (${input.branchId}::uuid, ${input.itemId}::uuid, ${input.id}::uuid,
        ${mv.type}::inventory_transaction_type, ${String(mv.qty)}::numeric, 'seed', ${counterActor},
        ${PRE}::timestamp)`);
  }
}

async function fingerprint(owner: Owner) {
  const [row] = rows<Record<string, string>>(await owner.execute(sql`SELECT
    (SELECT count(*) FROM inventory_movements)::text AS movements,
    (SELECT count(*) FROM inventory_audit_log)::text AS audits,
    (SELECT md5(string_agg(id::text || ':' || current_quantity::text || ':' || updated_at::text, ',' ORDER BY id))
       FROM inventory_batches) AS batches`));
  return row;
}

async function batchState(owner: Owner, id: string) {
  const [row] = rows<{ current: string; ledger: string; markers: number; audits: number }>(
    await owner.execute(sql`
      SELECT b.current_quantity::text AS current,
        COALESCE((SELECT SUM(quantity_change) FROM inventory_movements WHERE batch_id = b.id), 0)::text AS ledger,
        (SELECT count(*)::int FROM inventory_movements WHERE batch_id = b.id AND type = 'ADJUSTMENT'
           AND reference_id = 'REC-03:H01:' || b.id::text) AS markers,
        (SELECT count(*)::int FROM inventory_audit_log a WHERE a.entity_type = 'ADJUSTMENT'
           AND a.metadata->>'reference' = 'REC-03:H01:' || b.id::text) AS audits
      FROM inventory_batches b WHERE b.id = ${id}::uuid`),
  );
  return {
    current: Number(row.current),
    ledger: Number(row.ledger),
    markers: row.markers,
    audits: row.audits,
  };
}

describe("REC-03B (V2 PostgreSQL nativo): protocolo de corrección histórica con conteo, unidad, aprobación separada y respaldo", () => {
  beforeAll(async () => {
    fixture = await createSalesRuntimeDatabase({ baseline: "0158" });
    process.env.DATABASE_URL = fixture.ownerUrl;
    protocolService = await import("@/lib/services/historical-correction-protocol-service");
    neonConfig.webSocketConstructor = ws;
    secondPool = new Pool({
      connectionString: fixture.ownerUrl,
      max: 1,
      connectionTimeoutMillis: 10_000,
    });
    secondPool.on("error", () => console.error("[rec03b] second pool error"));

    const owner = fixture.owner;
    await owner.execute(
      sql`INSERT INTO companies (id, name) VALUES (${companyA}::uuid, 'Empresa REC-03B A'), (${companyB}::uuid, 'Empresa REC-03B B')`,
    );
    await owner.execute(sql`INSERT INTO branches (id, company_id, name, timezone) VALUES
      (${branchA}::uuid, ${companyA}::uuid, 'Centro', 'America/Mexico_City'),
      (${branchB}::uuid, ${companyB}::uuid, 'B-Suc', 'America/Mexico_City')`);
    await owner.execute(sql`INSERT INTO inventory_items (id, company_id, name, unit) VALUES
      (${itemA}::uuid, ${companyA}::uuid, 'Harina', 'KG'),
      (${itemB}::uuid, ${companyB}::uuid, 'Aceite', 'L')`);

    // 1. SUFFICIENT respaldado (recibió 12 KG, consumió 4 KG -> observado 20, ledger 8, delta 12)
    await seedBatch(owner, {
      id: batchSufficient1,
      branchId: branchA,
      itemId: itemA,
      initial: 12,
      current: 20,
      reportId: await seedReport(owner, branchA, companyA, itemA, 12),
      movements: [
        { type: "RECEIVING", qty: 12 },
        { type: "USAGE", qty: -4 },
      ],
    });

    // 2. SUFFICIENT para carrera simultánea de 2 conexiones (recibió 6 KG -> observado 12, ledger 6, delta 6)
    await seedBatch(owner, {
      id: batchSufficientRace,
      branchId: branchA,
      itemId: itemA,
      initial: 6,
      current: 12,
      reportId: await seedReport(owner, branchA, companyA, itemA, 6),
      movements: [{ type: "RECEIVING", qty: 6 }],
    });

    // 3. AMBIGUOUS (delta 15 != recibido 10) -> debe permanecer retenido
    await seedBatch(owner, {
      id: batchAmbiguous,
      branchId: branchA,
      itemId: itemA,
      initial: 10,
      current: 25,
      reportId: await seedReport(owner, branchA, companyA, itemA, 10),
      movements: [{ type: "RECEIVING", qty: 10 }],
    });

    // 4. Lote SUFFICIENT de Empresa B -> bloqueado para actor de Empresa A
    await seedBatch(owner, {
      id: batchOtherCompany,
      branchId: branchB,
      itemId: itemB,
      initial: 5,
      current: 10,
      reportId: await seedReport(owner, branchB, companyB, itemB, 5),
      movements: [{ type: "RECEIVING", qty: 5 }],
    });
  }, 240_000);

  afterAll(async () => {
    try {
      await secondPool?.end();
      await fixture?.close();
    } finally {
      if (previous === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous;
    }
  }, 90_000);

  it("rechaza sin respaldo, unidad errónea, auto-aprobación, conteo discordante, lote ambiguo y cruce de empresa sin escribir", async () => {
    const owner = fixture!.owner;
    const before = await fingerprint(owner);

    const attempt = (
      overrides: Partial<Parameters<ProtocolService["applyHistoricalCorrectionProtocol"]>[1]>,
    ) =>
      owner.transaction((tx) =>
        protocolService.applyHistoricalCorrectionProtocol(tx, {
          companyId: companyA,
          batchId: batchSufficient1,
          expectedDelta: 12,
          countedQuantity: 8,
          unit: "KG",
          countedBy: counterActor,
          approverId: adminApprover,
          approverRole: "ADMIN",
          reason: REASON,
          backupReference: BACKUP_REF,
          ...overrides,
        }),
      );

    await expect(attempt({ backupReference: "x" })).rejects.toMatchObject({
      code: "BACKUP_REQUIRED",
      httpStatus: 400,
    });
    await expect(attempt({ unit: "LITRO" })).rejects.toMatchObject({
      code: "UNIT_MISMATCH",
      httpStatus: 400,
    });
    await expect(attempt({ approverId: counterActor })).rejects.toMatchObject({
      code: "SELF_APPROVAL",
      httpStatus: 403,
    });
    await expect(attempt({ approverRole: "GERENTE" })).rejects.toMatchObject({
      code: "INSUFFICIENT_ROLE",
      httpStatus: 403,
    });
    await expect(attempt({ countedQuantity: 7.5 })).rejects.toMatchObject({
      code: "COUNT_MISMATCH",
      httpStatus: 409,
    });
    await expect(
      attempt({ batchId: batchAmbiguous, expectedDelta: 15, countedQuantity: 10 }),
    ).rejects.toMatchObject({
      code: "NOT_SUFFICIENT",
      httpStatus: 409,
      reasons: ["DELTA_NOT_RECEIVED_QUANTITY"],
    });
    await expect(
      attempt({ batchId: batchOtherCompany, expectedDelta: 5, countedQuantity: 5, unit: "L" }),
    ).rejects.toMatchObject({
      code: "SCOPE_MISMATCH",
      httpStatus: 403,
    });

    expect(await fingerprint(owner)).toEqual(before);
    expect(await batchState(owner, batchAmbiguous)).toEqual({
      current: 25,
      ledger: 10,
      markers: 0,
      audits: 0,
    });
  });

  it("aplica solo al lote SUFFICIENT respaldado con AUD-02 completo y no duplica ante repetición ni carrera de 2 conexiones", async () => {
    const owner = fixture!.owner;
    const ambiguousBefore = await batchState(owner, batchAmbiguous);

    const applied = await owner.transaction((tx) =>
      protocolService.applyHistoricalCorrectionProtocol(tx, {
        companyId: companyA,
        batchId: batchSufficient1,
        expectedDelta: 12,
        countedQuantity: 8,
        unit: "kg",
        countedBy: counterActor,
        approverId: adminApprover,
        approverRole: "ADMIN",
        reason: REASON,
        backupReference: BACKUP_REF,
      }),
    );

    expect(applied).toMatchObject({
      status: "APPLIED",
      protocol: "REC-03B",
      batchId: batchSufficient1,
      adjustment: -12,
      before: 20,
      after: 8,
      unit: "KG",
      countedBy: counterActor,
      approverId: adminApprover,
      backupReference: BACKUP_REF,
    });
    expect(await batchState(owner, batchSufficient1)).toEqual({
      current: 8,
      ledger: 8,
      markers: 1,
      audits: 1,
    });

    const [audit] = rows<{
      performed_by: string;
      reason: string;
      metadata: Record<string, unknown>;
    }>(
      await owner.execute(sql`
        SELECT performed_by, reason, metadata
          FROM inventory_audit_log
         WHERE metadata->>'reference' = ${`REC-03:H01:${batchSufficient1}`}`),
    );
    expect(audit).toMatchObject({
      performed_by: adminApprover,
      reason: REASON,
      metadata: expect.objectContaining({
        protocol: "REC-03B",
        countedBy: counterActor,
        approverId: adminApprover,
        countedQuantity: 8,
        declaredUnit: "KG",
        backupReference: BACKUP_REF,
        ledgerQuantityChange: 0,
        balanceAdjustment: -12,
      }),
    });

    // Repetición idempotente no duplica
    const fpAfter = await fingerprint(owner);
    const repeat = await owner.transaction((tx) =>
      protocolService.applyHistoricalCorrectionProtocol(tx, {
        companyId: companyA,
        batchId: batchSufficient1,
        expectedDelta: 12,
        countedQuantity: 8,
        unit: "KG",
        countedBy: counterActor,
        approverId: adminApprover,
        approverRole: "ADMIN",
        reason: REASON,
        backupReference: BACKUP_REF,
      }),
    );
    expect(repeat.status).toBe("ALREADY_CORRECTED");
    expect(await fingerprint(owner)).toEqual(fpAfter);

    // Carrera real en 2 conexiones sobre batchSufficientRace
    const second = drizzle(secondPool!, { schema });
    const raceInput = {
      companyId: companyA,
      batchId: batchSufficientRace,
      expectedDelta: 6,
      countedQuantity: 6,
      unit: "KG",
      countedBy: counterActor,
      approverId: adminApprover,
      approverRole: "ADMIN",
      reason: REASON,
      backupReference: "neon-backup-2026-11-27-race",
    };
    const raceResults = await Promise.all([
      owner.transaction((tx) => protocolService.applyHistoricalCorrectionProtocol(tx, raceInput)),
      second.transaction((tx) => protocolService.applyHistoricalCorrectionProtocol(tx, raceInput)),
    ]);
    expect(raceResults.map((r) => r.status).sort()).toEqual(["ALREADY_CORRECTED", "APPLIED"]);
    expect(await batchState(owner, batchSufficientRace)).toEqual({
      current: 6,
      ledger: 6,
      markers: 1,
      audits: 1,
    });

    // Lote ambiguo sigue completamente intacto
    expect(await batchState(owner, batchAmbiguous)).toEqual(ambiguousBefore);
  });
});
