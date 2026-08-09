/**
 * Cuentas bancarias de proveedor — paso 2 de
 * `docs/plan-cuentas-por-pagar-reconciliado.md`.
 *
 * El control antifraude del módulo de tesorería no es detectar la factura
 * falsa: es que **nadie pueda redirigir el pago de un proveedor real**. Ese
 * ataque no necesita inventar un CFDI ni forzar una aprobación; basta con
 * cambiar 18 dígitos en el expediente del proveedor y esperar el siguiente
 * pago legítimo. Es silencioso, y cuando se descubre el dinero ya salió.
 *
 * Las cuatro reglas de cambio que este servicio impone:
 *
 *   1. **Validar antes de confiar.** Toda CLABE pasa el dígito verificador de
 *      Banxico y el catálogo de bancos (`lib/banking/clabe.ts`) antes de tocar
 *      la base. Es local y gratis, así que no hay razón para no hacerlo siempre.
 *   2. **Capturar no es verificar.** Toda cuenta nace PENDING_VERIFICATION. La
 *      titularidad se prueba con el CEP de Banxico (paso 3), por alguien
 *      distinto de quien capturó.
 *   3. **Capturar no desplaza.** La cuenta verificada vigente sigue siendo la
 *      pagable hasta que la nueva se verifique. Quien solo logra capturar no
 *      logra redirigir nada.
 *   4. **Un cambio siempre despierta al dueño.** Registrar una CLABE para un
 *      proveedor que ya tenía una verificada es EL evento de fraude, y se
 *      notifica sin que nadie tenga que ir a revisar una bitácora.
 *
 * La CLABE en claro no sale nunca de este módulo por la vía de lectura normal:
 * las funciones de listado devuelven `clabeLast4`. Solo
 * `getVerifiedBankAccountForPayment` descifra, y existe para el layout bancario
 * (paso 7).
 */
import { createHmac } from "node:crypto";
import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { supplierBankAccounts, suppliers, users } from "@/lib/db/schema";
import { ApiError } from "@/lib/api/error";
import { validateClabe, type ClabeErrorCode } from "@/lib/banking/clabe";
import { DekService } from "@/lib/security/dek";
import {
  encryptColumnWithDek,
  decryptColumnWithDek,
} from "@/lib/security/column-cipher";
import { NotificationDispatcher } from "@/lib/services/notification-dispatcher";

/**
 * Huella determinista de una CLABE dentro de un tenant.
 *
 * HMAC y no hash simple: sin la clave, un atacante con acceso de lectura a la
 * tabla podría confirmar una CLABE candidata calculando su hash (el espacio de
 * CLABEs válidas es chico y enumerable). Con el DEK de por medio, la huella no
 * dice nada fuera del tenant.
 */
function fingerprintClabe(clabe: string, dek: Buffer): string {
  return createHmac("sha256", dek).update(clabe).digest("hex");
}

/** Lo que sí puede cruzar a una respuesta HTTP. Nunca incluye la CLABE. */
export interface SafeSupplierBankAccount {
  id: string;
  supplierId: string;
  clabeLast4: string;
  bankCode: string;
  bankName: string;
  accountHolderName: string;
  status: "PENDING_VERIFICATION" | "VERIFIED" | "REJECTED";
  active: boolean;
  verifiedAt: Date | null;
  verifiedBy: string | null;
  verificationMethod: string | null;
  registeredBy: string;
  replacesAccountId: string | null;
  rejectionReason: string | null;
  notes: string | null;
  createdAt: Date;
}

/** Columnas seguras, en un solo lugar para que un `select()` no filtre la CLABE. */
const SAFE_COLUMNS = {
  id: supplierBankAccounts.id,
  supplierId: supplierBankAccounts.supplierId,
  clabeLast4: supplierBankAccounts.clabeLast4,
  bankCode: supplierBankAccounts.bankCode,
  bankName: supplierBankAccounts.bankName,
  accountHolderName: supplierBankAccounts.accountHolderName,
  status: supplierBankAccounts.status,
  active: supplierBankAccounts.active,
  verifiedAt: supplierBankAccounts.verifiedAt,
  verifiedBy: supplierBankAccounts.verifiedBy,
  verificationMethod: supplierBankAccounts.verificationMethod,
  registeredBy: supplierBankAccounts.registeredBy,
  replacesAccountId: supplierBankAccounts.replacesAccountId,
  rejectionReason: supplierBankAccounts.rejectionReason,
  notes: supplierBankAccounts.notes,
  createdAt: supplierBankAccounts.createdAt,
} as const;

