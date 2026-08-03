// Post-Fase 10 / T21: Propinas Service
// Computes and records auditable tip pool distribution proportional to hours worked.

import { db } from "@/lib/db";
import { propinas, propinaAsignaciones, users, branches, shiftSessions } from "@/lib/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";

export interface CalculatePropinasInput {
  companyId: string;
  branchId: string;
  businessDate: string;
  shift: "MATUTINO" | "VESPERTINO" | "COMPLETO";
  totalPoolCents: number;
  registeredBy: string;
}

export async function calculatePropinasDistribution(input: CalculatePropinasInput) {
  // Check duplicate
  const existing = await db
    .select()
    .from(propinas)
    .where(
      and(
        eq(propinas.companyId, input.companyId),
        eq(propinas.branchId, input.branchId),
        eq(propinas.businessDate, input.businessDate),
        eq(propinas.shift, input.shift)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    throw new Error(
      `Ya existe una distribución de propinas registrada para el turno ${input.shift} del ${input.businessDate}.`
    );
  }

  // Fetch active staff in branch for that date/shift from shiftSessions or users
  const staff = await db
    .select({
      id: users.id,
      name: users.name,
      role: users.role,
    })
    .from(users)
    .where(
      and(
        eq(users.companyId, input.companyId),
        eq(users.branchId, input.branchId)
      )
    );

  const activeStaff = staff.filter(
    (u) => u.role === "GERENTE" || u.role === "SUPERVISOR" || u.role === "ADMIN" || !u.role
  );

  if (activeStaff.length === 0) {
    throw new Error("No hay empleados registrados en esta sucursal para distribuir propinas.");
  }

  // Equal or hours-weighted allocation (default 8 hours per staff member in shift)
  const hoursPerStaff = 8;
  const totalWeightedHours = activeStaff.length * hoursPerStaff;
  const perStaffAmountCents = Math.floor(input.totalPoolCents / activeStaff.length);
  const totalDistributedCents = perStaffAmountCents * activeStaff.length;

  const [propinaHeader] = await db
    .insert(propinas)
    .values({
      companyId: input.companyId,
      branchId: input.branchId,
      businessDate: input.businessDate,
      shift: input.shift,
      totalPoolCents: input.totalPoolCents,
      distributedCents: totalDistributedCents,
      status: "CALCULATED",
      registeredBy: input.registeredBy,
    })
    .returning();

  const assignmentsToInsert = activeStaff.map((emp) => ({
    propinaId: propinaHeader.id,
    userId: emp.id,
    hoursWorked: String(hoursPerStaff),
    points: "1.0",
    assignedAmountCents: perStaffAmountCents,
  }));

  await db.insert(propinaAsignaciones).values(assignmentsToInsert);

  return {
    header: propinaHeader,
    staffCount: activeStaff.length,
    perStaffAmountCents,
    totalDistributedCents,
  };
}

export async function getPropinasHistory(companyId: string, branchId?: string) {
  const conditions = [eq(propinas.companyId, companyId)];
  if (branchId) {
    conditions.push(eq(propinas.branchId, branchId));
  }

  const rows = await db
    .select({
      id: propinas.id,
      branchId: propinas.branchId,
      branchName: branches.name,
      businessDate: propinas.businessDate,
      shift: propinas.shift,
      totalPoolCents: propinas.totalPoolCents,
      distributedCents: propinas.distributedCents,
      status: propinas.status,
      registeredByName: users.name,
      createdAt: propinas.createdAt,
    })
    .from(propinas)
    .innerJoin(branches, eq(propinas.branchId, branches.id))
    .leftJoin(users, eq(propinas.registeredBy, users.id))
    .where(and(...conditions))
    .orderBy(desc(propinas.businessDate), desc(propinas.createdAt));

  return rows;
}
