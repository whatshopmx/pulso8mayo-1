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
  opts: { isHighValue?: boolean; category?: string; unit?: string; tags?: string[] } = {}
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const rows = await sql`
      INSERT INTO inventory_items (company_id, name, sku, unit, category, active, is_high_value, tags)
      VALUES (
        ${companyId},
        ${`${E2E_TAG} SKU ${Date.now()}-${i}`},
        ${`E2E-${Date.now()}-${i}`},
        ${opts.unit ?? "UNIT"},
        ${opts.category ?? null},
        true,
        ${opts.isHighValue ?? false},
        ${JSON.stringify(opts.tags ?? [])}::jsonb
      )
      RETURNING id
    `;
    ids.push(rows[0].id as string);
  }
  return ids;
}

/**
 * Sucursal asignada a un usuario. Las páginas del dashboard toman `branchId` de
 * la sesión, no de la URL, así que un spec de UI tiene que sembrar en ESTA
 * sucursal — leerla evita que el spec se rompa si el seed cambia de sucursal.
 */
export async function findUserBranchId(email: string): Promise<string> {
  const rows = await sql`SELECT branch_id FROM users WHERE email = ${email} LIMIT 1`;
  const branchId = rows[0]?.branch_id as string | null | undefined;
  if (!branchId) {
    throw new Error(`El usuario ${email} no tiene sucursal asignada`);
  }
  return branchId;
}

/**
 * Siembra una regla de autorización de gastos.
 *
 * Sin reglas, `findAuthorizationRule` no encuentra ninguna y el aprobador
 * exigido cae a `OWNER`, así que **ningún** GERENTE puede aprobar nada. Un spec
 * que quiera probar la frontera de *sucursal* necesita antes que el rol alcance;
 * si no, el gasto se deniega por el motivo equivocado y el caso no prueba nada.
 *
 * El umbral ya no cambia quién puede firmar: desde A16 la auto-resolución está
 * prohibida en todos los tramos (`lib/expenses/approval-policy.ts`). El
 * `minAmount` sólo decide qué regla aplica a qué monto.
 */
export async function seedExpenseAuthorizationRule(opts: {
  companyId: string;
  approverRole: string;
  minAmountCents?: number;
  maxAmountCents?: number | null;
}): Promise<string> {
  const rows = await sql`
    INSERT INTO expense_authorization_rules (company_id, min_amount, max_amount, approver_role)
    VALUES (
      ${opts.companyId},
      ${opts.minAmountCents ?? 0},
      ${opts.maxAmountCents ?? null},
      ${opts.approverRole}
    )
    RETURNING id
  `;
  return rows[0].id as string;
}

/** Borra una regla sembrada por `seedExpenseAuthorizationRule`. */
export async function deleteExpenseAuthorizationRule(ruleId: string): Promise<void> {
  await sql`DELETE FROM expense_authorization_rules WHERE id = ${ruleId}`;
}

/**
 * Cambia (o quita) la sucursal de un usuario y devuelve la que tenía.
 *
 * Sirve para fabricar el caso `kind: "NONE"` de `resolveBranchScope` —un rol
 * acotado a sucursal **sin** ninguna asignada—, que no existe en la base
 * sembrada y que `assertBranchAssignment` impide crear desde la app.
 * `users.branch_id` sigue siendo nullable (ADMIN y SUPER_ADMIN legítimamente no
 * tienen sucursal), así que el estado es representable y hay que probarlo.
 *
 * Quien lo use tiene que restaurar en un `finally`: dejar a un GERENTE sembrado
 * sin sucursal rompe a los demás specs, que comparten esta base.
 */
export async function setUserBranchId(
  email: string,
  branchId: string | null
): Promise<string | null> {
  const previas = await sql`SELECT branch_id FROM users WHERE email = ${email} LIMIT 1`;
  if (previas.length === 0) {
    throw new Error(`No existe el usuario ${email}`);
  }
  await sql`UPDATE users SET branch_id = ${branchId} WHERE email = ${email}`;
  return (previas[0].branch_id as string | null) ?? null;
}

/** Escribe un timbrado directamente, sin pasar por el PAC ni por el servicio. */
export async function seedTimbrado(opts: {
  companyId: string;
  empleadoRfc: string;
  empleadoNombre?: string;
  periodo: string;
  uuid?: string | null;
  status: "TIMBRADO" | "PENDIENTE" | "RECHAZADO" | "ERROR";
}): Promise<string> {
  const rows = await sql`
    INSERT INTO cfdi_nomina_timbrados (
      company_id, empleado_rfc, empleado_nombre, periodo, uuid, status,
      cadena_original, sello_digital,
      total_percepciones_cents, total_deducciones_cents, fecha_timbrado
    )
    VALUES (
      ${opts.companyId},
      ${opts.empleadoRfc},
      ${opts.empleadoNombre ?? "[E2E] Empleada"},
      ${opts.periodo},
      ${opts.uuid ?? null},
      ${opts.status}::cfdi_timbrado_status,
      ${"||1.1|E2E||"},
      ${"SELLO-SEED"},
      1000000,
      100000,
      now()
    )
    RETURNING id
  `;
  return rows[0].id as string;
}

/** La fila de timbrado de un período, leída de la base y no del servicio. */
export async function findTimbrado(
  companyId: string,
  empleadoRfc: string,
  periodo: string
): Promise<{
  id: string;
  uuid: string | null;
  status: string;
  selloDigital: string | null;
  fechaTimbrado: Date | null;
  timbradoPor: string | null;
} | null> {
  const rows = await sql`
    SELECT id, uuid, status, sello_digital, fecha_timbrado, timbrado_por
    FROM cfdi_nomina_timbrados
    WHERE company_id = ${companyId}
      AND empleado_rfc = ${empleadoRfc}
      AND periodo = ${periodo}
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  return {
    id: rows[0].id as string,
    uuid: (rows[0].uuid as string | null) ?? null,
    status: rows[0].status as string,
    selloDigital: (rows[0].sello_digital as string | null) ?? null,
    fechaTimbrado: (rows[0].fecha_timbrado as Date | null) ?? null,
    timbradoPor: (rows[0].timbrado_por as string | null) ?? null,
  };
}

/** Cuántas filas de timbrado hay para un período. Un folio, una fila. */
export async function countTimbrados(
  companyId: string,
  empleadoRfc: string,
  periodo: string
): Promise<number> {
  const rows = await sql`
    SELECT COUNT(*)::int AS n FROM cfdi_nomina_timbrados
    WHERE company_id = ${companyId}
      AND empleado_rfc = ${empleadoRfc}
      AND periodo = ${periodo}
  `;
  return rows[0]?.n ?? 0;
}

/** Limpia los timbrados creados por los tests (RFCs con el prefijo `E2E`). */
export async function deleteTestTimbrados(): Promise<void> {
  await sql`DELETE FROM cfdi_nomina_timbrados WHERE empleado_rfc LIKE 'E2E%'`;
}

/** Siembra una plantilla de mapeo POS. `[E2E]` en el nombre para poder limpiarla. */
export async function seedMappingTemplate(opts: {
  companyId: string;
  nombre: string;
  isDefault?: boolean;
}): Promise<string> {
  const rows = await sql`
    INSERT INTO pos_mapping_templates (company_id, name, mapping, is_default)
    VALUES (
      ${opts.companyId},
      ${`${E2E_TAG} ${opts.nombre}`},
      ${JSON.stringify({ totalSales: "Total" })}::jsonb,
      ${opts.isDefault ?? false}
    )
    RETURNING id
  `;
  return rows[0].id as string;
}

/** Cuántas plantillas de la empresa están marcadas como default. */
export async function countDefaultMappingTemplates(companyId: string): Promise<number> {
  const rows = await sql`
    SELECT COUNT(*)::int AS n FROM pos_mapping_templates
    WHERE company_id = ${companyId} AND is_default = true
  `;
  return rows[0]?.n ?? 0;
}

/** Borra las plantillas de mapeo creadas por los tests. */
export async function deleteTestMappingTemplates(): Promise<void> {
  await sql`DELETE FROM pos_mapping_templates WHERE name LIKE ${`${E2E_TAG}%`}`;
}

/** Avisos in-app de un usuario, los más recientes primero. */
export async function findNotificationsForUser(
  userId: string
): Promise<Array<{ title: string; message: string; actionUrl: string | null }>> {
  const rows = await sql`
    SELECT title, message, action_url
    FROM notifications
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
  `;
  return rows.map((r: any) => ({
    title: r.title as string,
    message: r.message as string,
    actionUrl: (r.action_url as string | null) ?? null,
  }));
}

/** Limpia los avisos de un usuario, para que cada caso cuente desde cero. */
export async function deleteNotificationsForUser(userId: string): Promise<void> {
  await sql`DELETE FROM notifications WHERE user_id = ${userId}`;
}

/** El `id` de un usuario sembrado, para actuar en su nombre desde un servicio. */
export async function findUserIdByEmail(email: string): Promise<string> {
  const rows = await sql`SELECT id FROM users WHERE email = ${email} LIMIT 1`;
  const id = rows[0]?.id as string | undefined;
  if (!id) {
    throw new Error(`No existe el usuario ${email} (¿falta correr \`pnpm seed\`?)`);
  }
  return id;
}