/** Cuentas de un proveedor (o de toda la empresa), sin la CLABE. */
export async function listSupplierBankAccounts(filter: {
  companyId: string;
  supplierId?: string;
  /** Por omisión se incluyen las dadas de baja: son la traza del cambio. */
  activeOnly?: boolean;
}): Promise<SafeSupplierBankAccount[]> {
  const conditions = [eq(supplierBankAccounts.companyId, filter.companyId)];
  if (filter.supplierId) {
    conditions.push(eq(supplierBankAccounts.supplierId, filter.supplierId));
  }
  if (filter.activeOnly) {
    conditions.push(eq(supplierBankAccounts.active, true));
  }

  return db
    .select(SAFE_COLUMNS)
    .from(supplierBankAccounts)
    .where(and(...conditions))
    .orderBy(sql`${supplierBankAccounts.createdAt} DESC`);
}

export interface RegisterResult {
  account: SafeSupplierBankAccount;
  /**
   * `true` cuando el proveedor YA tenía una cuenta verificada: es un cambio de
   * CLABE, no un alta. La distinción es la que dispara la alerta al dueño.
   */
  isChange: boolean;
  /** Cuenta verificada que sigue siendo la pagable hasta que ésta se verifique. */
  supersedesAccountId: string | null;
  /** Otros proveedores de la empresa que ya usan esta misma cuenta. */
  sharedWithSupplierIds: string[];
  /** A cuántos usuarios se les despachó la alerta (0 = nadie la vio llegar). */
  alertedUserIds: string[];
}

/**
 * Registra una CLABE para un proveedor. Nunca la deja verificada.
 *
 * Lanza 400 con `details.clabeError` cuando la CLABE no pasa la validación
 * matemática, para que la UI pueda señalar el campo con la causa exacta.
 */
