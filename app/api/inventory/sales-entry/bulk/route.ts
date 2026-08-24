// T8 (plan-inventario-desconexion): ingest bulk de ventas con permiso
// corporativo. No depende de `session.user.branchId`: el alcance se resuelve
// fail-closed con `resolveBranchScope` — ALL puede elegir cualquier sucursal
// explícita; BRANCH queda fijado a la propia; NONE no pasa.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { resolveBranchScope } from "@/lib/branch-scope";
import type { Role } from "@/lib/permissions";
import { hasPermission } from "@/lib/permissions";
import {
  SalesIngestService,
  type SalesColumnMapping,
} from "@/lib/services/sales-ingest-service";

const bulkSchema = z.object({
  branchId: z.string().uuid(),
  csvText: z.string().min(1),
  mapping: z.object({
    recipeRef: z.string().min(1),
    quantitySold: z.string().min(1),
    saleDate: z.string().optional(),
    totalRevenue: z.string().optional(),
  }),
  defaultDay: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  delimiter: z.enum([",", ";", "\t"]).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.user?.id || !session.user.companyId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const role = (session.user as { role?: Role }).role ?? "ADMIN";
    if (!hasPermission(role, "inventory", "manage")) {
      return NextResponse.json(
        { error: "No tienes permisos para registrar ventas" },
        { status: 403 }
      );
    }

    const body = bulkSchema.parse(await req.json());

    const scope = resolveBranchScope(
      role,
      session.user.branchId,
      body.branchId
    );

    let branchId: string;
    if (scope.kind === "BRANCH") {
      branchId = scope.branchId;
      if (branchId !== body.branchId) {
        return NextResponse.json(
          { error: "No puedes importar ventas de otra sucursal" },
          { status: 403 }
        );
      }
    } else if (scope.kind === "ALL") {
      branchId = body.branchId;
    } else {
      return NextResponse.json(
        { error: "Tu usuario no tiene una sucursal asignada" },
        { status: 403 }
      );
    }

    const parsed = SalesIngestService.buildRows(body.csvText, body.mapping, {
      defaultDay: body.defaultDay,
      delimiter: body.delimiter,
    });

    if (parsed.rows.length === 0) {
      return NextResponse.json(
        {
          inserted: 0,
          skipped: 0,
          errors: parsed.errors,
          message: "Ninguna fila válida en el archivo",
        },
        { status: 400 }
      );
    }

    const result = await SalesIngestService.ingest({
      companyId: session.user.companyId,
      branchId,
      userId: session.user.id,
      rows: parsed.rows,
    });

    return NextResponse.json({
      ...result,
      errors: [...parsed.errors, ...result.errors],
    });
  } catch (error) {
    console.error("Sales entry bulk error:", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid data", details: error.issues },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to import sales" },
      { status: 500 }
    );
  }
}
