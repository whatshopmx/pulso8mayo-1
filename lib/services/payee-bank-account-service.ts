/**
 * Cuentas bancarias de payee — espejo de `supplier-bank-account-service.ts`
 * para el catálogo de contrapartes de gasto operativo (renta, luz, honorarios).
 *
 * El control antifraude es el mismo que para proveedores: no es el gasto
 * inventado, es **cambiarle la CLABE a un payee real** y esperar el siguiente
 * pago legítimo. Las mismas cuatro reglas de cambio aplican:
 *
 *   1. **Validar antes de confiar.** Toda CLABE pasa el dígito verificador de
 *      Banxico y el catálogo de bancos (`lib/banking/clabe.ts`).
 *   2. **Capturar no es verificar.** Toda cuenta nace PENDING_VERIFICATION.
 *   3. **Capturar no desplaza.** La cuenta verificada vigente sigue siendo la
 *      pagable hasta que la nueva se verifique.
 *   4. **Un cambio siempre despierta al dueño.**
 *
 * La CLABE en claro no sale nunca de este módulo por la vía de lectura normal:
 * `getBankAccountsForPayment` es la única que descifra, y existe para el
 * layout bancario y el congelado de cuenta al agregar una partida a una
 * corrida.
 *
 * Se duplica en vez de generalizar con `supplier-bank-account-service.ts`:
 * ese servicio ya es código de producción probado por el módulo de
 * proveedores, y una abstracción compartida a mitad de las dos rutas
 * arriesgaría ambas por una economía de líneas.
 */