export async function registerSupplierBankAccount(input: {
  companyId: string;
  supplierId: string;
  clabe: string;
  accountHolderName: string;
  registeredBy: string;
  notes?: string;
}): Promise<RegisterResult> {
  // 1. Validación matemática primero: si la CLABE está mal, nada de lo demás
  //    importa y no hay razón para escribir ni para notificar.
  //    `=== false` y no `!validation.ok`: el proyecto compila con
  //    `strict: false`, y sin strictNullChecks TypeScript no estrecha la unión
  //    discriminada por negación de verdad — solo por igualdad explícita.
  const validation = validateClabe(input.clabe);
  if (validation.ok === false) {
    const clabeError: ClabeErrorCode = validation.code;
    throw ApiError.badRequest(validation.message, { clabeError });
  }

  const accountHolderName = input.accountHolderName?.trim();
  if (!accountHolderName) {
    throw ApiError.badRequest(
      "El titular de la cuenta es obligatorio: es lo que se compara contra el " +
        "CEP de Banxico al verificar.",
    );
  }

  // 2. El proveedor tiene que existir y ser de esta empresa. Se resuelve el
  //    nombre aquí porque la alerta lo necesita y el tenant hay que verificarlo
  //    de todos modos.
  const [supplier] = await db
    .select({ id: suppliers.id, name: suppliers.name })
    .from(suppliers)
    .where(
      and(eq(suppliers.id, input.supplierId), eq(suppliers.companyId, input.companyId)),
    )
    .limit(1);

  if (!supplier) {
    throw ApiError.notFound("El proveedor no existe en esta empresa.");
  }

  // 3. Cifrado. `ensureDek` es idempotente: una empresa que nunca cifró nada
  //    todavía no debe fallar al registrar su primera cuenta.
  await DekService.ensureDek(input.companyId);
  const dek = await DekService.getDek(input.companyId);
  const fingerprint = fingerprintClabe(validation.clabe, dek);

  // 4. ¿Ya está esta misma CLABE viva para este proveedor? El índice único
  //    parcial lo impediría de todos modos, pero un 400 explicando qué pasó es
  //    mejor que un error de constraint de Postgres.
  const [duplicate] = await db
    .select({ id: supplierBankAccounts.id, status: supplierBankAccounts.status })
    .from(supplierBankAccounts)
    .where(
      and(
        eq(supplierBankAccounts.supplierId, input.supplierId),
        eq(supplierBankAccounts.clabeFingerprint, fingerprint),
        eq(supplierBankAccounts.active, true),
      ),
    )
    .limit(1);

  if (duplicate) {
    throw ApiError.badRequest(
      duplicate.status === "VERIFIED"
        ? "Esta CLABE ya está registrada y verificada para este proveedor."
        : "Esta CLABE ya está registrada para este proveedor y espera verificación.",
      { existingAccountId: duplicate.id, status: duplicate.status },
    );
  }

  // 5. ¿Hay una cuenta verificada vigente? Si la hay, esto es un CAMBIO.
  const [currentVerified] = await db
    .select({ id: supplierBankAccounts.id, clabeLast4: supplierBankAccounts.clabeLast4 })
    .from(supplierBankAccounts)
    .where(
      and(
        eq(supplierBankAccounts.supplierId, input.supplierId),
        eq(supplierBankAccounts.status, "VERIFIED"),
        eq(supplierBankAccounts.active, true),
      ),
    )
    .limit(1);

  // 6. La misma cuenta en OTRO proveedor. No es ilegal —un grupo puede facturar
  //    con dos razones sociales al mismo banco— pero es exactamente la forma
  //    que toma el fraude de proveedor fantasma, así que va en la alerta.
  const shared = await db
    .selectDistinct({ supplierId: supplierBankAccounts.supplierId })
    .from(supplierBankAccounts)
    .where(
      and(
        eq(supplierBankAccounts.companyId, input.companyId),
        eq(supplierBankAccounts.clabeFingerprint, fingerprint),
        eq(supplierBankAccounts.active, true),
        ne(supplierBankAccounts.supplierId, input.supplierId),
      ),
    );
  const sharedWithSupplierIds = shared.map((r) => r.supplierId);

  // 7. Insertar — siempre PENDING_VERIFICATION, siempre sin tocar la vigente.
  const [inserted] = await db
    .insert(supplierBankAccounts)
    .values({
      companyId: input.companyId,
      supplierId: input.supplierId,
      clabe: encryptColumnWithDek(validation.clabe, dek),
      clabeLast4: validation.last4,
      clabeFingerprint: fingerprint,
      bankCode: validation.bankCode,
      bankName: validation.bankName,
      accountHolderName,
      status: "PENDING_VERIFICATION",
      active: true,
      registeredBy: input.registeredBy,
      replacesAccountId: currentVerified?.id ?? null,
      notes: input.notes?.trim() || null,
    })
    .returning(SAFE_COLUMNS);

  // 8. Despertar al dueño. Un cambio de CLABE es alerta siempre; un alta sobre
  //    un proveedor sin cuenta previa solo cuando la cuenta ya se usa en otro
  //    proveedor. Alertar de cada alta rutinaria entrena a ignorar la alerta,
  //    que es peor que no tenerla.
  const isChange = !!currentVerified;
  const alertedUserIds =
    isChange || sharedWithSupplierIds.length > 0
      ? await alertOwners({
          companyId: input.companyId,
          supplierName: supplier.name,
          supplierId: input.supplierId,
          accountId: inserted.id,
          newLast4: validation.last4,
          bankName: validation.bankName,
          previousLast4: currentVerified?.clabeLast4 ?? null,
          sharedCount: sharedWithSupplierIds.length,
        })
      : [];

  return {
    account: inserted,
    isChange,
    supersedesAccountId: currentVerified?.id ?? null,
    sharedWithSupplierIds,
    alertedUserIds,
  };
}

/**
 * Rechaza una cuenta y la da de baja.
 *
 * Es la contraparte de la alerta: sin una forma de decir "esto no lo autoricé",
 * avisarle al dueño solo lo vuelve espectador. La baja lógica libera el índice
 * único parcial, así que una CLABE rechazada por error se puede recapturar.
 */
export async function rejectSupplierBankAccount(input: {
  companyId: string;
  accountId: string;
  rejectedBy: string;
  reason: string;
}): Promise<SafeSupplierBankAccount> {
  const reason = input.reason?.trim();
  if (!reason) {
    throw ApiError.badRequest(
      "El motivo del rechazo es obligatorio: es lo que explica la baja cuando " +
        "alguien audite el expediente del proveedor.",
    );
  }

  const [rejected] = await db
    .update(supplierBankAccounts)
    .set({
      status: "REJECTED",
      active: false,
      rejectedAt: new Date(),
      rejectedBy: input.rejectedBy,
      rejectionReason: reason,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(supplierBankAccounts.id, input.accountId),
        eq(supplierBankAccounts.companyId, input.companyId),
        eq(supplierBankAccounts.active, true),
      ),
    )
    .returning(SAFE_COLUMNS);

  if (!rejected) {
    throw ApiError.notFound(
      "La cuenta no existe en esta empresa o ya estaba dada de baja.",
    );
  }

  return rejected;
}

