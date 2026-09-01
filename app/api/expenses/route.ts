import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { branches } from "@/lib/db/schema";
import { withRoleAuth } from "@/lib/api/with-auth";
import { ApiHandler } from "@/lib/api/response";
import { ApiError } from "@/lib/api/error";
import { enforceBranchScope, resolveBranchScope } from "@/lib/branch-scope";
import {
  createOperatingExpense,
  getOperatingExpenses,
} from "@/lib/services/expense-service";

/**
 * Gastos operativos y su cadena de autorización.
 *
 * `EMPLEADO` y `READONLY` quedan fuera de ambos verbos: aquí se leen costos de
 * proveedor y montos colindantes con nómina de todas las sucursales, y se
 * compromete el pago. Cerrar sólo la ruta del dashboard no bastaba — un `fetch`
 * a la API no pasa por el mismo camino que el navegador.
 */
const ROLES_FINANZAS = ["SUPER_ADMIN", "ADMIN", "GERENTE", "SUPERVISOR"] as const;

const createExpenseSchema = z.object({
  branchId: z.string().uuid("La sucursal es inválida."),
  category: z.enum([
    "RENTA",
    "SERVICIOS",
    "MANTENIMIENTO",
    "PUBLICIDAD",
    "SERVICIOS_PROFESIONALES",
    "OTROS",
  ]),
  amountCents: z.number().int().positive("El monto debe ser mayor a cero."),
  description: z.string().min(1, "La descripción es requerida."),
  invoiceId: z.string().optional().nullable(),
  dueDate: z.string().optional().nullable(),
  evidenceUrl: z.string().optional().nullable(),
  payeeId: z.string().uuid("La contraparte es inválida.").optional().nullable(),
  costCenterId: z.string().uuid("El centro de costo es inválido.").optional().nullable(),
});

/** Nombre de la sucursal en foco, para poder rotular el alcance sin adivinarlo. */
async function nombreDeSucursal(
  tenantId: string,
  branchId: string | null
): Promise<string | null> {
  if (!branchId) return null;
  const [fila] = await db
    .select({ name: branches.name })
    .from(branches)
    .where(and(eq(branches.id, branchId), eq(branches.companyId, tenantId)))
    .limit(1);
  return fila?.name ?? null;
}

/**
 * GET /api/expenses
 *
 * Devuelve `{ items, scope, truncated }`. El `scope` es el alcance **aplicado**,
 * no el pedido: a un GERENTE o SUPERVISOR que pide otra sucursal se le devuelve
 * la suya, y la pantalla necesita saberlo para rotularlo. Cifras del grupo
 * etiquetadas como una sucursal son peor que no tener el filtro.
 */
export const GET = withRoleAuth([...ROLES_FINANZAS], async (req, { auth }) => {
  const { searchParams } = new URL(req.url);

  // El `branchId` del query no llega al servicio sin pasar por aquí.
  const alcance = resolveBranchScope(
    auth.user.role as never,
    auth.branchId,
    searchParams.get("branchId")
  );

  // Un rol de sucursal SIN sucursal asignada devuelve cero, no el libro del
  // grupo. `kind` lo declara para que la pantalla distinga "no hay gastos" de
  // "tu usuario no tiene sucursal": antes ambos casos eran `branchId: null`.
  if (alcance.kind === "NONE") {
    return ApiHandler.success({
      items: [],
      scope: { branchId: null, branchName: null, kind: "NONE" as const },
      truncated: false,
    });
  }

  const effectiveBranchId = alcance.kind === "BRANCH" ? alcance.branchId : null;
  const payeeId = searchParams.get("payeeId") || undefined;
  // El centinela viaja tal cual: `SIN_CENTRO` no es un uuid y el servicio lo
  // traduce a "los que no tienen partida".
  const costCenterId = searchParams.get("costCenterId") || undefined;

  const [{ items, truncated }, branchName] = await Promise.all([
    getOperatingExpenses(auth.tenantId, effectiveBranchId ?? undefined, {
      payeeId,
      costCenterId,
    }),
    nombreDeSucursal(auth.tenantId, effectiveBranchId),
  ]);

  return ApiHandler.success({
    items,
    scope: { branchId: effectiveBranchId, branchName, kind: alcance.kind },
    truncated,
  });
});

/**
 * POST /api/expenses
 *
 * La sucursal del gasto también pasa por `enforceBranchScope`: un rol fijado a
 * una sucursal que registra gastos en otra ensucia el libro de alguien más, y
 * es la misma fuga del GET en forma de escritura.
 */
export const POST = withRoleAuth([...ROLES_FINANZAS], async (req, { auth }) => {
  const body = await req.json();
  const data = createExpenseSchema.parse(body);

  const branchId = enforceBranchScope(
    auth.user.role as never,
    auth.branchId,
    data.branchId
  );
  if (!branchId) {
    throw ApiError.badRequest("No hay una sucursal válida para registrar el gasto.");
  }

  const expense = await createOperatingExpense({
    companyId: auth.tenantId,
    branchId,
    category: data.category,
    amountCents: data.amountCents,
    description: data.description,
    invoiceId: data.invoiceId || undefined,
    dueDate: data.dueDate || undefined,
    evidenceUrl: data.evidenceUrl || undefined,
    payeeId: data.payeeId || undefined,
    costCenterId: data.costCenterId || undefined,
    requestedBy: auth.user.id,
  });

  return ApiHandler.success(expense);
});
