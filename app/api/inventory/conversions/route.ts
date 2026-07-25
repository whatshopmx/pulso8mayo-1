import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireTenant } from "@/lib/tenant-context";
import { hasPermission } from "@/lib/permissions";
import { UnitConversionService } from "@/lib/services/unit-conversion-service";

const createSchema = z.object({
  fromUnit: z.string().min(1),
  toUnit: z.string().min(1),
  factor: z.number().positive(),
  description: z.string().optional(),
});

export async function GET() {
  try {
    const tenant = await requireTenant();
    const { user } = await requireAuth();

    if (!hasPermission(user.role, 'inventory', 'read')) {
      return NextResponse.json({ error: "No tienes permisos" }, { status: 403 });
    }

    if (!tenant.id) {
      return NextResponse.json({ error: "Usuario no asignado a una empresa" }, { status: 403 });
    }

    const conversions = await UnitConversionService.getConversions(tenant.id);
    return NextResponse.json(conversions);
  } catch (error) {
    console.error("Failed to fetch conversions", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const tenant = await requireTenant();
    const { user } = await requireAuth();

    if (!hasPermission(user.role, 'inventory', 'create')) {
      return NextResponse.json({ error: "No tienes permisos" }, { status: 403 });
    }

    if (!tenant.id) {
      return NextResponse.json({ error: "Usuario no asignado a una empresa" }, { status: 403 });
    }

    const body = await req.json();
    const data = createSchema.parse(body);

    const conversion = await UnitConversionService.createConversion({
      companyId: tenant.id,
      ...data,
    });

    return NextResponse.json(conversion, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Datos inválidos", details: error.issues }, { status: 400 });
    }
    console.error("Failed to create conversion", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
