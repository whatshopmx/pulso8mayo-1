import { db } from "@/lib/db";
import { 
  paymentRuns, 
  paymentRunItems, 
  recurringContracts, 
  invoices,
  suppliers,
  supplierBankAccounts,
  paymentRunStatusEnum,
  paymentRunItemTypeEnum,
  branches,
  payrollRuns,
  payrollPayslips,
  pettyCashFunds,
  employeeProfiles,
  users
} from "@/lib/db/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { ApiError } from "@/lib/api/error";
import { getBankAccountsForPayment } from "@/lib/services/supplier-bank-account-service";
import { decryptProfileRecords } from "@/lib/security/employee-cipher";

type PaymentRunStatus = typeof paymentRunStatusEnum.enumValues[number];

/**
 * La máquina de estados que el enum `payment_run_status` ya describía y que
 * nadie validaba.
 *
 * Una corrida de pago es una cadena de firmas: se prepara, se manda a
 * autorizar, un segundo par de ojos la aprueba, se dispersa y se cierra. Sin
 * esta tabla el enum es sólo una etiqueta, y el salto `DRAFT → COMPLETED`
 * cerraba la corrida y marcaba sus facturas como pagadas sin que nadie firmara
 * —porque la regla de doble firma sólo corre al entrar a `APPROVED`.
 *
 * `CANCELLED` se admite desde cualquier estado abierto: abandonar una corrida
 * que ya no se va a pagar no requiere autorización adicional. Lo que no se
 * admite es volver de `CANCELLED` o de `COMPLETED`: los dos son terminales, y
 * reabrir una corrida cerrada es la forma de pagar dos veces.
 *
 * `PROCESSING → APPROVED` tampoco existe a propósito: una vez enviada la
 * dispersión al banco, retroceder al estado que autoriza enviarla permitiría
 * dispersar dos veces la misma corrida.
 */
const TRANSICIONES_CORRIDA: Record<PaymentRunStatus, PaymentRunStatus[]> = {
  DRAFT: ["PENDING_APPROVAL", "CANCELLED"],
  PENDING_APPROVAL: ["APPROVED", "CANCELLED"],
  APPROVED: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
};

/** Etiquetas en español para el mensaje de error; el enum está en inglés. */
const ETIQUETA_ESTADO: Record<PaymentRunStatus, string> = {
  DRAFT: "Borrador",
  PENDING_APPROVAL: "Pendiente de autorización",
  APPROVED: "Autorizada",
  PROCESSING: "En dispersión",
  COMPLETED: "Pagada",
  CANCELLED: "Cancelada",
};

/**
 * Estados desde los que la corrida ya pasó por la doble firma.
 *
 * Lo consume el layout bancario (A2.2): no se genera archivo de dispersión de
 * una corrida que nadie autorizó.
 */
export const ESTADOS_DISPERSABLES: PaymentRunStatus[] = ["APPROVED", "PROCESSING", "COMPLETED"];

export function assertPaymentRunTransition(
  actual: PaymentRunStatus,
  destino: PaymentRunStatus
): void {
  // Reenviar el mismo estado no es un avance, pero tampoco un error del
  // usuario: dos clics en el mismo botón. Se rechaza con mensaje propio en vez
  // de caer en la lista de permitidos, que lo describiría mal.
  if (actual === destino) {
    throw ApiError.badRequest(
      `La corrida ya está en estado "${ETIQUETA_ESTADO[actual]}".`
    );
  }

  const permitidos = TRANSICIONES_CORRIDA[actual] ?? [];

  if (!permitidos.includes(destino)) {
    const listado = permitidos.length
      ? permitidos.map((e) => `"${ETIQUETA_ESTADO[e]}"`).join(" o ")
      : "ningún otro estado: es un estado final";

    throw ApiError.badRequest(
      `Transición no permitida: una corrida en "${ETIQUETA_ESTADO[actual]}" sólo puede pasar a ${listado}.`
    );
  }
}

// ── Layout de dispersión bancaria ────────────────────────────────────────────

/**
 * Formatos de archivo de dispersión que Pulso emite.
 *
 * **Uno solo, a propósito (A2.6).** Aquí había también `BANORTE_TXT` y
 * `BBVA_TXT`, y los tres estaban inventados: sin registro de encabezado ni de
 * cierre, sin clave de banco de 3 dígitos, sin tipo de cuenta, sin RFC del
 * beneficiario y sin fecha de aplicación — nada de lo que el layout real de
 * "Pago a terceros" de Banorte o el de BBVA Net Cash exigen. Tres formatos
 * inventados le cuestan al cliente tres intentos fallidos en el portal del
 * banco; uno honesto le cuesta uno. Los otros dos vuelven cuando exista el
 * manual del banco contra el cual implementarlos.
 */
export type BankLayoutFormat = "SPEI_CSV";

/** Un renglón del archivo: una transferencia, no una partida. */
interface RenglonDispersion {
  /** Clave estable del renglón. En nómina es `partida:empleado`. */
  itemId: string;
  clabe: string;
  bankName: string;
  beneficiario: string;
  amountCents: number;
  concepto: string;
}

export interface PartidaExcluida {
  itemId: string;
  itemType: PaymentRunItemType;
  amountCents: number;
  /** En español y accionable: qué hacer para que deje de estar excluida. */
  motivo: string;
}