/**
 * Etiqueta de un artículo tal como la pinta el `<Select>` de productos
 * (`{name} ({sku})`), para poder elegirlo por rol en un spec de UI.
 */
export async function findItemLabel(itemId: string): Promise<string> {
  const rows = await sql`SELECT name, sku FROM inventory_items WHERE id = ${itemId} LIMIT 1`;
  return `${rows[0].name} (${rows[0].sku})`;
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

/**
 * Borra todos los artículos de inventario creados por los tests.
 *
 * Autónomo a propósito: primero borra las filas que apuntan a ítems tagged,
 * aunque sean de corridas anteriores que murieron a media limpieza (timeout,
 * kill del proceso). Si sólo limpiara por los ids de la corrida actual, un
 * huérfano así bloquearía el DELETE con la FK `inventory_waste_item_id_...`
 * y TODOS los afterEach posteriores fallarían en cadena.
 *
 * Quedan fuera `invoice_lines` y `supplier_items` (también tienen FK hacia
 * ítems): son documentos de negocio; borrarlos en silencio podría corromper
 * facturas reales. Si algún día un spec enlaza un SKU de prueba a una factura,
 * esa limpieza es responsabilidad del spec.
 */
export async function deleteTestSkus(): Promise<void> {
  const tag = `${E2E_TAG}%`;
  // El driver `neon()` no compone fragmentos: el subSELECT se repite en cada
  // statement con el tag como parámetro.
  await sql`DELETE FROM inventory_waste WHERE item_id IN (SELECT id FROM inventory_items WHERE name LIKE ${tag})`;
  await sql`DELETE FROM inventory_movements WHERE item_id IN (SELECT id FROM inventory_items WHERE name LIKE ${tag})`;
  await sql`DELETE FROM inventory_batches WHERE item_id IN (SELECT id FROM inventory_items WHERE name LIKE ${tag})`;
  await sql`DELETE FROM inventory_alerts WHERE item_id IN (SELECT id FROM inventory_items WHERE name LIKE ${tag})`;
  await sql`DELETE FROM stock_counts WHERE item_id IN (SELECT id FROM inventory_items WHERE name LIKE ${tag})`;
  await sql`DELETE FROM inventory_snapshots WHERE item_id IN (SELECT id FROM inventory_items WHERE name LIKE ${tag})`;
  await sql`DELETE FROM inventory_items WHERE name LIKE ${tag}`;
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

/**
 * Inserta un gasto operativo con vencimiento en una fecha exacta.
 *
 * Lo usa `cash-flow.spec.ts` para forzar la colisión que destapa la nómina
 * contada dos veces: el bug solo aparece cuando un día de nómina (15 o 30)
 * comparte fecha con otro egreso, así que el spec tiene que sembrar ese otro
 * egreso en vez de esperar a que el seed lo traiga por casualidad.
 */
export async function seedOperatingExpense(opts: {
  companyId: string;
  branchId: string;
  requestedBy: string;
  dueDate: string;
  amountCents: number;
  description: string;
  category?: string;
  status?: string;
}): Promise<string> {
  const rows = await sql`
    INSERT INTO operating_expenses (
      company_id, branch_id, category, amount, description, status, requested_by, due_date
    )
    VALUES (
      ${opts.companyId},
      ${opts.branchId},
      ${opts.category ?? "OTROS"}::operating_expense_category,
      ${opts.amountCents},
      ${opts.description},
      ${opts.status ?? "APPROVED"}::operating_expense_status,
      ${opts.requestedBy},
      ${opts.dueDate}::date
    )
    RETURNING id
  `;
  return rows[0].id as string;
}

/**
 * Siembra `cantidad` gastos de golpe con el mismo estado.
 *
 * Existe para probar la cota asimétrica de `getOperatingExpenses`: demostrar
 * que el historial se acota y la cola de pendientes **no** exige pasar de 200
 * registros resueltos, y 200 llamadas a `seedOperatingExpense` tardaban más que
 * el timeout del spec. `generate_series` los inserta en una sola ida a Neon.
 *
 * Todas las descripciones llevan `E2E_TAG`, así que `deleteTestExpenses()` las
 * limpia sin tocar lo sembrado por `pnpm seed`.
 */
export async function seedManyOperatingExpenses(opts: {
  companyId: string;
  branchId: string;
  requestedBy: string;
  dueDate: string;
  cantidad: number;
  status: string;
  etiqueta: string;
}): Promise<number> {
  const rows = await sql`
    INSERT INTO operating_expenses (
      company_id, branch_id, category, amount, description, status, requested_by, due_date
    )
    SELECT
      ${opts.companyId},
      ${opts.branchId},
      'OTROS'::operating_expense_category,
      1000 + i,
      ${`${E2E_TAG} ${opts.etiqueta} `} || i,
      ${opts.status}::operating_expense_status,
      ${opts.requestedBy},
      ${opts.dueDate}::date
    FROM generate_series(1, ${opts.cantidad}) AS i
    RETURNING id
  `;
  return rows.length;
}

/**
 * Marca de los cortes de venta sembrados por los tests. `daily_sales_cuts` no
 * tiene columna de descripción, así que la etiqueta viaja en `validation_notes`
 * — es el único campo de texto libre de la tabla.
 */
export const E2E_SALES_CUT_NOTE = `${E2E_TAG} corte de prueba`;

/** Borra los cortes de venta sembrados por los tests. */
export async function deleteTestSalesCuts(): Promise<void> {
  await sql`DELETE FROM daily_sales_cuts WHERE validation_notes = ${E2E_SALES_CUT_NOTE}`;
}

/**
 * Siembra `cantidad` cortes en días **consecutivos** a partir de `desdeDia`.
 *
 * Un día por corte a propósito: el índice único de `daily_sales_cuts` es
 * `(company, branch, business_date, shift, channel)`, así que apilar varios el
 * mismo día con el mismo turno y canal choca. Sirve para probar cotas y rangos,
 * donde lo que importa es cuántas filas caen dentro y fuera del período.
 */
export async function seedCutsEnDiasConsecutivos(opts: {
  companyId: string;
  branchId: string;
  desdeDia: string;
  cantidad: number;
}): Promise<string[]> {
  const fechas: string[] = [];
  for (let i = 0; i < opts.cantidad; i++) {
    const d = new Date(`${opts.desdeDia}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    const fecha = d.toISOString().slice(0, 10);
    fechas.push(fecha);
    await sql`
      INSERT INTO daily_sales_cuts (
        company_id, branch_id, business_date, shift, channel,
        total_sales, source, status, validation_notes
      )
      VALUES (
        ${opts.companyId}, ${opts.branchId}, ${fecha}::date, 'COMPLETO', 'TOTAL',
        100000, 'MANUAL_FORM', 'VALIDATED', ${E2E_SALES_CUT_NOTE}
      )
      ON CONFLICT DO NOTHING
    `;
  }
  return fechas;
}

/**
 * Siembra `days` cortes de venta hacia atrás desde hoy, con un monto distinto
 * por día de la semana.
 *
 * Lo usa `cash-flow.spec.ts` para ejercitar la estimación de entradas: con la
 * base sembrada la compañía no tiene ningún corte, así que sin esto la
 * proyección solo puede probarse en su rama `NONE`. El monto por día de la
 * semana es lo que hace visible la estacionalidad — un sábado no vende lo mismo
 * que un martes, y el promedio plano anterior borraba justo esa diferencia.
 *
 * Devuelve el monto sembrado por día de la semana (índice 0 = domingo).
 */
export async function seedSalesCutHistory(opts: {
  companyId: string;
  branchId: string;
  days: number;
}): Promise<number[]> {
  const porDiaDeLaSemana = [
    1_800_000, // domingo
    900_000, // lunes
    950_000,
    1_000_000,
    1_200_000,
    1_900_000,
    2_400_000, // sábado
  ];

  const hoy = new Date();
  for (let i = 1; i <= opts.days; i++) {
    const fecha = new Date(hoy.getTime() - i * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const diaDeLaSemana = new Date(`${fecha}T00:00:00Z`).getUTCDay();
    await sql`
      INSERT INTO daily_sales_cuts (
        company_id, branch_id, business_date, shift, channel,
        total_sales, source, status, validation_notes
      )
      VALUES (
        ${opts.companyId}, ${opts.branchId}, ${fecha}::date, 'COMPLETO', 'TOTAL',
        ${porDiaDeLaSemana[diaDeLaSemana]}, 'MANUAL_FORM', 'VALIDATED',
        ${E2E_SALES_CUT_NOTE}
      )
    `;
  }

  return porDiaDeLaSemana;
}

/** Borra los supuestos de flujo de efectivo de una compañía. */
export async function deleteCashFlowAssumptions(companyId: string): Promise<void> {
  await sql`DELETE FROM cash_flow_assumptions WHERE company_id = ${companyId}`;
}

/**
 * Captura un saldo inicial. `branchId` null = supuesto del grupo completo.
 *
 * `asOfDaysAgo` permite envejecer el dato para ejercitar el aviso de "conviene
 * actualizarlo": un saldo sin fecha no dice nada, y uno de hace nueve días dice
 * algo distinto que uno de hoy.
 */
export async function seedCashFlowAssumption(opts: {
  companyId: string;
  branchId?: string | null;
  openingBalanceCents: number;
  /**
   * Fecha del saldo, en `YYYY-MM-DD`. **Se pasa explícita a propósito.**
   *
   * Usar `CURRENT_DATE - N` de Postgres hacía el test dependiente de la hora:
   * `CURRENT_DATE` es la fecha del servidor (UTC) y el servicio calcula la
   * antigüedad contra la fecha local de la operación (America/Mexico_City). Con
   * el reloj entre las 18:00 y la medianoche local, las dos fechas difieren y la
   * edad salía un día menos.
   */
  asOfDate?: string;
}): Promise<void> {
  // Hoy en la zona de la operación, que es con la que el servicio mide.
  const hoyLocal = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  await sql`
    INSERT INTO cash_flow_assumptions (
      company_id, branch_id, opening_balance_cents, as_of_date
    )
    VALUES (
      ${opts.companyId},
      ${opts.branchId ?? null},
      ${opts.openingBalanceCents},
      ${opts.asOfDate ?? hoyLocal}::date
    )
  `;
}

/** Borra las contrapartes (payees) creadas por los tests. */
export async function deleteTestPayees(): Promise<void> {
  // Los gastos de test que las referencian se borran primero: la FK
  // `operating_expenses.payee_id → payees.id` exige el orden.
  await sql`DELETE FROM operating_expenses WHERE description LIKE ${`${E2E_TAG}%`}`;
  await sql`DELETE FROM payees WHERE name LIKE ${`${E2E_TAG}%`}`;
}

/** Lee una contraparte por nombre. */
export async function findPayeeByName(name: string): Promise<any | null> {
  const rows = await sql`
    SELECT id, name, tax_id, active
    FROM payees
    WHERE name = ${name}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/**
 * Aprueba un gasto por SQL directo, saltándose la cadena de autorización.
 *
 * Existe por A16: desde que el servicio dejó de auto-aprobar, ningún gasto
 * nace `APPROVED`, y Cuentas por Pagar sólo lista lo autorizado
 * (`accounts-payable-service.ts:63`). Un spec que quiera probar **la CxP** —el
 * agrupado por contraparte, el bucket de vencimiento— necesita el gasto ya
 * aprobado, y hacerlo por el servicio exigiría un segundo usuario que no viene
 * al caso. Los specs que prueban la **autorización** no deben usar esto: para
 * eso está `approveOperatingExpense`.
 */
export async function approveTestExpense(expenseId: string): Promise<void> {
  await sql`
    UPDATE operating_expenses
    SET status = 'APPROVED', approval_notes = '[E2E] aprobado por el spec'
    WHERE id = ${expenseId}
  `;
}

/** Lee un gasto por descripción. */
export async function findExpenseByDescription(description: string): Promise<any | null> {
  // La columna se llama `amount` y ya está en centavos (`schema.ts:2688`); se
  // expone como `amount_cents` para que el spec lea el nombre con la unidad.
  const rows = await sql`
    SELECT id, description, amount AS amount_cents, evidence_url, status, payee_id,
           branch_id, approved_by, approval_notes
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

/**
 * Siembra un template con UN paso dinámico (`metadata.dynamicSource`) que se
 * expande a un sub-paso por SKU de alto valor con la etiqueta indicada, más un
 * paso de cierre. Devuelve el id del template.
 */
/**
 * Template de conteo con un paso dinámico. `closingStepId: null` deja el
 * template SIN pasos estáticos, que es como se comprueba qué pasa cuando el
 * filtro no coincide con nada y la instancia quedaría vacía (A10).
 */
export async function seedDynamicCountTemplate(
  companyId: string,
  tag: string,
  closingStepId: string | null = "confirmar"
): Promise<string> {
  const templateId = `e2e-tpl-conteo-dinamico-${Date.now()}`;
  const steps = [
    {
      id: "count",
      type: "NUMBER",
      title: "{{name}}",
      description: "Cantidad física encontrada",
      required: true,
      metadata: {
        dynamicSource: {
          entity: "inventory_item",
          filter: { isHighValue: true, tags: [tag] },
        },
      },
    },
    ...(closingStepId
      ? [
          {
            id: closingStepId,
            type: "TEXT",
            title: "Observaciones del conteo",
            required: false,
          },
        ]
      : []),
  ];

  await sql`
    INSERT INTO workflow_templates (id, company_id, name, description, steps, category, active)
    VALUES (
      ${templateId},
      ${companyId},
      ${`${E2E_TAG} Conteo dinámico`},
      'Template de prueba con paso dinámico',
      ${JSON.stringify(steps)}::jsonb,
      'INVENTORY',
      true
    )
  `;

  return templateId;
}

/** Cuántas instancias existen para un template (A10: la que NO debe crearse). */
export async function countInstancesForTemplate(templateId: string): Promise<number> {
  const rows = await sql`
    SELECT COUNT(*)::int AS n FROM workflow_instances WHERE workflow_template_id = ${templateId}
  `;
  return rows[0]?.n ?? 0;
}

/** Borra un template de prueba y todo lo que colgara de él. */
export async function deleteTemplate(templateId: string): Promise<void> {
  await sql`
    DELETE FROM workflow_instance_steps
    WHERE instance_id IN (SELECT id FROM workflow_instances WHERE workflow_template_id = ${templateId})
  `;
  await sql`DELETE FROM workflow_instances WHERE workflow_template_id = ${templateId}`;
  await sql`DELETE FROM workflow_templates WHERE id = ${templateId}`;
}

export interface CountStepRow {
  step_id: string;
  status: string;
  value: unknown;
}

/** Sub-pasos de conteo (`count-{itemId}`) de una instancia, en orden. */
export async function findCountStepsForInstance(instanceId: string): Promise<CountStepRow[]> {
  const rows = await sql`
    SELECT step_id, status, value
    FROM workflow_instance_steps
    WHERE instance_id = ${instanceId} AND step_id LIKE 'count-%'
    ORDER BY step_id
  `;
  return rows as CountStepRow[];
}

export interface StockCountRow {
  id: string;
  company_id: string;
  branch_id: string;
  item_id: string;
  /** numeric(12,4) — el driver lo devuelve como string ("2.5000"). */
  counted_quantity: string;
  system_quantity: string;
  evidence_url: string | null;
  counted_by: string | null;
  count_date: string;
}

/** Filas de `stock_counts` generadas por una instancia. */
export async function findStockCountsForInstance(instanceId: string): Promise<StockCountRow[]> {
  const rows = await sql`
    SELECT id, company_id, branch_id, item_id, counted_quantity, system_quantity,
           evidence_url, counted_by, count_date
    FROM stock_counts
    WHERE workflow_instance_id = ${instanceId}
    ORDER BY item_id
  `;
  return rows as StockCountRow[];
}

/**
 * Siembra una instancia de conteo **ya COMPLETADA** con un `completed_at`
 * elegido a mano, más un paso `count-{itemId}` por ítem.
 *
 * Existe porque la hora de cierre es justo la variable bajo prueba (A3/O-2) y
 * no se puede elegir cerrando el workflow por la API: ahí `completedAt` es
 * `NOW()`. Los pasos se insertan con la misma forma que `completeStep` —
 * `value` jsonb escalar— para que el extractor los lea igual que en producción.
 */
export async function seedCompletedCountInstance(opts: {
  templateId: string;
  branchId: string;
  assigneeId: string;
  /** Instante exacto del cierre, en UTC. */
  completedAt: Date;
  counts: Array<{ itemId: string; quantity: string }>;
}): Promise<string> {
  const rows = await sql`
    INSERT INTO workflow_instances (
      workflow_template_id, branch_id, assignee_id, status, started_at, completed_at, data
    )
    VALUES (
      ${opts.templateId},
      ${opts.branchId},
      ${opts.assigneeId},
      'COMPLETED',
      ${opts.completedAt.toISOString()},
      ${opts.completedAt.toISOString()},
      '{}'::jsonb
    )
    RETURNING id
  `;
  const instanceId = rows[0].id as string;

  for (const { itemId, quantity } of opts.counts) {
    await sql`
      INSERT INTO workflow_instance_steps (instance_id, step_id, status, value, completed_at, completed_by)
      VALUES (
        ${instanceId},
        ${`count-${itemId}`},
        'COMPLETED',
        ${JSON.stringify(quantity)}::jsonb,
        ${opts.completedAt.toISOString()},
        ${opts.assigneeId}
      )
    `;
  }

  return instanceId;
}

/** Borra los conteos, la instancia, sus pasos y el template de prueba. */
export async function cleanupStockCounts(
  instanceId: string,
  templateId?: string
): Promise<void> {
  await sql`DELETE FROM stock_counts WHERE workflow_instance_id = ${instanceId}`;
  await sql`DELETE FROM workflow_instance_steps WHERE instance_id = ${instanceId}`;
  await sql`DELETE FROM workflow_instances WHERE id = ${instanceId}`;
  if (templateId) {
    await sql`DELETE FROM workflow_templates WHERE id = ${templateId}`;
  }
}

/** Borra los conteos que apuntan a los SKUs de prueba (por si quedó alguno suelto). */
export async function deleteStockCountsForItems(itemIds: string[]): Promise<void> {
  if (itemIds.length === 0) return;
  await sql`DELETE FROM stock_counts WHERE item_id = ANY(${itemIds})`;
}

/** Fecha de negocio de hoy en el mismo formato que usa la API (YYYY-MM-DD). */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Siembra un lote AVAILABLE para un ítem en una sucursal y devuelve su id.
 * Desde la migración `0051`, `initial_quantity`/`current_quantity` son
 * `numeric(12,4)`: `quantity` acepta fracciones y la DB las devuelve como
 * string (`"2.5000"`) — usa `findBatchExactQuantity` para compararlas.
 */
export async function seedBatch(opts: {
  companyId: string;
  branchId: string;
  itemId: string;
  quantity: number;
  lotNumber?: string;
  unitCostCents?: number;
  expirationDate?: string; // ISO
}): Promise<string> {
  const rows = await sql`
    INSERT INTO inventory_batches (
      item_id, branch_id, initial_quantity, current_quantity, lot_number, unit_cost,
      status, expiration_date
    )
    VALUES (
      ${opts.itemId}, ${opts.branchId}, ${opts.quantity}, ${opts.quantity},
      ${opts.lotNumber ?? `E2E-LOT-${Date.now()}`},
      ${opts.unitCostCents ?? null},
      'AVAILABLE',
      ${opts.expirationDate ?? null}::timestamp
    )
    RETURNING id
  `;
  return rows[0].id as string;
}

/** Borra un lote sembrado por los tests. */
export async function deleteBatch(batchId: string): Promise<void> {
  await sql`DELETE FROM inventory_batches WHERE id = ${batchId}`;
}

/**
 * Inserta una fila directa en `stock_counts` (conteo físico de un día).
 * `countedQuantity` y `systemQuantity` son `numeric(12,4)` — acepta strings.
 */
export async function seedStockCount(opts: {
  companyId: string;
  branchId: string;
  itemId: string;
  countedQuantity: number | string;
  systemQuantity?: number | string;
  countDate?: string;
  countedBy?: string;
}): Promise<string> {
  const rows = await sql`
    INSERT INTO stock_counts (
      company_id, branch_id, item_id, counted_quantity, system_quantity, count_date, counted_by
    )
    VALUES (
      ${opts.companyId}, ${opts.branchId}, ${opts.itemId},
      ${String(opts.countedQuantity)}, ${String(opts.systemQuantity ?? 0)},
      ${opts.countDate ?? today()}, ${opts.countedBy ?? null}
    )
    RETURNING id
  `;
  return rows[0].id as string;
}

/** Borra un conteo sembrado por los tests. */
export async function deleteStockCount(countId: string): Promise<void> {
  await sql`DELETE FROM stock_counts WHERE id = ${countId}`;
}

export interface InventorySnapshotRow {
  id: string;
  company_id: string;
  branch_id: string;
  item_id: string;
  snapshot_date: string;
  calculated_stock: string;
  counted_stock: string | null;
  variance: string | null;
}

/** Filas de `inventory_snapshots` para una sucursal y fecha. */
export async function findSnapshotsForBranchDate(
  branchId: string,
  snapshotDate: string
): Promise<InventorySnapshotRow[]> {
  const rows = await sql`
    SELECT id, company_id, branch_id, item_id, snapshot_date,
           calculated_stock, counted_stock, variance
    FROM inventory_snapshots
    WHERE branch_id = ${branchId} AND snapshot_date = ${snapshotDate}
    ORDER BY item_id
  `;
  return rows as InventorySnapshotRow[];
}

/** Borra los snapshots de una sucursal y fecha (y los que apunten a ítems de prueba). */
export async function deleteSnapshots(opts: {
  branchId?: string;
  snapshotDate?: string;
  itemIds?: string[];
}): Promise<void> {
  if (opts.branchId && opts.snapshotDate) {
    await sql`
      DELETE FROM inventory_snapshots
      WHERE branch_id = ${opts.branchId} AND snapshot_date = ${opts.snapshotDate}
    `;
  }
  if (opts.itemIds && opts.itemIds.length > 0) {
    await sql`DELETE FROM inventory_snapshots WHERE item_id = ANY(${opts.itemIds})`;
  }
}

/**
 * Siembra un template de merma: 3 pasos dinámicos sobre `inventory_item`
 * (cantidad, motivo, foto) + paso de cierre. Devuelve el id del template.
 * El resolver genérico expande cada paso dinámico a N sub-pasos
 * `{parentId}-{itemId}` — uno por SKU de alto valor con la etiqueta pedida.
 */
export async function seedMermaTemplate(
  companyId: string,
  tag: string,
  closingStepId = "merma-obs"
): Promise<string> {
  const templateId = `e2e-tpl-merma-${Date.now()}`;
  const source = {
    entity: "inventory_item",
    filter: { isHighValue: true, tags: [tag] },
  };
  const steps = [
    {
      id: "merma-qty",
      type: "NUMBER",
      title: "Cantidad en merma de {{name}}",
      description: "Cantidad física a dar de baja",
      required: true,
      metadata: { dynamicSource: source },
    },
    {
      id: "merma-reason",
      type: "SELECT",
      title: "Motivo de la merma de {{name}}",
      required: true,
      options: ["caducidad", "caida", "error_cocina", "cortesia"],
      metadata: { dynamicSource: source },
    },
    {
      id: "merma-evidence",
      type: "PHOTO",
      title: "Foto de la merma de {{name}}",
      required: true,
      metadata: { dynamicSource: source },
    },
    {
      id: closingStepId,
      type: "TEXT",
      title: "Observaciones",
      required: false,
    },
  ];

  await sql`
    INSERT INTO workflow_templates (id, company_id, name, description, steps, category, active)
    VALUES (
      ${templateId},
      ${companyId},
      ${`${E2E_TAG} Merma dinámica`},
      'Template de prueba con pasos dinámicos de merma',
      ${JSON.stringify(steps)}::jsonb,
      'INVENTORY',
      true
    )
  `;

  return templateId;
}

/**
 * Siembra una instancia de merma YA COMPLETADA con sus pasos
 * `merma-qty-{itemId}` / `merma-reason-{itemId}` / `merma-evidence-{itemId}`.
 *
 * Gemelo de `seedCompletedProductionInstance`: sirve para llamar al extractor
 * directo, sin servidor ni dev server de Inngest.
 */
export async function seedCompletedMermaInstance(opts: {
  templateId: string;
  branchId: string;
  assigneeId: string;
  items: Array<{ itemId: string; quantity: number; reason: string; evidenceUrl?: string }>;
  completedAt?: Date;
}): Promise<string> {
  const completedAt = (opts.completedAt ?? new Date()).toISOString();
  const rows = await sql`
    INSERT INTO workflow_instances (
      workflow_template_id, branch_id, assignee_id, status, started_at, completed_at, data
    )
    VALUES (
      ${opts.templateId},
      ${opts.branchId},
      ${opts.assigneeId},
      'COMPLETED',
      ${completedAt},
      ${completedAt},
      '{}'::jsonb
    )
    RETURNING id
  `;
  const instanceId = rows[0].id as string;

  for (const item of opts.items) {
    const pasos: Array<[string, string]> = [
      [`merma-qty-${item.itemId}`, String(item.quantity)],
      [`merma-reason-${item.itemId}`, item.reason],
      [
        `merma-evidence-${item.itemId}`,
        item.evidenceUrl ?? `https://example.test/e2e-merma-${item.itemId}.jpg`,
      ],
    ];
    for (const [stepId, value] of pasos) {
      await sql`
        INSERT INTO workflow_instance_steps (instance_id, step_id, status, value, completed_at, completed_by)
        VALUES (
          ${instanceId},
          ${stepId},
          'COMPLETED',
          ${JSON.stringify(value)}::jsonb,
          ${completedAt},
          ${opts.assigneeId}
        )
      `;
    }
  }

  return instanceId;
}

export interface WasteRow {
  id: string;
  company_id: string;
  branch_id: string;
  item_id: string;
  quantity: number;
  unit: string;
  reason: string;
  recorded_by: string | null;
  notes: string | null;
  evidence_url?: string | null;
}

/** Filas de `inventory_waste` cuyo `notes` marca una instancia. */
export async function findWasteForInstance(instanceId: string): Promise<WasteRow[]> {
  const rows = await sql`
    SELECT id, company_id, branch_id, item_id, quantity, unit, reason, recorded_by, notes, evidence_url
    FROM inventory_waste
    WHERE notes LIKE ${`%instance:${instanceId}%`}
    ORDER BY item_id
  `;
  return (rows as WasteRow[]).map((row) => ({ ...row, quantity: Number(row.quantity) }));
}

/**
 * Fija (o limpia con `null`) la evidencia de una fila de merma. Sirve para
 * simular filas "pre-fix" en el spec del backfill: el extractor actual ya
 * guarda `evidence_url`, así que se escribe y luego se limpiar selectivamente.
 */
export async function setWasteEvidenceUrl(wasteId: string, url: string | null): Promise<void> {
  await sql`UPDATE inventory_waste SET evidence_url = ${url} WHERE id = ${wasteId}`;
}

/** Borra merma por instancia, más pasos/instancia/template. */
export async function cleanupMerma(instanceId: string, templateId?: string): Promise<void> {
  await sql`DELETE FROM inventory_waste WHERE notes LIKE ${`%instance:${instanceId}%`}`;
  await sql`DELETE FROM workflow_instance_steps WHERE instance_id = ${instanceId}`;
  await sql`DELETE FROM workflow_instances WHERE id = ${instanceId}`;
  if (templateId) {
    await sql`DELETE FROM workflow_templates WHERE id = ${templateId}`;
  }
}

/** Borra la merma que apunte a los SKUs de prueba. */
export async function deleteWasteForItems(itemIds: string[]): Promise<void> {
  if (itemIds.length === 0) return;
  await sql`DELETE FROM inventory_waste WHERE item_id = ANY(${itemIds})`;
}

/** Ajusta el umbral de varianza de merma del tenant (T11). */
export async function setMermaThreshold(companyId: string, pct: number): Promise<void> {
  await sql`
    INSERT INTO tenant_operating_config (company_id, merma_variance_threshold_pct)
    VALUES (${companyId}, ${String(pct)})
    ON CONFLICT (company_id) DO UPDATE
    SET merma_variance_threshold_pct = EXCLUDED.merma_variance_threshold_pct
  `;
}

/** Valor actual del umbral del tenant, o `null` si no hay fila configurada. */
export async function getMermaThreshold(companyId: string): Promise<string | null> {
  const rows = await sql`
    SELECT merma_variance_threshold_pct FROM tenant_operating_config WHERE company_id = ${companyId} LIMIT 1
  `;
  return rows[0]?.merma_variance_threshold_pct ?? null;
}

/** Restaura el umbral a su valor previo (o borra la fila si no existía). */
export async function restoreMermaThreshold(
  companyId: string,
  previous: string | null
): Promise<void> {
  if (previous === null) {
    await sql`DELETE FROM tenant_operating_config WHERE company_id = ${companyId}`;
  } else {
    await sql`
      UPDATE tenant_operating_config
      SET merma_variance_threshold_pct = ${previous}
      WHERE company_id = ${companyId}
    `;
  }
}

// --- Merma por API directa (T5, plan-inventory-waste) -------------------------

/** { "id": "...", "quantity": "0.4000", "unit": ... } — quantity como string de la DB. */
export interface WasteApiRow {
  id: string;
  /** Dato numérico (coercionado con `Number()`). */
  quantity: number;
  /** Valor crudo en la DB (numeric → string, p. ej. "0.4000"). */
  quantityRaw: string;
  unit: string;
  reason: string;
  totalLoss: number | null;
}

/** Filas de `inventory_waste` de un ítem (más recientes primero). */
export async function findWasteForItem(itemId: string): Promise<WasteApiRow[]> {
  const rows = await sql`
    SELECT id, quantity, unit, reason, total_loss
    FROM inventory_waste
    WHERE item_id = ${itemId}
    ORDER BY recorded_at DESC
  `;
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    quantity: Number(r.quantity),
    quantityRaw: String(r.quantity),
    unit: r.unit as string,
    reason: r.reason as string,
    totalLoss: r.total_loss == null ? null : Number(r.total_loss),
  }));
}