import { createHmac } from "node:crypto";
import { and, eq, inArray, ne, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { payeeBankAccounts, payees, users } from "@/lib/db/schema";
import { ApiError } from "@/lib/api/error";
import { validateClabe, type ClabeErrorCode } from "@/lib/banking/clabe";
import { DekService } from "@/lib/security/dek";
import {
  encryptColumnWithDek,
  decryptColumnWithDek,
} from "@/lib/security/column-cipher";
import { NotificationDispatcher } from "@/lib/services/notification-dispatcher";

function fingerprintClabe(clabe: string, dek: Buffer): string {
  return createHmac("sha256", dek).update(clabe).digest("hex");
}

/** Lo que sí puede cruzar a una respuesta HTTP. Nunca incluye la CLABE. */
export interface SafePayeeBankAccount {
  id: string;
  payeeId: string;
  clabeLast4: string;
  bankCode: string;
  bankName: string;
  accountHolderName: string;
  status: "PENDING_VERIFICATION" | "VERIFIED" | "REJECTED";
  active: boolean;
  verifiedAt: Date | null;
  verifiedBy: string | null;
  verificationMethod: string | null;
  verificationEvidenceUrl: string | null;
  registeredBy: string;
  replacesAccountId: string | null;
  rejectionReason: string | null;
  notes: string | null;
  createdAt: Date;
}

const SAFE_COLUMNS = {
  id: payeeBankAccounts.id,
  payeeId: payeeBankAccounts.payeeId,
  clabeLast4: payeeBankAccounts.clabeLast4,
  bankCode: payeeBankAccounts.bankCode,
  bankName: payeeBankAccounts.bankName,
  accountHolderName: payeeBankAccounts.accountHolderName,
  status: payeeBankAccounts.status,
  active: payeeBankAccounts.active,
  verifiedAt: payeeBankAccounts.verifiedAt,
  verifiedBy: payeeBankAccounts.verifiedBy,
  verificationMethod: payeeBankAccounts.verificationMethod,
  verificationEvidenceUrl: payeeBankAccounts.verificationEvidenceUrl,
  registeredBy: payeeBankAccounts.registeredBy,
  replacesAccountId: payeeBankAccounts.replacesAccountId,
  rejectionReason: payeeBankAccounts.rejectionReason,
  notes: payeeBankAccounts.notes,
  createdAt: payeeBankAccounts.createdAt,
} as const;

/** Cuentas de un payee (o de toda la empresa), sin la CLABE. */
export async function listPayeeBankAccounts(filter: {
  companyId: string;
  payeeId?: string;
  /** Por omisión se incluyen las dadas de baja: son la traza del cambio. */
  activeOnly?: boolean;
}): Promise<SafePayeeBankAccount[]> {
  const conditions = [eq(payeeBankAccounts.companyId, filter.companyId)];
  if (filter.payeeId) {
    conditions.push(eq(payeeBankAccounts.payeeId, filter.payeeId));
  }
  if (filter.activeOnly) {
    conditions.push(eq(payeeBankAccounts.active, true));
  }

  return db
    .select(SAFE_COLUMNS)
    .from(payeeBankAccounts)
    .where(and(...conditions))
    .orderBy(sql`${payeeBankAccounts.createdAt} DESC`);
}

export interface RegisterResult {
  account: SafePayeeBankAccount;
  /** `true` cuando el payee YA tenía una cuenta verificada: es un cambio de CLABE. */
  isChange: boolean;
  supersedesAccountId: string | null;
  /** Otros payees de la empresa que ya usan esta misma cuenta. */
  sharedWithPayeeIds: string[];
  alertedUserIds: string[];
}

/** Registra una CLABE para un payee. Nunca la deja verificada. */
export async function registerPayeeBankAccount(input: {
  companyId: string;
  payeeId: string;
  clabe: string;
  accountHolderName: string;
  registeredBy: string;
  notes?: string;
}): Promise<RegisterResult> {
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

  const [payee] = await db
    .select({ id: payees.id, name: payees.name })
    .from(payees)
    .where(and(eq(payees.id, input.payeeId), eq(payees.companyId, input.companyId)))
    .limit(1);

  if (!payee) {
    throw ApiError.notFound("La contraparte no existe en esta empresa.");
  }

  await DekService.ensureDek(input.companyId);
  const dek = await DekService.getDek(input.companyId);
  const fingerprint = fingerprintClabe(validation.clabe, dek);

  const [duplicate] = await db
    .select({ id: payeeBankAccounts.id, status: payeeBankAccounts.status })
    .from(payeeBankAccounts)
    .where(
      and(
        eq(payeeBankAccounts.payeeId, input.payeeId),
        eq(payeeBankAccounts.clabeFingerprint, fingerprint),
        eq(payeeBankAccounts.active, true),
      ),
    )
    .limit(1);

  if (duplicate) {
    throw ApiError.badRequest(
      duplicate.status === "VERIFIED"
        ? "Esta CLABE ya está registrada y verificada para esta contraparte."
        : "Esta CLABE ya está registrada para esta contraparte y espera verificación.",
      { existingAccountId: duplicate.id, status: duplicate.status },
    );
  }

  const [currentVerified] = await db
    .select({ id: payeeBankAccounts.id, clabeLast4: payeeBankAccounts.clabeLast4 })
    .from(payeeBankAccounts)
    .where(
      and(
        eq(payeeBankAccounts.payeeId, input.payeeId),
        eq(payeeBankAccounts.status, "VERIFIED"),
        eq(payeeBankAccounts.active, true),
      ),
    )
    .limit(1);

  const shared = await db
    .selectDistinct({ payeeId: payeeBankAccounts.payeeId })
    .from(payeeBankAccounts)
    .where(
      and(
        eq(payeeBankAccounts.companyId, input.companyId),
        eq(payeeBankAccounts.clabeFingerprint, fingerprint),
        eq(payeeBankAccounts.active, true),
        ne(payeeBankAccounts.payeeId, input.payeeId),
      ),
    );
  const sharedWithPayeeIds = shared.map((r) => r.payeeId);

  const [inserted] = await db
    .insert(payeeBankAccounts)
    .values({
      companyId: input.companyId,
      payeeId: input.payeeId,
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

  const isChange = !!currentVerified;
  const alertedUserIds =
    isChange || sharedWithPayeeIds.length > 0
      ? await alertOwners({
          companyId: input.companyId,
          payeeName: payee.name,
          payeeId: input.payeeId,
          accountId: inserted.id,
          newLast4: validation.last4,
          bankName: validation.bankName,
          previousLast4: currentVerified?.clabeLast4 ?? null,
          sharedCount: sharedWithPayeeIds.length,
        })
      : [];

  return {
    account: inserted,
    isChange,
    supersedesAccountId: currentVerified?.id ?? null,
    sharedWithPayeeIds,
    alertedUserIds,
  };
}

/** Rechaza una cuenta y la da de baja. */
export async function rejectPayeeBankAccount(input: {
  companyId: string;
  accountId: string;
  rejectedBy: string;
  reason: string;
}): Promise<SafePayeeBankAccount> {
  const reason = input.reason?.trim();
  if (!reason) {
    throw ApiError.badRequest(
      "El motivo del rechazo es obligatorio: es lo que explica la baja cuando " +
        "alguien audite el expediente de la contraparte.",
    );
  }

  const [rejected] = await db
    .update(payeeBankAccounts)
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
        eq(payeeBankAccounts.id, input.accountId),
        eq(payeeBankAccounts.companyId, input.companyId),
        eq(payeeBankAccounts.active, true),
      ),
    )
    .returning(SAFE_COLUMNS);

  if (!rejected) {
    throw ApiError.notFound("La cuenta no existe en esta empresa o ya estaba dada de baja.");
  }

  return rejected;
}

export interface VerifyResult {
  account: SafePayeeBankAccount;
  supersededAccountId: string | null;
  supersededLast4: string | null;
}

/** Marca una cuenta como VERIFIED tras la prueba del centavo (CEP de Banxico). */
export async function verifyPayeeBankAccount(input: {
  companyId: string;
  accountId: string;
  verifiedBy: string;
  /** El titular tal como aparece en el CEP, no el declarado por quien capturó. */
  holderNameFromCep: string;
  evidenceUrl: string;
}): Promise<VerifyResult> {
  const holderNameFromCep = input.holderNameFromCep?.trim();
  if (!holderNameFromCep) {
    throw ApiError.badRequest(
      "Captura el nombre del titular tal como aparece en el CEP: es lo único " +
        "que prueba que la cuenta es de la contraparte y no de un tercero.",
    );
  }

  const evidenceUrl = input.evidenceUrl?.trim();
  if (!evidenceUrl) {
    throw ApiError.badRequest(
      "El CEP de Banxico es obligatorio: sin el comprobante, la verificación " +
        "es la palabra de una persona y no queda nada que auditar.",
    );
  }

  const [account] = await db
    .select({
      id: payeeBankAccounts.id,
      payeeId: payeeBankAccounts.payeeId,
      status: payeeBankAccounts.status,
      active: payeeBankAccounts.active,
      registeredBy: payeeBankAccounts.registeredBy,
      accountHolderName: payeeBankAccounts.accountHolderName,
      notes: payeeBankAccounts.notes,
    })
    .from(payeeBankAccounts)
    .where(and(eq(payeeBankAccounts.id, input.accountId), eq(payeeBankAccounts.companyId, input.companyId)))
    .limit(1);

  if (!account) {
    throw ApiError.notFound("La cuenta no existe en esta empresa.");
  }

  if (!account.active) {
    throw ApiError.badRequest(
      "La cuenta está dada de baja. Si sigue siendo la correcta, hay que " +
        "capturarla de nuevo y verificar esa captura.",
    );
  }

  if (account.status !== "PENDING_VERIFICATION") {
    throw ApiError.badRequest(
      account.status === "VERIFIED"
        ? "Esta cuenta ya está verificada."
        : "Esta cuenta fue rechazada; una cuenta rechazada no se verifica.",
      { status: account.status },
    );
  }

  if (account.registeredBy === input.verifiedBy) {
    throw ApiError.forbidden(
      "Tú capturaste esta cuenta, así que no puedes verificarla. La " +
        "verificación la tiene que hacer otra persona con permiso de " +
        "configuración: es lo que impide que una sola persona redirija un pago.",
      { registeredBy: account.registeredBy },
    );
  }

  const verificationNote =
    `Verificación por CEP (${new Date().toISOString().slice(0, 10)}): ` +
    `titular en el CEP "${holderNameFromCep}"; declarado "${account.accountHolderName}".`;
  const notes = account.notes ? `${account.notes}\n${verificationNote}` : verificationNote;

  try {
    return await db.transaction(async (tx) => {
      const [current] = await tx
        .select({ id: payeeBankAccounts.id, clabeLast4: payeeBankAccounts.clabeLast4 })
        .from(payeeBankAccounts)
        .where(
          and(
            eq(payeeBankAccounts.payeeId, account.payeeId),
            eq(payeeBankAccounts.status, "VERIFIED"),
            eq(payeeBankAccounts.active, true),
          ),
        )
        .limit(1);

      if (current) {
        await tx
          .update(payeeBankAccounts)
          .set({ active: false, updatedAt: new Date() })
          .where(eq(payeeBankAccounts.id, current.id));
      }

      const [verified] = await tx
        .update(payeeBankAccounts)
        .set({
          status: "VERIFIED",
          verifiedAt: new Date(),
          verifiedBy: input.verifiedBy,
          verificationMethod: "MANUAL_CEP",
          verificationEvidenceUrl: evidenceUrl,
          notes,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(payeeBankAccounts.id, input.accountId),
            eq(payeeBankAccounts.companyId, input.companyId),
            eq(payeeBankAccounts.status, "PENDING_VERIFICATION"),
            eq(payeeBankAccounts.active, true),
          ),
        )
        .returning(SAFE_COLUMNS);

      if (!verified) {
        throw ApiError.badRequest(
          "La cuenta cambió de estado mientras se verificaba. Vuelve a cargar " +
            "la lista antes de intentarlo de nuevo.",
        );
      }

      return {
        account: verified,
        supersededAccountId: current?.id ?? null,
        supersededLast4: current?.clabeLast4 ?? null,
      };
    });
  } catch (error) {
    if ((error as { code?: string })?.code === "23505") {
      throw ApiError.badRequest(
        "Otra cuenta de esta contraparte se verificó al mismo tiempo. Vuelve a " +
          "cargar la lista para ver cuál quedó vigente.",
      );
    }
    throw error;
  }
}

/**
 * La CLABE en claro de la única cuenta verificada y activa de un payee.
 * **Uso exclusivo de servidor.**
 */
export async function getVerifiedBankAccountForPayment(input: {
  companyId: string;
  payeeId: string;
}): Promise<BankAccountForPayment | null> {
  const { porPayee } = await getBankAccountsForPayment({
    companyId: input.companyId,
    payeeIds: [input.payeeId],
  });
  return porPayee.get(input.payeeId) ?? null;
}

export interface BankAccountForPayment {
  accountId: string;
  payeeId: string;
  clabe: string;
  clabeLast4: string;
  bankCode: string;
  bankName: string;
  accountHolderName: string;
  /** `true` sólo si esta cuenta es hoy la verificada y activa del payee. */
  vigente: boolean;
}

/**
 * Versión por lote de `getVerifiedBankAccountForPayment`, para el layout
 * bancario y el congelado de cuenta al cerrar una corrida.
 */
export async function getBankAccountsForPayment(input: {
  companyId: string;
  payeeIds: string[];
  accountIds?: string[];
}): Promise<{
  /** Cuenta verificada y activa de cada payee, hoy. */
  porPayee: Map<string, BankAccountForPayment>;
  /** Cualquier cuenta pedida por id, esté vigente o no. */
  porId: Map<string, BankAccountForPayment>;
}> {
  const payeeIds = [...new Set(input.payeeIds.filter(Boolean))];
  const accountIds = [...new Set((input.accountIds ?? []).filter(Boolean))];

  const vacio = { porPayee: new Map(), porId: new Map() };
  if (payeeIds.length === 0 && accountIds.length === 0) return vacio;

  const condiciones = [
    payeeIds.length > 0
      ? and(
          inArray(payeeBankAccounts.payeeId, payeeIds),
          eq(payeeBankAccounts.status, "VERIFIED"),
          eq(payeeBankAccounts.active, true),
        )
      : undefined,
    accountIds.length > 0 ? inArray(payeeBankAccounts.id, accountIds) : undefined,
  ].filter(Boolean);

  const rows = await db
    .select({
      id: payeeBankAccounts.id,
      payeeId: payeeBankAccounts.payeeId,
      clabe: payeeBankAccounts.clabe,
      clabeLast4: payeeBankAccounts.clabeLast4,
      bankCode: payeeBankAccounts.bankCode,
      bankName: payeeBankAccounts.bankName,
      accountHolderName: payeeBankAccounts.accountHolderName,
      status: payeeBankAccounts.status,
      active: payeeBankAccounts.active,
    })
    .from(payeeBankAccounts)
    .where(
      and(
        eq(payeeBankAccounts.companyId, input.companyId),
        condiciones.length === 1 ? condiciones[0] : or(...(condiciones as any[])),
      ),
    );

  if (rows.length === 0) return vacio;

  const dek = await DekService.getDek(input.companyId);

  const porPayee = new Map<string, BankAccountForPayment>();
  const porId = new Map<string, BankAccountForPayment>();

  for (const row of rows) {
    const clabe = decryptColumnWithDek(row.clabe, dek);
    if (!clabe) continue;

    const cuenta: BankAccountForPayment = {
      accountId: row.id,
      payeeId: row.payeeId,
      clabe,
      clabeLast4: row.clabeLast4,
      bankCode: row.bankCode,
      bankName: row.bankName,
      accountHolderName: row.accountHolderName,
      vigente: row.status === "VERIFIED" && row.active === true,
    };

    porId.set(row.id, cuenta);
    if (cuenta.vigente) porPayee.set(row.payeeId, cuenta);
  }

  return { porPayee, porId };
}

/** Despacha la alerta de cambio de CLABE a los dueños de la empresa. */
async function alertOwners(input: {
  companyId: string;
  payeeId: string;
  payeeName: string;
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
      `[payee-bank-accounts] La empresa ${input.companyId} no tiene usuario OWNER; ` +
        `la alerta de cambio de CLABE se envía a ${recipients.length} ADMIN.`,
    );
  }

  if (recipients.length === 0) {
    console.error(
      `[payee-bank-accounts] Cambio de CLABE en ${input.payeeName} ` +
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
        `contraparte(s) más de la empresa.`
      : "";

  await NotificationDispatcher.sendBatchNotifications(
    recipients.map((r) => ({
      userId: r.id,
      title: input.previousLast4
        ? `Cambio de CLABE: ${input.payeeName}`
        : `Cuenta bancaria nueva: ${input.payeeName}`,
      message: `${changeLine}${sharedLine}`,
      type: "warning" as const,
      eventType: "payee_bank_account_changed" as const,
      actionUrl: "/dashboard/finance/payee-bank-accounts",
      actionLabel: "Revisar cuenta",
      metadata: {
        payeeName: input.payeeName,
        previousLast4: input.previousLast4 ?? "—",
        newLast4: input.newLast4,
        bankName: input.bankName,
        sharedLine,
      },
    })),
  );

  return recipients.map((r) => r.id);
}