/**
 * La CLABE en claro de la única cuenta verificada y activa de un proveedor.
 *
 * **Uso exclusivo de servidor.** Es el insumo del layout bancario (paso 7) y del
 * congelado de cuenta al cerrar un lote (paso 6). No debe alcanzar una respuesta
 * HTTP: lo que se le muestra a una persona son los últimos 4 dígitos.
 *
 * Devuelve `null` cuando el proveedor no tiene cuenta verificada — que es
 * precisamente la condición que debe impedir incluirlo en un lote de pago.
 */
export async function getVerifiedBankAccountForPayment(input: {
  companyId: string;
  supplierId: string;
}): Promise<{
  accountId: string;
  clabe: string;
  bankCode: string;
  bankName: string;
  accountHolderName: string;
} | null> {
  const [row] = await db
    .select({
      id: supplierBankAccounts.id,
      clabe: supplierBankAccounts.clabe,
      bankCode: supplierBankAccounts.bankCode,
      bankName: supplierBankAccounts.bankName,
      accountHolderName: supplierBankAccounts.accountHolderName,
    })
    .from(supplierBankAccounts)
    .where(
      and(
        eq(supplierBankAccounts.companyId, input.companyId),
        eq(supplierBankAccounts.supplierId, input.supplierId),
        eq(supplierBankAccounts.status, "VERIFIED"),
        eq(supplierBankAccounts.active, true),
      ),
    )
    .limit(1);

  if (!row) return null;

  const dek = await DekService.getDek(input.companyId);
  const clabe = decryptColumnWithDek(row.clabe, dek);
  if (!clabe) return null;

  return {
    accountId: row.id,
    clabe,
    bankCode: row.bankCode,
    bankName: row.bankName,
    accountHolderName: row.accountHolderName,
  };
}

/**
 * Despacha la alerta de cambio de CLABE a los dueños de la empresa.
 *
 * Reusa `NotificationDispatcher` (WhatsApp + in-app) en vez de un canal propio:
 * el dueño ya recibe ahí las alertas de arqueo y de KPI, y una alerta que llega
 * por un canal que nadie mira no es una alerta.
 *
 * Si la empresa no tiene ningún OWNER se cae a ADMIN. Una alerta antifraude que
 * no encuentra destinatario y se descarta en silencio es la peor de las fallas
 * posibles aquí, así que el fallback se registra en el log.
 */
async function alertOwners(input: {
  companyId: string;
  supplierId: string;
  supplierName: string;
  accountId: string;
  newLast4: string;
  bankName: string;
  previousLast4: string | null;
  sharedCount: number;
}): Promise<string[]> {
  let recipients = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.companyId, input.companyId), eq(users.role, "OWNER")));

  if (recipients.length === 0) {
    recipients = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.companyId, input.companyId), eq(users.role, "ADMIN")));
    console.warn(
      `[supplier-bank-accounts] La empresa ${input.companyId} no tiene usuario OWNER; ` +
        `la alerta de cambio de CLABE se envía a ${recipients.length} ADMIN.`,
    );
  }

  if (recipients.length === 0) {
    console.error(
      `[supplier-bank-accounts] Cambio de CLABE en ${input.supplierName} ` +
        `(cuenta ${input.accountId}) SIN destinatario: la empresa ${input.companyId} ` +
        `no tiene OWNER ni ADMIN. La alerta solo queda en data_access_logs.`,
    );
    return [];
  }

  const changeLine = input.previousLast4
    ? `Cuenta anterior: ****${input.previousLast4}\nCuenta nueva: ****${input.newLast4} (${input.bankName})`
    : `Cuenta nueva: ****${input.newLast4} (${input.bankName})`;

  const sharedLine =
    input.sharedCount > 0
      ? `\n\n⚠️ Esta misma cuenta ya está registrada en ${input.sharedCount} ` +
        `proveedor(es) más de la empresa.`
      : "";

  await NotificationDispatcher.sendBatchNotifications(
    recipients.map((r) => ({
      userId: r.id,
      title: input.previousLast4
        ? `Cambio de CLABE: ${input.supplierName}`
        : `Cuenta bancaria nueva: ${input.supplierName}`,
      message: `${changeLine}${sharedLine}`,
      type: "warning" as const,
      eventType: "supplier_bank_account_changed" as const,
      actionUrl: "/dashboard/finance/supplier-bank-accounts",
      actionLabel: "Revisar cuenta",
      metadata: {
        supplierName: input.supplierName,
        previousLast4: input.previousLast4 ?? "—",
        newLast4: input.newLast4,
        bankName: input.bankName,
        sharedLine,
      },
    })),
  );

  return recipients.map((r) => r.id);
}