export interface WasteMovementRow {
  id: string;
  /** quantity_change crudo (numeric → string, p. ej. "-0.4000"). */
  quantityChangeRaw: string;
  type: string;
  reason: string | null;
}

/** Movimientos de inventario de un ítem (más recientes primero). */
export async function findMovementsForItem(itemId: string): Promise<WasteMovementRow[]> {
  const rows = await sql`
    SELECT id, quantity_change, type, reason
    FROM inventory_movements
    WHERE item_id = ${itemId}
    ORDER BY timestamp DESC
  `;
  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    quantityChangeRaw: String(r.quantity_change),
    type: r.type as string,
    reason: (r.reason as string | null) ?? null,
  }));
}

/** `current_quantity` exacto (string) de un lote — sin truncar a entero. */
export async function findBatchExactQuantity(batchId: string): Promise<string> {
  const rows = await sql`
    SELECT current_quantity FROM inventory_batches WHERE id = ${batchId}
  `;
  return rows[0] == null ? "0" : String(rows[0].current_quantity);
}

/** Borra los movimientos de inventario de los ítems indicados. */
export async function deleteMovementsForItems(itemIds: string[]): Promise<void> {
  if (itemIds.length === 0) return;
  await sql`DELETE FROM inventory_movements WHERE item_id = ANY(${itemIds})`;
}