export interface BankDisbursementLayout {
  runId: string;
  runTitle: string;
  format: BankLayoutFormat;
  /** Transferencias emitidas en el archivo. */
  recordCount: number;
  /** Partidas de la corrida, para poder contrastar las dos cifras. */
  itemCount: number;
  excludedCount: number;
  excludedAmountCents: number;
  excluded: PartidaExcluida[];
  avisos: string[];
  totalPesos: string;
  runTotalPesos: string;
  content: string;
}

type PaymentRunItemType = typeof paymentRunItemTypeEnum.enumValues[number];

/**
 * Por qué un tipo de partida no viaja en un archivo SPEI.
 *
 * No es una lista de "todavía no": son tipos que **no se pagan por
 * transferencia a una contraparte**, y el archivo lo dice en vez de
 * descartarlos en silencio, que es lo que hacía antes de A2.4.
 */
const MOTIVO_NO_DISPERSABLE: Partial<Record<PaymentRunItemType, string>> = {
  TAXES:
    "Los impuestos se pagan por línea de captura al SAT/IMSS, no por SPEI a una contraparte. Págala en el portal de la autoridad y marca la partida aparte.",
  PETTY_CASH_REIMBURSEMENT:
    "La reposición de caja chica entra como efectivo al fondo de la sucursal; el esquema no guarda una cuenta bancaria de sucursal a la cual transferir, así que no hay CLABE destino que emitir.",
  OTHER:
    "El tipo OTHER no tiene contraparte que verificar y no se admite en una corrida de pago. Reclasifica la partida al tipo del documento.",
};

/** Un campo de CSV, con las comillas dobladas como manda el RFC 4180. */
function csv(valor: string): string {
  return `"${String(valor ?? "").replace(/"/g, '""')}"`;
}

/**
 * Deja un texto en la forma que un portal bancario acepta: sin acentos, sin
 * separadores de campo, en mayúsculas y acotado.
 *
 * Los formatos con pipe no tienen escape posible, así que el `|` se sustituye
 * en vez de escaparse: es la única forma de que un nombre con pipe no parta el
 * registro.
 */
