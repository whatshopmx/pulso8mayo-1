/**
 * Acceso directo a la base para preparar y limpiar datos de los specs E2E.
 *
 * Se conecta con el mismo `DATABASE_URL` de la app (base de desarrollo). Cada
 * spec crea sus propios registros marcados con `E2E_TAG` y los borra al final.
 */

import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { E2E_TAG } from "./constants";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("Falta DATABASE_URL: los specs E2E necesitan la base de desarrollo.");
}

export const sql = neon(url);

/** Cuántos SKUs de alto valor tiene la empresa ahora mismo. */
export async function countHighValueSkus(companyId: string): Promise<number> {
  const rows = await sql`
    SELECT COUNT(*)::int AS n
    FROM inventory_items
    WHERE company_id = ${companyId} AND is_high_value = true
  `;
  return rows[0]?.n ?? 0;
}

/**
 * Marca como alto valor tantos SKUs existentes como haga falta para llegar a
 * `target`. Devuelve los IDs tocados para poder revertirlos.
 */
export async function fillHighValueSkusUpTo(companyId: string, target: number): Promise<string[]> {
  const current = await countHighValueSkus(companyId);
  const missing = target - current;
  if (missing <= 0) return [];

  const rows = await sql`
    UPDATE inventory_items
    SET is_high_value = true
    WHERE id IN (
      SELECT id FROM inventory_items
      WHERE company_id = ${companyId}
        AND (is_high_value = false OR is_high_value IS NULL)
        AND active = true
      LIMIT ${missing}
    )
    RETURNING id
  `;
  return rows.map((r: any) => r.id as string);
}

/** Revierte a `is_high_value = false` los SKUs indicados. */
export async function unsetHighValue(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await sql`UPDATE inventory_items SET is_high_value = false WHERE id = ANY(${ids})`;
}

/** IDs de los SKUs marcados hoy como alto valor (para restaurar después). */
export async function snapshotHighValueIds(companyId: string): Promise<string[]> {
  const rows = await sql`
    SELECT id FROM inventory_items
    WHERE company_id = ${companyId} AND is_high_value = true
  `;
  return rows.map((r: any) => r.id as string);
}

/** Deja marcados como alto valor exactamente los IDs del snapshot. */
export async function restoreHighValue(companyId: string, ids: string[]): Promise<void> {
  await sql`UPDATE inventory_items SET is_high_value = false WHERE company_id = ${companyId}`;
  if (ids.length > 0) {
    await sql`UPDATE inventory_items SET is_high_value = true WHERE id = ANY(${ids})`;
  }
}

/** Crea SKUs de prueba (marcados con E2E_TAG) y devuelve sus IDs. */
export async function createTestSkus(
  companyId: string,
  count: number,
  opts: { isHighValue?: boolean; category?: string } = {}
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const rows = await sql`
      INSERT INTO inventory_items (company_id, name, sku, unit, category, active, is_high_value)
      VALUES (
        ${companyId},
        ${`${E2E_TAG} SKU ${Date.now()}-${i}`},
        ${`E2E-${Date.now()}-${i}`},
        'UNIT',
        ${opts.category ?? null},
        true,
        ${opts.isHighValue ?? false}
      )
      RETURNING id
    `;
    ids.push(rows[0].id as string);
  }
  return ids;
}

/** Cuenta artículos activos de una categoría, opcionalmente solo alto valor. */
export async function countItemsInCategory(
  companyId: string,
  category: string,
  highOnly: boolean
): Promise<number> {
  const rows = highOnly
    ? await sql`
        SELECT COUNT(*)::int AS n FROM inventory_items
        WHERE company_id = ${companyId} AND active = true
          AND category = ${category} AND is_high_value = true
      `
    : await sql`
        SELECT COUNT(*)::int AS n FROM inventory_items
        WHERE company_id = ${companyId} AND active = true
          AND category = ${category}
      `;
  return rows[0]?.n ?? 0;
}

/**
 * Borra los conteos activos (y sus pasos) de una sucursal — el service se niega
 * a crear uno nuevo mientras exista otro en curso.
 */
export async function deleteActiveCounts(branchId: string): Promise<void> {
  await sql`
    DELETE FROM workflow_instance_steps
    WHERE instance_id IN (
      SELECT id FROM workflow_instances
      WHERE branch_id = ${branchId} AND status IN ('PENDING', 'IN_PROGRESS')
    )
  `;
  await sql`
    DELETE FROM workflow_instances
    WHERE branch_id = ${branchId} AND status IN ('PENDING', 'IN_PROGRESS')
  `;
}

/** Lee el `data` jsonb de una instancia de workflow. */
export async function getInstanceData(instanceId: string): Promise<any | null> {
  const rows = await sql`
    SELECT data, status FROM workflow_instances WHERE id = ${instanceId} LIMIT 1
  `;
  return rows[0] ?? null;
}

/** Borra todos los artículos de inventario creados por los tests. */
export async function deleteTestSkus(): Promise<void> {
  await sql`DELETE FROM inventory_items WHERE name LIKE ${`${E2E_TAG}%`}`;
}