/**
 * Siembra un tenant ajeno (empresa + sucursal + ítem + lote) para probar que la
 * ruta de mermas NO deja escribir cross-tenant. Devuelve los IDs para limpiar.
 */
export async function seedForeignTenant(): Promise<{
  companyId: string;
  branchId: string;
  itemId: string;
  batchId: string;
}> {
  const stamp = Date.now();
  const [company] = await sql`
    INSERT INTO companies (name) VALUES (${`${E2E_TAG} tenant ajeno`}) RETURNING id
  `;
  const [branch] = await sql`
    INSERT INTO branches (company_id, name)
    VALUES (${company.id}, ${`${E2E_TAG} sucursal ajena`})
    RETURNING id
  `;
  const [item] = await sql`
    INSERT INTO inventory_items (company_id, name, sku, unit, active)
    VALUES (${company.id}, ${`${E2E_TAG} ítem ajeno`}, ${`E2E-FOREIGN-${stamp}`}, 'KG', true)
    RETURNING id
  `;
  const [batch] = await sql`
    INSERT INTO inventory_batches (item_id, branch_id, initial_quantity, current_quantity, lot_number, status)
    VALUES (${item.id}, ${branch.id}, 5, 5, ${`E2E-FOREIGN-LOT-${stamp}`}, 'AVAILABLE')
    RETURNING id
  `;
  return {
    companyId: company.id as string,
    branchId: branch.id as string,
    itemId: item.id as string,
    batchId: batch.id as string,
  };
}