function sanearTexto(valor: string, maxLargo: number): string {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[|\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase()
    .slice(0, maxLargo);
}

/** ¿Son 18 dígitos? Lo mínimo para no mandar basura al portal del banco. */
function esClabe(valor: string | null | undefined): boolean {
  return typeof valor === "string" && /^\d{18}$/.test(valor.trim());
}

/**
 * Referencia numérica de 7 dígitos por renglón, determinista y única.
 *
 * Antes era `String(Date.now()).slice(-7)`: **la misma para toda la corrida y
 * distinta en cada descarga**. Sin una referencia estable no hay con qué
 * conciliar el depósito cuando el proveedor llama a preguntar, y dos descargas
 * del mismo archivo producían dos juegos de referencias para los mismos pagos.
 *
 * Se deriva del id del renglón. Siete dígitos es el máximo que admite la
 * referencia numérica de SPEI, así que las colisiones son posibles aunque
 * improbables; se resuelven sumando 1 en orden estable, que mantiene la
 * determinación.
 */
function asignarReferencias(itemIds: string[]): Map<string, string> {
  const usadas = new Set<string>();
  const salida = new Map<string, string>();

  for (const id of itemIds) {
    const hash = createHash("sha1").update(id).digest("hex").slice(0, 12);
    let n = parseInt(hash, 16) % 10_000_000;
    let ref = String(n).padStart(7, "0");
    while (usadas.has(ref)) {
      n = (n + 1) % 10_000_000;
      ref = String(n).padStart(7, "0");
    }
    usadas.add(ref);
    salida.set(id, ref);
  }

  return salida;
}

export class TreasuryService {
  /**
   * Generates a new draft payment run (Corrida de Tesorería).
   */
  static async createPaymentRun(
    companyId: string, 
    title: string, 
    runDate: Date, 
    userId: string,
    branchId?: string | null
  ) {
    const [run] = await db.insert(paymentRuns)
      .values({
        companyId,
        branchId: branchId && branchId !== "ALL" ? branchId : null,
        title,
        runDate,
        preparedBy: userId,
        status: "DRAFT",
      })
      .returning();
      
    return run;
  }

  /**
   * Fetch invoices ready to be paid (MATCHED or EXCEPTION_APPROVED, and UNPAID).
   */
  static async getUnpaidMatchedInvoices(companyId: string, branchId?: string | null) {
    const conditions = [
      eq(invoices.companyId, companyId),
      inArray(invoices.matchStatus, ["MATCHED", "EXCEPTION_APPROVED"]),
      eq(invoices.paymentStatus, "PENDING")
    ];

    if (branchId && branchId !== "ALL") {
      conditions.push(eq(invoices.branchId, branchId));
    }

    return db.query.invoices.findMany({
      where: and(...conditions),
      orderBy: (inv, { asc }) => [asc(inv.fecha)],
    });
  }

  /**
   * Fetch payroll runs ready to be paid in Treasury.
   */
  static async getUnpaidPayrollRuns(companyId: string, branchId?: string | null) {
    const runs = await db.query.payrollRuns.findMany({
      where: eq(payrollRuns.companyId, companyId),
      orderBy: (pr, { desc }) => [desc(pr.createdAt)],
    });

    if (runs.length === 0) return [];

    const runIds = runs.map(r => r.id);

    const existingRunItems = await db.query.paymentRunItems.findMany({
      where: eq(paymentRunItems.itemType, "PAYROLL"),
      columns: { referenceId: true }
    });
    const attachedIds = new Set(existingRunItems.map(i => i.referenceId));

    const payslips = await db.query.payrollPayslips.findMany({
      where: inArray(payrollPayslips.runId, runIds),
      columns: { runId: true, totalPercepcionesCents: true }
    });

    const payrollTotals = new Map<string, number>();
    payslips.forEach(ps => {
      payrollTotals.set(ps.runId, (payrollTotals.get(ps.runId) || 0) + (ps.totalPercepcionesCents || 0));
    });

    return runs
      .filter(r => !attachedIds.has(r.id))
      .map(r => ({
        ...r,
        totalAmountCents: payrollTotals.get(r.id) || 0,
        branchName: "Todas las sucursales (Consolidado)",
      }));
  }

  /**
   * Resuelve la contraparte de una partida de pago y afirma que es cobrable.
   *
   * G1.1 de `tasks/plan-facturas-contrapartes.md`. Antes, la regla "la
   * contraparte tiene CLABE verificada" vivía inline dentro de
   * `if (itemType === 'INVOICE')` y, adentro, dentro de `if (invoice.supplierId)`.
   * Los otros cuatro valores del enum entraban al lote **sin validar nada** —
   * ni siquiera que el `referenceId` existiera o fuera del tenant. Toda la
   * máquina antifraude de la Fase 1 de CLABE se rodeaba cambiando una cadena
   * en el body del POST.
   *
   * El `switch` es exhaustivo a propósito: el `default` asigna a `never`, así
   * que **agregar un valor al enum sin declarar su regla no compila**. Ese es
   * el punto de la función — no cubrir los cinco tipos de hoy, sino que el
   * sexto reviente en build en vez de abrir un hueco callado.
   *
   * Devuelve el monto autoritativo: para los tipos con documento se lee del
   * documento y **se ignora el del body**. Un monto que viene del cliente en
   * un lote de pago es dinero declarado por quien cobra.
   */
  static async assertCounterpartyPayable(input: {
    companyId: string;
    itemType: typeof paymentRunItemTypeEnum.enumValues[number];
    referenceId: string;
    /** Solo se usa en los tipos que no tienen documento con monto propio. */
    amountCents?: number;
    notes?: string;
  }): Promise<{
    amountCents: number;
    counterparty: string;
    /** Cuenta verificada vigente al momento de agregar la partida (A2.1). */
    bankAccountId?: string | null;
    clabeLast4?: string | null;
  }> {
    const { companyId, itemType, referenceId, notes } = input;

    switch (itemType) {
      // Mercancía: contraparte = proveedor de la factura, con CLABE verificada.
      case "INVOICE": {
        const invoice = await db.query.invoices.findFirst({
          where: and(eq(invoices.id, referenceId), eq(invoices.companyId, companyId)),
        });

        // Mismo 404 para "no existe" y "es de otra empresa": distinguirlos
        // filtra la existencia de documentos ajenos.
        if (!invoice) throw ApiError.notFound("Factura no encontrada");

        if (invoice.matchStatus === "DISCREPANCY") {
          throw ApiError.badRequest(
            "Factura bloqueada por discrepancia en 3-Way Match sin autorización de excepción"
          );
        }

        // Antes esto era `if (invoice.supplierId)`: una factura sin proveedor
        // se saltaba la verificación de CLABE entera. No hay a quién
        // transferirle, así que no es pagable.
        if (!invoice.supplierId) {
          throw ApiError.badRequest(
            "La factura no tiene proveedor asignado. Asigna la contraparte antes de programarla para pago."
          );
        }

        const verifiedAccount = await db.query.supplierBankAccounts.findFirst({
          where: and(
            eq(supplierBankAccounts.supplierId, invoice.supplierId),
            eq(supplierBankAccounts.status, "VERIFIED"),
            eq(supplierBankAccounts.active, true)
          ),
        });

        const supplier = await db.query.suppliers.findFirst({
          where: eq(suppliers.id, invoice.supplierId),
        });
        const suppName = supplier?.name || "del proveedor";

        if (!verifiedAccount) {
          throw ApiError.badRequest(
            `El proveedor "${suppName}" no tiene una cuenta bancaria CLABE verificada. Se requiere validación previa contra fraude (Módulo 6.1).`
          );
        }

        return {
          amountCents: invoice.total,
          counterparty: suppName,
          // Se devuelve para congelarla en la partida: la corrida se firma
          // contra ESTA cuenta, no contra la que el proveedor tenga el día que
          // alguien genere el archivo.
          bankAccountId: verifiedAccount.id,
          clabeLast4: verifiedAccount.clabeLast4,
        };
      }

      // Nómina: se paga por layout de dispersión contra las CLABEs de los
      // empleados, no contra una cuenta de contraparte. **Se declara** que no
      // requiere contraparte bancaria; no cae por omisión.
      case "PAYROLL": {
        const payrollRun = await db.query.payrollRuns.findFirst({
          where: and(eq(payrollRuns.id, referenceId), eq(payrollRuns.companyId, companyId)),
        });

        if (!payrollRun) throw ApiError.notFound("Corrida de nómina no encontrada");

        const payslips = await db.query.payrollPayslips.findMany({
          where: eq(payrollPayslips.runId, payrollRun.id),
          columns: { totalPercepcionesCents: true },
        });

        const totalCents = payslips.reduce(
          (sum, ps) => sum + (ps.totalPercepcionesCents || 0),
          0
        );

        if (totalCents <= 0) {
          throw ApiError.badRequest(
            "Esta corrida de nómina no tiene percepciones calculadas; no hay monto que programar."
          );
        }

        return { amountCents: totalCents, counterparty: "Nómina (dispersión a empleados)" };
      }

      // Impuestos: se pagan por línea de captura al SAT/IMSS, no por SPEI a una
      // contraparte. No hay tabla de declaraciones en el repo contra la cual
      // verificar el `referenceId`, así que la nota es obligatoria: es lo único
      // que deja rastro de qué se está pagando.
      case "TAXES": {
        const amountCents = input.amountCents ?? 0;
        if (amountCents <= 0) {
          throw ApiError.badRequest("El monto del pago de impuestos debe ser mayor a cero.");
        }
        if (!notes || notes.trim().length === 0) {
          throw ApiError.badRequest(
            "Un pago de impuestos requiere nota con la línea de captura y el concepto: no hay documento contra el cual verificarlo."
          );
        }
        return { amountCents, counterparty: "Autoridad fiscal (línea de captura)" };
      }

      // Caja chica: la reposición es efectivo que entra al fondo de una
      // sucursal, no una transferencia a un tercero — `petty_cash_transactions`
      // no tiene contraparte y el fondo se identifica por sucursal. Se declara
      // que no requiere CLABE, y el `referenceId` apunta al fondo.
      //
      // El monto se acota al faltante del fondo: se admite una reposición
      // parcial, pero no se puede meter a la sucursal más efectivo del que el
      // fondo está autorizado a tener.
      case "PETTY_CASH_REIMBURSEMENT": {
        const fund = await db.query.pettyCashFunds.findFirst({
          where: and(
            eq(pettyCashFunds.id, referenceId),
            eq(pettyCashFunds.companyId, companyId)
          ),
        });

        if (!fund) throw ApiError.notFound("Fondo de caja chica no encontrado");
        if (!fund.active) {
          throw ApiError.badRequest("El fondo de caja chica está cerrado; no admite reposición.");
        }

        const faltanteCents = fund.fundAmount - fund.currentBalance;
        if (faltanteCents <= 0) {
          throw ApiError.badRequest(
            "El fondo de caja chica está completo; no requiere reposición."
          );
        }

        const solicitado = input.amountCents ?? faltanteCents;
        if (solicitado <= 0) {
          throw ApiError.badRequest("El monto de la reposición debe ser mayor a cero.");
        }
        if (solicitado > faltanteCents) {
          throw ApiError.badRequest(
            `La reposición excede el faltante del fondo ($${(faltanteCents / 100).toFixed(2)} MXN).`
          );
        }

        return { amountCents: solicitado, counterparty: "Fondo de caja chica de la sucursal" };
      }

      // Un cajón de sastre en un lote de pago **es** el bypass: monto libre,
      // referencia libre, sin contraparte que verificar. Si aparece un caso de
      // uso real, se le declara su propio tipo con su propia regla.
      case "OTHER": {
        throw ApiError.badRequest(
          "El tipo de partida OTHER no está permitido en una corrida de pago: no tiene contraparte que verificar. Usa el tipo que corresponda al documento."
        );
      }

      default: {
        // Exhaustividad: si el enum crece, esta asignación deja de compilar.
        const tipoSinRegla: never = itemType;
        throw ApiError.badRequest(
          `Tipo de partida sin regla de contraparte declarada: ${String(tipoSinRegla)}`
        );
      }
    }
  }

  /**
   * Agrega una partida a una corrida de pago (Módulo 6.1).
   *
   * `companyId` viene de la sesión, nunca del body: sin él, una factura de otra
   * empresa con su `id` conocido entraba al lote (G1.2).
   */
  static async addItemToRun(input: {
    paymentRunId: string;
    companyId: string;
    itemType: typeof paymentRunItemTypeEnum.enumValues[number];
    referenceId: string;
    /** Ignorado en los tipos con documento; el monto se lee del documento. */
    amountCents?: number;
    notes?: string;
  }) {
    const { paymentRunId, companyId, itemType, referenceId, notes } = input;

    const run = await db.query.paymentRuns.findFirst({
      where: and(eq(paymentRuns.id, paymentRunId), eq(paymentRuns.companyId, companyId)),
      columns: { id: true, status: true },
    });

    if (!run) throw ApiError.notFound("Corrida de pago no encontrada");
    if (run.status !== "DRAFT") {
      throw ApiError.badRequest("Solo puedes agregar ítems a una corrida en estado DRAFT.");
    }

    const { amountCents, bankAccountId, clabeLast4 } =
      await TreasuryService.assertCounterpartyPayable({
        companyId,
        itemType,
        referenceId,
        amountCents: input.amountCents,
        notes,
      });

    // La partida y el total de la corrida se escriben juntos: antes eran dos
    // escrituras sueltas y un fallo entre ellas dejaba la corrida cuadrando mal.
    return db.transaction(async (tx) => {
      const [item] = await tx
        .insert(paymentRunItems)
        .values({
          paymentRunId,
          itemType,
          referenceId,
          amountCents,
          notes,
          // Congelado de cuenta (A2.1). Los tipos sin contraparte bancaria
          // —nómina, caja chica, impuestos— lo dejan en `null`, que es la
          // verdad y no una omisión.
          bankAccountId: bankAccountId ?? null,
          clabeLast4Snapshot: clabeLast4 ?? null,
        })
        .returning();

      await tx
        .update(paymentRuns)
        .set({
          totalAmountCents: sql`${paymentRuns.totalAmountCents} + ${amountCents}`,
          updatedAt: new Date(),
        })
        .where(eq(paymentRuns.id, paymentRunId));

      return item;
    });
  }

  /**
   * Fetches the details of a specific payment run, joining items.
   */
  static async getPaymentRunDetails(paymentRunId: string) {
    const run = await db.query.paymentRuns.findFirst({
      where: eq(paymentRuns.id, paymentRunId),
    });

    if (!run) throw new Error("Payment run not found");

    let branchName = "Todas las sucursales (Consolidado)";
    if (run.branchId) {
      const b = await db.query.branches.findFirst({
        where: eq(branches.id, run.branchId),
        columns: { name: true }
      });
      if (b) branchName = b.name;
    }

    const items = await db.query.paymentRunItems.findMany({
      where: eq(paymentRunItems.paymentRunId, paymentRunId),
    });

    const enrichedItems = await Promise.all(
      items.map(async (item) => {
        if (item.itemType === 'INVOICE') {
          const inv = await db.query.invoices.findFirst({
            where: eq(invoices.id, item.referenceId),
            columns: { folio: true, uuid: true, rfcEmisor: true, nombreEmisor: true, fecha: true }
          });
          return { ...item, invoiceDetails: inv || null };
        }
        if (item.itemType === 'PAYROLL') {
          const pr = await db.query.payrollRuns.findFirst({
            where: eq(payrollRuns.id, item.referenceId),
            columns: { periodStart: true, periodEnd: true, status: true }
          });
          return { ...item, payrollDetails: pr || null };
        }
        return item;
      })
    );

    return { 
      run: { ...run, branchName }, 
      items: enrichedItems 
    };
  }

  /**
   * Create a recurring contract (Gasto Operativo Recurrente)
   */
  /**
   * Alta de un contrato recurrente.
   *
   * Firma por objeto y no posicional (mismo criterio que `addItemToRun`): con
   * las tolerancias eran once parámetros en fila, y `createRecurringContract(a,
   * b, c, d, e, 250000, f, g, 10, 30)` no se puede leer ni revisar.
   *
   * `varianceTolerancePercent` era inalcanzable desde la aplicación: la columna
   * admitía cualquier valor pero esta función no lo recibía, así que TODO
   * contrato quedaba con el 10% por omisión. Para un servicio de monto variable
   * —luz, agua— ese 10% sobre un monto fijo se rebasa cada temporada, y la
   * excepción resultante se vuelve ruido que la gente aprende a ignorar.
   */
  static async createRecurringContract(input: {
    companyId: string;
    branchId: string | null;
    supplierId: string;
    title: string;
    contractType: string;
    baseAmountCents: number;
    startDate: Date;
    userId: string;
    paymentFrequency?: string;
    /** Tolerancia por arriba, en %. Por omisión 10. */
    varianceTolerancePercent?: number;
    /** Tolerancia por abajo, en %. `null`/omitido = no alertar por debajo. */
    varianceToleranceBelowPercent?: number | null;
  }) {
    const arriba = input.varianceTolerancePercent ?? 10;
    const abajo = input.varianceToleranceBelowPercent ?? null;

    // Se validan aquí y no sólo en la ruta: el servicio es la frontera que
    // también cruzan los seeds y cualquier script.
    if (!Number.isInteger(arriba) || arriba < 0 || arriba > 1000) {
      throw new Error("La tolerancia superior debe ser un entero entre 0 y 1000 por ciento.");
    }
    if (abajo !== null && (!Number.isInteger(abajo) || abajo < 0 || abajo > 100)) {
      // El tope de abajo es 100: una desviación del -100% es un recibo en cero,
      // y no hay nada por debajo de eso que un porcentaje pueda describir.
      throw new Error("La tolerancia inferior debe ser un entero entre 0 y 100 por ciento.");
    }

    const [contract] = await db.insert(recurringContracts)
      .values({
        companyId: input.companyId,
        branchId: input.branchId && input.branchId !== "ALL" ? input.branchId : null,
        supplierId: input.supplierId,
        title: input.title,
        contractType: input.contractType,
        baseAmountCents: input.baseAmountCents,
        startDate: input.startDate,
        paymentFrequency: input.paymentFrequency ?? "MONTHLY",
        varianceTolerancePercent: arriba,
        varianceToleranceBelowPercent: abajo,
        createdBy: input.userId,
      })
      .returning();

    return contract;
  }
  
  /**
   * Fetch all payment runs for a company.
   */
  static async getPaymentRuns(companyId: string) {
    return db.query.paymentRuns.findMany({
      where: eq(paymentRuns.companyId, companyId),
      orderBy: (paymentRuns, { desc }) => [desc(paymentRuns.runDate)],
    });
  }

  /**
   * Fetch all recurring contracts for a company with vendor and branch enrichment.
   */
  static async getRecurringContracts(companyId: string) {
    const contracts = await db.query.recurringContracts.findMany({
      where: eq(recurringContracts.companyId, companyId),
      orderBy: (contracts, { asc }) => [asc(contracts.createdAt)],
    });

    const supplierIds = contracts.map(c => c.supplierId).filter(Boolean);
    const branchIds = contracts.map(c => c.branchId).filter(Boolean) as string[];

    const supplierMap = new Map<string, string>();
    if (supplierIds.length > 0) {
      const suppList = await db.query.suppliers.findMany({
        where: inArray(suppliers.id, supplierIds),
        columns: { id: true, name: true }
      });
      suppList.forEach(s => supplierMap.set(s.id, s.name));
    }

    const branchMap = new Map<string, string>();
    if (branchIds.length > 0) {
      const branchList = await db.query.branches.findMany({
        where: inArray(branches.id, branchIds),
        columns: { id: true, name: true }
      });
      branchList.forEach(b => branchMap.set(b.id, b.name));
    }

    return contracts.map(c => ({
      ...c,
      vendorName: supplierMap.get(c.supplierId) || null,
      branchName: c.branchId ? branchMap.get(c.branchId) || "Sucursal" : "Todas las sucursales",
    }));
  }

  /**
   * La validación de una factura contra su contrato recurrente vive en
   * `lib/services/recurring-contract-variance.ts`.
   *
   * Aquí existía `validateInvoiceAgainstContract`, que nadie llamaba y que
   * duplicaba con otro criterio de severidad la regla que sí corre en
   * `control-interno-service`. Además elegía contrato con
   * `contracts.find(...) || contracts[0]`: con dos contratos del mismo
   * proveedor tomaba el primero que devolviera la base de datos. Dos
   * implementaciones de una regla de dinero, una sin ejecutar, es una
   * invitación a arreglar la equivocada.
   */

  /**
   * Transition the status of a payment run with dual-signature segregation of duties (Módulo 6.2).
   *
   * La doble firma sólo vale si la corrida no puede saltarse el estado en que
   * se firma. Antes esta función aceptaba cualquier valor del enum, así que un
   * `PATCH {"status":"COMPLETED"}` sobre una corrida en `DRAFT` la cerraba y
   * marcaba sus facturas como pagadas sin que nadie la aprobara: la regla de
   * segregación de abajo sólo corre cuando `newStatus === "APPROVED"`, y a
   * `APPROVED` nunca hacía falta pasar.
   *
   * `companyId` viene de la sesión y se repite en el `WHERE` del `UPDATE`, no
   * sólo en la lectura: entre leer y escribir hay una ventana, y es el mismo
   * criterio que ya usa `approveOperatingExpense`.
   */
  static async updatePaymentRunStatus(
    paymentRunId: string,
    companyId: string,
    newStatus: typeof paymentRunStatusEnum.enumValues[number],
    userId: string
  ) {
    const currentRun = await db.query.paymentRuns.findFirst({
      where: and(eq(paymentRuns.id, paymentRunId), eq(paymentRuns.companyId, companyId)),
    });

    if (!currentRun) throw ApiError.notFound("Corrida de pago no encontrada");

    assertPaymentRunTransition(currentRun.status, newStatus);

    const updateData: any = { status: newStatus, updatedAt: new Date() };

    // Regla de Segregación de Funciones: Quien prepara NO puede auto-aprobar (Módulo 6.2)
    if (newStatus === "APPROVED") {
      if (currentRun.preparedBy === userId) {
        throw ApiError.forbidden("Segregación de funciones: El usuario que preparó la corrida de pago no puede auto-aprobarla (se requiere doble firma de un segundo usuario autorizado).");
      }
      updateData.approvedBy = userId;
    }

    // El cambio de estado y el marcado de facturas van en la misma transacción:
    // antes eran dos escrituras sueltas y un fallo entre ellas dejaba la
    // corrida cerrada con sus facturas todavía abiertas, que es la forma de
    // pagar dos veces la misma factura.
    return db.transaction(async (tx) => {
      const [updatedRun] = await tx
        .update(paymentRuns)
        .set(updateData)
        .where(
          and(
            eq(paymentRuns.id, paymentRunId),
            eq(paymentRuns.companyId, companyId),
            // Cerrojo optimista sobre el estado leído: dos transiciones
            // simultáneas dejaban de ser válidas en cuanto la primera aplicaba.
            eq(paymentRuns.status, currentRun.status)
          )
        )
        .returning();

      if (!updatedRun) {
        throw ApiError.badRequest(
          "Esta corrida cambió de estado mientras la actualizabas. Recárgala para ver cómo quedó."
        );
      }

      // If it's completed, mark all its invoices as PAID.
      if (newStatus === "COMPLETED") {
        const items = await tx.query.paymentRunItems.findMany({
          where: eq(paymentRunItems.paymentRunId, paymentRunId),
        });

        const invoiceIds = items
          .filter(i => i.itemType === 'INVOICE')
          .map(i => i.referenceId);

        if (invoiceIds.length > 0) {
          await tx.update(invoices)
            .set({ paymentStatus: 'PAID', paidAt: new Date(), paidBy: userId })
            .where(inArray(invoices.id, invoiceIds));
        }
      }

      return updatedRun;
    });
  }

  /**
   * Genera el layout de dispersión bancaria para transferencias masivas SPEI (Módulo 6.2).
   *
   * **Es una operación de tesorería, no la lectura de un reporte.** El archivo
   * lleva CLABEs de 18 dígitos en claro de todos los proveedores de la corrida,
   * así que la ruta que lo expone exige rol de gate y registra la descarga en
   * `data_access_logs` (A2.2). Aquí se aplica la otra mitad de la regla: no se
   * genera archivo de una corrida que nadie firmó.
   *
   * Antes de A2.3 esto emitía `************1234` en vez de la CLABE —un archivo
   * que ningún banco acepta—, una referencia igual para toda la corrida y
   * distinta en cada descarga, y sólo las partidas `INVOICE`: nómina, caja chica
   * e impuestos se descartaban en silencio y el `recordCount` no cuadraba con el
   * total de la corrida.
   *
   * El número de consultas es **constante**, no proporcional a las partidas:
   * la corrida, las partidas, las facturas con su proveedor y las cuentas
   * bancarias del lote. Antes eran tres por partida —600 viajes a Neon para una
   * corrida de 200 facturas.
   */
  static async generateBankDisbursementLayout(
    paymentRunId: string,
    companyId: string,
    format: BankLayoutFormat = "SPEI_CSV"
  ): Promise<BankDisbursementLayout> {
    const run = await db.query.paymentRuns.findFirst({
      where: and(eq(paymentRuns.id, paymentRunId), eq(paymentRuns.companyId, companyId)),
    });

    if (!run) throw ApiError.notFound("Corrida de pago no encontrada");

    if (!ESTADOS_DISPERSABLES.includes(run.status)) {
      throw ApiError.badRequest(
        `Esta corrida está en "${ETIQUETA_ESTADO[run.status]}" y todavía no se ha autorizado. ` +
          "Un archivo de dispersión sólo se genera de una corrida aprobada: es el archivo que se sube al banco."
      );
    }

    const items = await db.query.paymentRunItems.findMany({
      where: eq(paymentRunItems.paymentRunId, paymentRunId),
      orderBy: (i, { asc }) => [asc(i.createdAt), asc(i.id)],
    });

    const sourceAcc = sanearTexto(run.sourceAccount || "", 20) || "SIN_CUENTA_ORIGEN";

    const renglones: RenglonDispersion[] = [];
    const excluidas: PartidaExcluida[] = [];
    const avisos: string[] = [];

    // ── Facturas ───────────────────────────────────────────────────────────
    const facturaItems = items.filter((i) => i.itemType === "INVOICE");

    if (facturaItems.length > 0) {
      const filas = await db
        .select({
          id: invoices.id,
          folio: invoices.folio,
          uuid: invoices.uuid,
          supplierId: invoices.supplierId,
          supplierName: suppliers.name,
        })
        .from(invoices)
        .leftJoin(suppliers, eq(invoices.supplierId, suppliers.id))
        .where(
          and(
            eq(invoices.companyId, companyId),
            inArray(
              invoices.id,
              facturaItems.map((i) => i.referenceId)
            )
          )
        );

      const facturaPorId = new Map(filas.map((f) => [f.id, f]));

      // Una sola consulta para todas las cuentas del lote: las congeladas en
      // cada partida y las vigentes de cada proveedor. Se piden las dos porque
      // la corrida se dispersa contra la que se autorizó, y la diferencia entre
      // ambas es justo lo que hay que declarar.
      const { porProveedor, porId } = await getBankAccountsForPayment({
        companyId,
        supplierIds: filas.map((f) => f.supplierId).filter(Boolean) as string[],
        accountIds: facturaItems
          .map((i) => i.bankAccountId)
          .filter(Boolean) as string[],
      });

      for (const item of facturaItems) {
        const factura = facturaPorId.get(item.referenceId);

        if (!factura) {
          excluidas.push({
            itemId: item.id,
            itemType: item.itemType,
            amountCents: item.amountCents,
            motivo:
              "La factura referenciada no existe o no pertenece a esta empresa. Quita la partida de la corrida.",
          });
          continue;
        }

        const etiquetaFactura = factura.folio || factura.uuid.slice(0, 8);

        if (!factura.supplierId) {
          excluidas.push({
            itemId: item.id,
            itemType: item.itemType,
            amountCents: item.amountCents,
            motivo: `La factura ${etiquetaFactura} no tiene proveedor asignado: no hay a quién transferirle.`,
          });
          continue;
        }

        // Prioridad a la cuenta congelada: la corrida se firmó contra ella.
        const congelada = item.bankAccountId ? porId.get(item.bankAccountId) : undefined;
        const vigente = porProveedor.get(factura.supplierId);
        const cuenta = congelada ?? vigente;

        if (!cuenta) {
          excluidas.push({
            itemId: item.id,
            itemType: item.itemType,
            amountCents: item.amountCents,
            motivo: `"${factura.supplierName || "El proveedor"}" no tiene cuenta CLABE verificada y activa. Verifícala antes de dispersar.`,
          });
          continue;
        }

        if (!item.bankAccountId) {
          avisos.push(
            `La partida de la factura ${etiquetaFactura} se agregó antes de que se congelara la cuenta bancaria, así que se dispersa contra la cuenta verificada vigente (••••${cuenta.clabeLast4}).`
          );
        } else if (vigente && vigente.accountId !== cuenta.accountId) {
          // No se cambia la cuenta sola: el archivo sale contra la firmada y se
          // dice en voz alta. Cambiar de destino sin una segunda firma es el
          // fraude que todo el módulo de verificación existe para impedir.
          avisos.push(
            `"${factura.supplierName || "El proveedor"}" registró una cuenta distinta (••••${vigente.clabeLast4}) después de que se autorizó esta corrida. El archivo se genera contra la cuenta que se firmó (••••${cuenta.clabeLast4}).`
          );
        }

        renglones.push({
          itemId: item.id,
          clabe: cuenta.clabe,
          bankName: cuenta.bankName,
          beneficiario: cuenta.accountHolderName || factura.supplierName || "PROVEEDOR",
          amountCents: item.amountCents,
          concepto: `PAGO FAC ${etiquetaFactura}`,
        });
      }
    }

    // ── Nómina ─────────────────────────────────────────────────────────────
    const nominaItems = items.filter((i) => i.itemType === "PAYROLL");

    if (nominaItems.length > 0) {
      const recibos = await db
        .select({
          runId: payrollPayslips.runId,
          userId: payrollPayslips.userId,
          userName: users.name,
          percepcionesCents: payrollPayslips.totalPercepcionesCents,
          bankName: employeeProfiles.bankName,
          clabe: employeeProfiles.clabe,
        })
        .from(payrollPayslips)
        .leftJoin(users, eq(payrollPayslips.userId, users.id))
        .leftJoin(employeeProfiles, eq(payrollPayslips.userId, employeeProfiles.userId))
        .where(
          inArray(
            payrollPayslips.runId,
            nominaItems.map((i) => i.referenceId)
          )
        );

      // Las CLABEs de empleado viven cifradas cuando `PULSO_ENCRYPT_PII` está
      // encendido. La versión por lote desenvuelve el DEK una sola vez.
      const descifrados = (await decryptProfileRecords(
        companyId,
        recibos as unknown as Record<string, unknown>[]
      )) as Array<Record<string, unknown>>;

      const porCorrida = new Map<string, Array<Record<string, unknown>>>();
      for (const recibo of descifrados) {
        const runIdRecibo = recibo.runId as string;
        const lista = porCorrida.get(runIdRecibo) ?? [];
        lista.push(recibo);
        porCorrida.set(runIdRecibo, lista);
      }

      for (const item of nominaItems) {
        const lista = porCorrida.get(item.referenceId) ?? [];

        if (lista.length === 0) {
          excluidas.push({
            itemId: item.id,
            itemType: item.itemType,
            amountCents: item.amountCents,
            motivo:
              "La corrida de nómina referenciada no tiene recibos calculados: no hay CLABEs contra las cuales dispersar.",
          });
          continue;
        }

        const sinClabe = lista.filter((r) => !esClabe(r.clabe as string | null));

        if (sinClabe.length > 0) {
          const nombres = sinClabe
            .map((r) => (r.userName as string) || (r.userId as string))
            .slice(0, 3)
            .join(", ");
          excluidas.push({
            itemId: item.id,
            itemType: item.itemType,
            amountCents: item.amountCents,
            motivo: `${sinClabe.length} de ${lista.length} empleados de esta nómina no tienen CLABE capturada (${nombres}${sinClabe.length > 3 ? "…" : ""}). Captúralas antes de dispersar: un archivo parcial le paga a unos y a otros no, sin decirlo.`,
          });
          continue;
        }

        // Una partida de nómina son N transferencias, una por empleado. El
        // monto de cada renglón son las percepciones del recibo, que es la
        // misma base con la que la partida entró a la corrida
        // (`assertCounterpartyPayable`): el archivo y el total firmado tienen
        // que decir lo mismo.
        for (const recibo of lista) {
          renglones.push({
            itemId: `${item.id}:${recibo.userId as string}`,
            clabe: String(recibo.clabe),
            bankName: (recibo.bankName as string) || "BANCO",
            beneficiario: (recibo.userName as string) || "EMPLEADO",
            amountCents: Number(recibo.percepcionesCents || 0),
            concepto: "NOMINA",
          });
        }

        avisos.push(
          `La nómina se dispersa en ${lista.length} transferencias, una por empleado, por el total de percepciones de cada recibo. Las deducciones no se restan aquí: es la misma base con la que la partida entró a la corrida.`
        );
      }
    }

    // ── Lo que no se dispersa por SPEI, declarado ─────────────────────────
    for (const item of items) {
      const motivo = MOTIVO_NO_DISPERSABLE[item.itemType];
      if (!motivo) continue;
      excluidas.push({
        itemId: item.id,
        itemType: item.itemType,
        amountCents: item.amountCents,
        motivo,
      });
    }

    if (renglones.length === 0) {
      throw ApiError.badRequest(
        "Ninguna partida de esta corrida se puede dispersar por SPEI. " +
          excluidas.map((e) => e.motivo).join(" ") +
          " Un archivo vacío es un intento perdido en el portal del banco; se prefiere decirlo aquí."
      );
    }

    // ── Armado del archivo ────────────────────────────────────────────────
    const referencias = asignarReferencias(renglones.map((r) => r.itemId));

    const lines: string[] = [
      "CUENTA_ORIGEN,CLABE_DESTINO,BANCO_DESTINO,BENEFICIARIO,MONTO_PESOS,CONCEPTO,REFERENCIA",
    ];

    let totalCents = 0;
    for (const r of renglones) {
      const amountPesos = (r.amountCents / 100).toFixed(2);
      const ref = referencias.get(r.itemId)!;

      // Escape de CSV real: un proveedor llamado `Distribuidora "El Norte",
      // S.A.` partía la fila en dos y desalineaba todas las columnas de esa
      // línea — el banco leía el nombre como monto.
      lines.push(
        [
          csv(sourceAcc),
          csv(r.clabe),
          csv(sanearTexto(r.bankName, 30)),
          csv(sanearTexto(r.beneficiario, 40)),
          amountPesos,
          csv(sanearTexto(r.concepto, 40)),
          csv(ref),
        ].join(",")
      );

      totalCents += r.amountCents;
    }

    return {
      runId: run.id,
      runTitle: run.title,
      format,
      recordCount: renglones.length,
      itemCount: items.length,
      excludedCount: excluidas.length,
      excludedAmountCents: excluidas.reduce((s, e) => s + e.amountCents, 0),
      excluded: excluidas,
      avisos,
      totalPesos: (totalCents / 100).toFixed(2),
      runTotalPesos: (run.totalAmountCents / 100).toFixed(2),
      content: lines.join("\n"),
    };
  }
}