/** Borra los cortes de caja creados por los tests (por descripción/fuente). */
export async function deleteTestCuts(branchId: string, businessDate: string): Promise<void> {
  await sql`
    DELETE FROM daily_sales_cuts
    WHERE branch_id = ${branchId}
      AND business_date = ${businessDate}
      AND source = 'MANUAL_FORM'
  `;
}

/** Borra los gastos operativos creados por los tests. */
export async function deleteTestExpenses(): Promise<void> {
  await sql`DELETE FROM operating_expenses WHERE description LIKE ${`${E2E_TAG}%`}`;
}

/** Lee un gasto por descripción. */
export async function findExpenseByDescription(description: string): Promise<any | null> {
  const rows = await sql`
    SELECT id, description, amount_cents, evidence_url, status
    FROM operating_expenses
    WHERE description = ${description}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/**
 * Lee el corte manual más reciente de una sucursal para una fecha. Se acota a
 * `MANUAL_FORM` para no confundirse con los cortes sembrados o los de la
 * ingesta de POS.
 */
export async function findLatestCut(branchId: string, businessDate: string): Promise<any | null> {
  const rows = await sql`
    SELECT id, cash_sales, cash_counted_cents, deposited_cents, aggregator_sales, total_sales
    FROM daily_sales_cuts
    WHERE branch_id = ${branchId}
      AND business_date = ${businessDate}
      AND source = 'MANUAL_FORM'
    ORDER BY received_at DESC NULLS LAST
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/** Nombre de un proveedor existente de la empresa (para la recepción). */
export async function firstSupplierName(companyId: string): Promise<string | null> {
  const rows = await sql`
    SELECT name FROM suppliers WHERE company_id = ${companyId} ORDER BY name LIMIT 1
  `;
  return rows[0]?.name ?? null;
}

/**
 * Siembra una instancia del template de recepción con todos los pasos
 * completados salvo el último, que queda pendiente para cerrarlo desde el test.
 */
export async function seedRecepcionInstance(opts: {
  branchId: string;
  assigneeId: string;
  supplierName: string;
  discrepancia: string;
  ultimoPasoPendiente: string;
}): Promise<string> {
  const rows = await sql`
    INSERT INTO workflow_instances (workflow_template_id, branch_id, assignee_id, status, started_at, data)
    VALUES ('tpl-recepcion-mercancia-v2', ${opts.branchId}, ${opts.assigneeId}, 'IN_PROGRESS', NOW(), '{}'::jsonb)
    RETURNING id
  `;
  const instanceId = rows[0].id as string;

  const valores: Record<string, string> = {
    "paso-1": opts.supplierName,
    "paso-2": "https://example.test/e2e/factura.jpg",
    "paso-3": "4",
    "paso-4": "https://example.test/e2e/termometro.jpg",
    "paso-5": "https://example.test/e2e/producto.jpg",
    "paso-6": "https://example.test/e2e/caducidad.jpg",
    "paso-7": "10",
    "paso-8": "Aceptación parcial",
    "paso-9": "https://example.test/e2e/evidencia-discrepancia.jpg",
    "paso-10": opts.discrepancia,
    "paso-11": "ok",
    "paso-12": "si",
  };

  for (const [stepId, value] of Object.entries(valores)) {
    const pendiente = stepId === opts.ultimoPasoPendiente;
    // `value` es jsonb: se guarda como escalar JSON string, igual que la app.
    await sql`
      INSERT INTO workflow_instance_steps (instance_id, step_id, status, value, completed_at, completed_by)
      VALUES (
        ${instanceId},
        ${stepId},
        ${pendiente ? "PENDING" : "COMPLETED"},
        ${pendiente ? null : JSON.stringify(value)}::jsonb,
        ${pendiente ? null : new Date().toISOString()},
        ${pendiente ? null : opts.assigneeId}
      )
    `;
  }

  return instanceId;
}

/** Busca el reporte de recepción generado a partir de una instancia. */
export async function findReceivingReportForInstance(instanceId: string): Promise<any | null> {
  const rows = await sql`
    SELECT id, branch_id, supplier_id, notes, photo_urls
    FROM receiving_reports
    WHERE notes LIKE ${`%instance:${instanceId}%`}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/** Limpia instancia, pasos y reporte generados por el spec de recepción. */
export async function cleanupRecepcion(instanceId: string): Promise<void> {
  const reporte = await findReceivingReportForInstance(instanceId);
  if (reporte) {
    await sql`DELETE FROM receiving_report_items WHERE receiving_report_id = ${reporte.id}`;
    await sql`DELETE FROM receiving_reports WHERE id = ${reporte.id}`;
  }
  await sql`DELETE FROM workflow_instance_steps WHERE instance_id = ${instanceId}`;
  await sql`DELETE FROM workflow_instances WHERE id = ${instanceId}`;
}

/** Fecha de negocio de hoy en el mismo formato que usa la API (YYYY-MM-DD). */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}