/** Limpia el tenant ajeno sembrado por `seedForeignTenant`. */
export async function cleanupForeignTenant(opts: {
  companyId: string;
  branchId: string;
  itemId: string;
  batchId: string;
}): Promise<void> {
  // `inventory_waste` es la única tabla con FKs hacia estos ítems/lotes/sucursales.
  await sql`DELETE FROM inventory_waste WHERE item_id = ${opts.itemId}`;
  await sql`DELETE FROM inventory_waste WHERE batch_id = ${opts.batchId}`;
  await sql`DELETE FROM inventory_movements WHERE item_id = ${opts.itemId}`;
  await sql`DELETE FROM inventory_batches WHERE id = ${opts.batchId}`;
  await sql`DELETE FROM inventory_items WHERE id = ${opts.itemId}`;
  // Caja chica y cortes se limpian por `branch_id`, sin filtrar por empresa: un
  // spec de frontera de tenant escribe precisamente filas cuyo `company_id` es
  // el de *otra* empresa. Si esta limpieza las filtrara por `opts.companyId` no
  // las vería, el `DELETE` de la sucursal chocaría contra la llave foránea, y el
  // tenant ajeno quedaría vivo en la base de dev.
  const fondos = await sql`SELECT id FROM petty_cash_funds WHERE branch_id = ${opts.branchId}`;
  const fondoIds = fondos.map((r: any) => r.id as string);
  if (fondoIds.length > 0) {
    await sql`DELETE FROM petty_cash_transactions WHERE fund_id = ANY(${fondoIds})`;
    await sql`DELETE FROM petty_cash_funds WHERE id = ANY(${fondoIds})`;
  }
  await sql`DELETE FROM daily_sales_cuts WHERE branch_id = ${opts.branchId}`;
  await sql`DELETE FROM branches WHERE id = ${opts.branchId}`;
  await sql`DELETE FROM companies WHERE id = ${opts.companyId}`;
}

/** Borra las recetas creadas por los tests (y sus ingredientes). */
export async function deleteTestRecipes(): Promise<void> {
  await sql`
    DELETE FROM recipe_items
    WHERE recipe_id IN (SELECT id FROM recipes WHERE name LIKE ${`${E2E_TAG}%`})
  `;
  await sql`DELETE FROM recipes WHERE name LIKE ${`${E2E_TAG}%`}`;
}

// --- Producción (Fase 4) ---------------------------------------------------

/** Crea una receta de prueba (marcada E2E) y devuelve su id. */
export async function seedRecipe(
  companyId: string,
  name: string,
  opts: { unit?: string; baseYield?: string; tags?: string[] } = {}
): Promise<string> {
  const rows = await sql`
    INSERT INTO recipes (company_id, name, base_yield, unit, tags)
    VALUES (
      ${companyId},
      ${`${E2E_TAG} ${name}`},
      ${opts.baseYield ?? "1.00"},
      ${opts.unit ?? "PORTION"},
      ${JSON.stringify(opts.tags ?? [])}::jsonb
    )
    RETURNING id
  `;
  return rows[0].id as string;
}

/** Agrega un ingrediente a una receta (cantidad por porción). */
export async function seedRecipeItem(opts: {
  recipeId: string;
  itemId: string;
  quantity: number;
  unit: string;
  isSubRecipe?: boolean;
  yieldPercent?: number;
}): Promise<void> {
  await sql`
    INSERT INTO recipe_items (recipe_id, item_id, quantity, unit, is_sub_recipe, yield_percent)
    VALUES (
      ${opts.recipeId}, ${opts.itemId}, ${String(opts.quantity)},
      ${opts.unit}, ${opts.isSubRecipe ?? false}, ${opts.yieldPercent ?? 100}
    )
  `;
}

/**
 * Siembra un template de producción: UN paso dinámico `prod-qty` sobre
 * `entity: 'recipe'` (filtro por tag) + paso de cierre.
 */
export async function seedProductionTemplate(
  companyId: string,
  tag: string,
  closingStepId = "prod-obs"
): Promise<string> {
  const templateId = `e2e-tpl-produccion-${Date.now()}`;
  const steps = [
    {
      id: "prod-qty",
      type: "NUMBER",
      title: "Porciones a producir de {{name}}",
      description: "Cantidad de porciones producidas hoy",
      required: true,
      metadata: {
        dynamicSource: {
          entity: "recipe",
          filter: { tags: [tag] },
        },
      },
    },
    {
      id: closingStepId,
      type: "TEXT",
      title: "Observaciones de producción",
      required: false,
    },
  ];

  await sql`
    INSERT INTO workflow_templates (id, company_id, name, description, steps, category, active)
    VALUES (
      ${templateId},
      ${companyId},
      ${`${E2E_TAG} Producción diaria`},
      'Template de prueba con paso dinámico de recetas',
      ${JSON.stringify(steps)}::jsonb,
      'PRODUCTION',
      true
    )
  `;
  return templateId;
}

/**
 * Siembra una instancia de producción YA COMPLETADA con sus pasos
 * `prod-qty-{recipeId}`, para llamar al extractor directo sin pasar por la API.
 *
 * Mismo motivo que `seedCompletedCountInstance`: los specs que miden lo que el
 * extractor ESCRIBE no necesitan el servidor ni el dev server de Inngest, y
 * corren en segundos en vez de minutos.
 */
export async function seedCompletedProductionInstance(opts: {
  templateId: string;
  branchId: string;
  assigneeId: string;
  portions: Array<{ recipeId: string; quantity: number }>;
  completedAt?: Date;
}): Promise<string> {
  const completedAt = (opts.completedAt ?? new Date()).toISOString();
  const rows = await sql`
    INSERT INTO workflow_instances (
      workflow_template_id, branch_id, assignee_id, status, started_at, completed_at, data
    )
    VALUES (
      ${opts.templateId},
      ${opts.branchId},
      ${opts.assigneeId},
      'COMPLETED',
      ${completedAt},
      ${completedAt},
      '{}'::jsonb
    )
    RETURNING id
  `;
  const instanceId = rows[0].id as string;

  for (const { recipeId, quantity } of opts.portions) {
    await sql`
      INSERT INTO workflow_instance_steps (instance_id, step_id, status, value, completed_at, completed_by)
      VALUES (
        ${instanceId},
        ${`prod-qty-${recipeId}`},
        'COMPLETED',
        ${JSON.stringify(String(quantity))}::jsonb,
        ${completedAt},
        ${opts.assigneeId}
      )
    `;
  }

  return instanceId;
}

export interface ProductionResultRow {
  id: string;
  company_id: string;
  branch_id: string;
  recipe_id: string;
  produced_quantity: number;
  notes: string | null;
}

export interface ProductionIngredientRow {
  id: string;
  result_id: string;
  item_id: string;
  batch_id: string | null;
  expected_quantity: number;
  actual_quantity: number;
  unit: string;
  /** Centavos por unidad tomados del lote. */
  unit_cost: number | null;
  /** Centavos totales: se calcula con la cantidad EXACTA, no con la registrada. */
  total_cost: number | null;
}

/** Resultados de producción generados por una instancia. */
export async function findProductionResultsForInstance(
  instanceId: string
): Promise<ProductionResultRow[]> {
  const rows = await sql`
    SELECT id, company_id, branch_id, recipe_id, produced_quantity, notes
    FROM production_results
    WHERE notes LIKE ${`%instance:${instanceId}%`}
    ORDER BY created_at
  `;
  return rows as ProductionResultRow[];
}

/** Ingredientes (por par item/lote) de un resultado de producción. */
export async function findProductionIngredients(
  resultId: string
): Promise<ProductionIngredientRow[]> {
  const rows = await sql`
    SELECT id, result_id, item_id, batch_id, expected_quantity, actual_quantity, unit,
           unit_cost, total_cost
    FROM production_ingredients
    WHERE result_id = ${resultId}
    ORDER BY item_id, batch_id
  `;
  // Las cantidades son `numeric(12,4)` desde A7b y el driver las entrega como
  // string ("6.0000"): se convierten aquí para que los specs comparen números,
  // que es lo que su tipo siempre prometió.
  return rows.map((r) => ({
    ...r,
    expected_quantity: Number(r.expected_quantity),
    actual_quantity: Number(r.actual_quantity),
  })) as ProductionIngredientRow[];
}

/**
 * Stock actual de un lote.
 *
 * `current_quantity` es `numeric(12,4)` desde la migración `0051`: se lee como
 * `float8` y no como `int`, o el propio helper redondearía la fracción que
 * algunos specs miden (A7). Para cantidades enteras devuelve lo mismo de antes.
 */
export async function findBatchQuantity(batchId: string): Promise<number> {
  const rows = await sql`SELECT current_quantity::float8 AS q FROM inventory_batches WHERE id = ${batchId}`;
  return rows[0]?.q ?? 0;
}

/** Limpia resultados, ingredientes, pasos, instancia y template de producción. */
export async function cleanupProduction(
  instanceId: string,
  templateId?: string
): Promise<void> {
  await sql`DELETE FROM inventory_waste WHERE notes LIKE ${`%instance:${instanceId}%`}`;
  await sql`
    DELETE FROM production_ingredients
    WHERE result_id IN (SELECT id FROM production_results WHERE notes LIKE ${`%instance:${instanceId}%`})
  `;
  await sql`DELETE FROM production_results WHERE notes LIKE ${`%instance:${instanceId}%`}`;
  await sql`DELETE FROM workflow_instance_steps WHERE instance_id = ${instanceId}`;
  await sql`DELETE FROM workflow_instances WHERE id = ${instanceId}`;
  if (templateId) {
    await sql`DELETE FROM workflow_templates WHERE id = ${templateId}`;
  }
}

// --- Revisión de workflows (T8 del plan workflow-review-critique) -------------

/** Cómo se ve cada paso de una instancia sembrada para la revisión. */
export interface ReviewStepSeed {
  /** ID del paso dentro del template (p. ej. "paso-3"). */
  stepId: string;
  /** Veredicto de la verificación AI simulada (se guarda en `ai_analysis`). */
  passed: boolean;
  confidence?: number;
  reason?: string;
  evidenceUrl?: string | null;
  comment?: string | null;
  value?: unknown;
  /** Tipo del paso en la plantilla. Por defecto TEXT/PHOTO según `passed`. */
  type?: string;
  /** Título en la plantilla. Por defecto `Paso <stepId>`. */
  title?: string;
  description?: string;
  unit?: string;
  /** Rango esperado, para probar el marcado de valores fuera de rango. */
  validation?: { min?: number; max?: number };
  /**
   * Siembra el paso en la instancia pero NO en la plantilla, para reproducir un
   * paso cuya definición no es localizable (plantilla editada, paso dinámico
   * nunca persistido). La revisión debe degradarlo, no inventarle un título.
   */
  omitFromTemplate?: boolean;
}

/**
 * Siembra una ejecución COMPLETADA lista para revisar: template propio de la
 * empresa (para que pase el filtro del historial y el chequeo de tenant del
 * service), instancia con `score` y sin `review_status`, y pasos en orden de
 * creación con `ai_analysis`, `evidence_url` y `comment`.
 *
 * Devuelve la instancia y el template para limpiarlos con
 * `cleanupReviewInstance`. La instalación de los pasos se hace en orden, en
 * inserts consecutivos: `getExecution` los devuelve sin ORDER BY y la
 * numeración canónica de pasos depende de ese orden físico (plan T8b).
 */
export async function seedReviewInstance(
  companyId: string,
  opts: {
    branchId: string;
    assigneeId: string;
    score: number;
    steps: ReviewStepSeed[];
    /**
     * Congela la definición en la instancia (migración 0050), como hace
     * `createExecution` desde T8. Sin esto se siembra una instancia "antigua",
     * que resuelve contra la plantilla viva.
     */
    freeze?: boolean;
  }
): Promise<{ instanceId: string; workflowTemplateId: string }> {
  const workflowTemplateId = `e2e-tpl-revision-${Date.now()}`;
  const templateSteps = opts.steps
    .filter((s) => !s.omitFromTemplate)
    .map((s) => ({
      id: s.stepId,
      type: s.type ?? (s.passed ? "TEXT" : "PHOTO"),
      title: s.title ?? `Paso ${s.stepId}`,
      description: s.description ?? "",
      required: true,
      ...(s.unit ? { unit: s.unit } : {}),
      ...(s.validation ? { validation: s.validation } : {}),
    }));

  await sql`
    INSERT INTO workflow_templates (id, company_id, name, description, steps, category, active)
    VALUES (
      ${workflowTemplateId},
      ${companyId},
      ${`${E2E_TAG} Revisión e2e`},
      'Template de prueba para la revisión de workflows',
      ${JSON.stringify(templateSteps)}::jsonb,
      'QUALITY',
      true
    )
  `;

  const [inst] = await sql`
    INSERT INTO workflow_instances (
      workflow_template_id, branch_id, assignee_id, status, score, started_at, completed_at, data
    )
    VALUES (
      ${workflowTemplateId}, ${opts.branchId}, ${opts.assigneeId},
      'COMPLETED', ${opts.score}, NOW(), NOW(), '{}'::jsonb
    )
    RETURNING id
  `;
  const instanceId = inst.id as string;

  // Insertar en orden; un solo paso por INSERT para respetar el patrón del resto
  // de la suite (el heap del driver devuelve las filas en orden de inserción).
  for (const [index, s] of opts.steps.entries()) {
    const definition = {
      id: s.stepId,
      type: s.type ?? (s.passed ? "TEXT" : "PHOTO"),
      title: s.title ?? `Paso ${s.stepId}`,
      description: s.description ?? "",
      required: true,
      ...(s.unit ? { unit: s.unit } : {}),
      ...(s.validation ? { validation: s.validation } : {}),
    };

    await sql`
      INSERT INTO workflow_instance_steps (
        instance_id, step_id, status, value, ai_analysis, evidence_url, comment, completed_at, completed_by,
        step_order, title, type, definition
      )
      VALUES (
        ${instanceId},
        ${s.stepId},
        'COMPLETED',
        ${s.value !== undefined ? JSON.stringify(s.value) : null}::jsonb,
        ${JSON.stringify({
          passed: s.passed,
          confidence: s.confidence ?? null,
          reason: s.reason ?? null,
        })}::jsonb,
        ${s.evidenceUrl ?? null},
        ${s.comment ?? null},
        NOW(),
        ${opts.assigneeId},
        ${opts.freeze ? index : null},
        ${opts.freeze ? definition.title : null},
        ${opts.freeze ? definition.type : null},
        ${opts.freeze ? JSON.stringify(definition) : null}::jsonb
      )
    `;
  }

  return { instanceId, workflowTemplateId };
}

/**
 * Reescribe el título de un paso en la plantilla, para probar que una revisión
 * ya ejecutada no cambia con ella (la definición congelada manda).
 */
export async function renameReviewTemplateStep(
  workflowTemplateId: string,
  stepId: string,
  nuevoTitulo: string
): Promise<void> {
  const [row] = await sql`
    SELECT steps FROM workflow_templates WHERE id = ${workflowTemplateId}
  `;
  const steps = (row?.steps ?? []) as Array<{ id: string; title?: string }>;
  const actualizados = steps.map((s) =>
    s.id === stepId ? { ...s, title: nuevoTitulo } : s
  );
  await sql`
    UPDATE workflow_templates
    SET steps = ${JSON.stringify(actualizados)}::jsonb
    WHERE id = ${workflowTemplateId}
  `;
}

/** Limpia pasos, instancia y template sembrados por `seedReviewInstance`. */
export async function cleanupReviewInstance(
  instanceId: string,
  workflowTemplateId?: string
): Promise<void> {
  await sql`DELETE FROM workflow_instance_steps WHERE instance_id = ${instanceId}`;
  await sql`DELETE FROM workflow_instances WHERE id = ${instanceId}`;
  if (workflowTemplateId) {
    await sql`DELETE FROM workflow_templates WHERE id = ${workflowTemplateId}`;
  }
}

// --- Acciones de remediación en incidentes ---------------------------------

/** Protocolo de un solo paso `external_service`, el que dispara la acción externa. */
const EXTERNAL_PROTOCOL = {
  enabled: true,
  maxAttempts: 2,
  steps: [
    {
      type: "external_service",
      complianceServiceType: "FUMIGATION",
      instruction: "Coordinar visita del proveedor de fumigación",
    },
  ],
};

/** Protocolo self-fix: el incidente lo resuelve el propio personal con el wizard. */
const SELF_FIX_PROTOCOL = {
  enabled: true,
  maxAttempts: 3,
  steps: [
    { type: "self_fix", instruction: "Ajustar el termostato a 4 °C" },
    { type: "self_fix", instruction: "Volver a tomar la temperatura" },
  ],
};

/**
 * Siembra un incidente en `AWAITING_EXTERNAL` con su acción de remediación
 * PENDING, que es el estado en el que el detalle debe ofrecer "Confirmar visita".
 */
export async function seedIncidentWithRemediationAction(opts: {
  companyId: string;
  branchId: string;
  serviceType?: string;
}): Promise<{ incidentId: string; actionId: string }> {
  const serviceType = opts.serviceType ?? "FUMIGATION";

  const [incident] = await sql`
    INSERT INTO incidents (
      instance_id, step_id, branch_id, severity, status, title, description,
      remediation_protocol, metadata
    )
    VALUES (
      gen_random_uuid(),
      'e2e-remediation-step',
      ${opts.branchId},
      'HIGH',
      'AWAITING_EXTERNAL',
      ${`${E2E_TAG} Plaga detectada en almacén`},
      'Incidente sembrado por tests/incident-remediation-actions.spec.ts',
      ${JSON.stringify(EXTERNAL_PROTOCOL)}::jsonb,
      ${JSON.stringify({ remediationCurrentStep: 0, remediationAttempts: 0 })}::jsonb
    )
    RETURNING id
  `;

  const [action] = await sql`
    INSERT INTO remediation_actions (
      incident_id, service_config_id, branch_id, company_id,
      action_type, service_type, status
    )
    VALUES (
      ${incident.id}, NULL, ${opts.branchId}, ${opts.companyId},
      'SCHEDULE_COMPLIANCE_SERVICE', ${serviceType}, 'PENDING'
    )
    RETURNING id
  `;

  return { incidentId: incident.id as string, actionId: action.id as string };
}

/** Siembra un incidente con protocolo self-fix (el wizard sí debe aparecer). */
export async function seedIncidentWithSelfFixProtocol(opts: {
  branchId: string;
}): Promise<string> {
  const [incident] = await sql`
    INSERT INTO incidents (
      instance_id, step_id, branch_id, severity, status, title, description,
      remediation_protocol, metadata
    )
    VALUES (
      gen_random_uuid(),
      'e2e-selffix-step',
      ${opts.branchId},
      'HIGH',
      'IN_REMEDIATION',
      ${`${E2E_TAG} Temperatura fuera de rango`},
      'Incidente sembrado por tests/incident-remediation-actions.spec.ts',
      ${JSON.stringify(SELF_FIX_PROTOCOL)}::jsonb,
      ${JSON.stringify({
        remediationCurrentStep: 0,
        remediationAttempts: 0,
        remediationMaxAttempts: 3,
      })}::jsonb
    )
    RETURNING id
  `;

  return incident.id as string;
}

/** Estado y schedule de una acción de remediación, para asertar tras confirmar. */
export async function findRemediationAction(actionId: string): Promise<{
  status: string;
  scheduleId: string | null;
  scheduledDate: string | null;
} | null> {
  const [row] = await sql`
    SELECT status, schedule_id, scheduled_date
    FROM remediation_actions
    WHERE id = ${actionId}
  `;
  if (!row) return null;
  return {
    status: row.status as string,
    scheduleId: (row.schedule_id as string) ?? null,
    scheduledDate: (row.scheduled_date as string) ?? null,
  };
}

/** El `workflow_schedules` que creó la confirmación de la visita. */
export async function findScheduleById(scheduleId: string): Promise<{
  id: string;
  frequency: string;
  branchId: string;
  title: string;
} | null> {
  const [row] = await sql`
    SELECT id, frequency, branch_id, title
    FROM workflow_schedules
    WHERE id = ${scheduleId}
  `;
  if (!row) return null;
  return {
    id: row.id as string,
    frequency: row.frequency as string,
    branchId: row.branch_id as string,
    title: row.title as string,
  };
}

/**
 * Borra todo lo que deja el circuito de remediación en los incidentes `[E2E]`,
 * incluidos los schedules que se hayan creado al confirmar una visita.
 *
 * Es idempotente a propósito: los specs corren serial contra la base de dev y
 * deben poder repetirse sin limpiar a mano.
 */
export async function cleanupIncidentRemediation(): Promise<void> {
  const incidentRows = await sql`
    SELECT id FROM incidents WHERE title LIKE ${`${E2E_TAG}%`}
  `;
  const incidentIds = incidentRows.map((r: any) => r.id as string);
  if (incidentIds.length === 0) return;

  const scheduleRows = await sql`
    SELECT schedule_id FROM remediation_actions
    WHERE incident_id = ANY(${incidentIds}) AND schedule_id IS NOT NULL
  `;
  const scheduleIds = scheduleRows.map((r: any) => r.schedule_id as string);

  await sql`
    DELETE FROM compliance_service_history
    WHERE description LIKE ${`%${E2E_TAG}%`}
  `;
  await sql`DELETE FROM remediation_actions WHERE incident_id = ANY(${incidentIds})`;

  if (scheduleIds.length > 0) {
    await sql`DELETE FROM workflow_instances WHERE schedule_id = ANY(${scheduleIds})`;
    await sql`DELETE FROM workflow_schedules WHERE id = ANY(${scheduleIds})`;
  }

  await sql`DELETE FROM incidents WHERE id = ANY(${incidentIds})`;
}

// ── Caja chica (A1) ────────────────────────────────────────────────────────

/**
 * Sucursal desechable dentro de la empresa sembrada. Los specs de caja chica
 * necesitan una sucursal que con certeza **no** tenga fondo: las sembradas
 * pueden tenerlo, y precisamente el bug que se prueba los creaba solos.
 */
export async function seedTestBranch(companyId: string, label: string): Promise<string> {
  const [row] = await sql`
    INSERT INTO branches (company_id, name)
    VALUES (${companyId}, ${`${E2E_TAG} ${label} ${Date.now()}`})
    RETURNING id
  `;
  return row.id as string;
}

/**
 * Borra la sucursal de prueba junto con todo lo que la referencia.
 *
 * Cada tabla de esta lista está aquí porque su ausencia dejó una sucursal
 * huérfana, y una sucursal `[E2E]` huérfana **no es un residuo inocente**:
 * `BranchService.listBranches` ordena por `created_at DESC` y el contexto de
 * sucursal autoselecciona la primera, así que la de prueba secuestra el alcance
 * por omisión y tiñe de rojo specs que no tienen nada que ver — por ejemplo el
 * que comprueba que "Alcance aplicado" rotula Condesa, Polanco o Roma.
 */
export async function deleteTestBranch(branchId: string): Promise<void> {
  const funds = await sql`SELECT id FROM petty_cash_funds WHERE branch_id = ${branchId}`;
  const fundIds = funds.map((r: any) => r.id as string);
  if (fundIds.length > 0) {
    await sql`DELETE FROM petty_cash_transactions WHERE fund_id = ANY(${fundIds})`;
    await sql`DELETE FROM petty_cash_funds WHERE id = ANY(${fundIds})`;
  }
  // Los cortes se borran por `branch_id` y no por la etiqueta `[E2E]`: un spec
  // que los crea **por la API** no controla `validation_notes`, así que
  // `deleteTestSalesCuts()` no los ve y el DELETE de la sucursal choca contra
  // `daily_sales_cuts_branch_id_branches_id_fk`.
  await sql`DELETE FROM daily_sales_cuts WHERE branch_id = ${branchId}`;
  // La bitácora ABAC (`requirePermissionApi(..., { audit })`) escribe con la
  // sucursal que se consultó, y lo hace **después** de responder. Por eso el
  // leak era intermitente: el `afterEach` borraba antes de que la fila llegara
  // en unas corridas y chocaba contra `data_access_logs_branch_id_branches_id_fk`
  // en otras, dejando la sucursal viva y el spec en verde.
  await sql`DELETE FROM data_access_logs WHERE branch_id = ${branchId}`;
  // `users.branch_id` **no** tiene llave foránea, así que borrar la sucursal no
  // falla: deja al usuario apuntando a un fantasma, en silencio. Cuando le tocó
  // a `carlos@pulso.mx` —la cuenta con la que corren todos los specs de UI— cada
  // pantalla con alcance empezó a pedir datos de una sucursal inexistente, y los
  // rojos aparecieron en specs que no tenían nada que ver (inventario sin lotes,
  // flujo de efectivo sin cifra, caja chica en error).
  await sql`UPDATE users SET branch_id = NULL WHERE branch_id = ${branchId}`;
  await sql`DELETE FROM branches WHERE id = ${branchId}`;
}

/** Cuántos fondos de caja chica tiene la empresa ahora mismo. */
export async function countPettyCashFunds(companyId: string): Promise<number> {
  const rows = await sql`
    SELECT COUNT(*)::int AS n FROM petty_cash_funds WHERE company_id = ${companyId}
  `;
  return rows[0]?.n ?? 0;
}

/** Fila del fondo de una sucursal, o `null`. Lee la base, no el servicio. */
export async function findPettyCashFund(
  companyId: string,
  branchId: string
): Promise<{ id: string; fundAmount: number; currentBalance: number; lowThreshold: number } | null> {
  const rows = await sql`
    SELECT id, fund_amount, current_balance, low_threshold
    FROM petty_cash_funds
    WHERE company_id = ${companyId} AND branch_id = ${branchId}
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  return {
    id: rows[0].id as string,
    fundAmount: Number(rows[0].fund_amount),
    currentBalance: Number(rows[0].current_balance),
    lowThreshold: Number(rows[0].low_threshold),
  };
}

/** Movimientos registrados contra un fondo. */
export async function findPettyCashTransactions(
  fundId: string
): Promise<Array<{ type: string; amount: number; concept: string }>> {
  const rows = await sql`
    SELECT type, amount, concept
    FROM petty_cash_transactions
    WHERE fund_id = ${fundId}
    ORDER BY created_at
  `;
  return rows.map((r: any) => ({
    type: r.type as string,
    amount: Number(r.amount),
    concept: r.concept as string,
  }));
}

/** Da de baja el fondo de una sucursal, como hace `scripts/baja-fondos-fantasma.ts`. */
export async function deactivatePettyCashFund(
  companyId: string,
  branchId: string
): Promise<void> {
  await sql`
    UPDATE petty_cash_funds SET active = false, updated_at = now()
    WHERE company_id = ${companyId} AND branch_id = ${branchId}
  `;
}
