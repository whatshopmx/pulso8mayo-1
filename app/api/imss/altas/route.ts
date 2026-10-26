import { NextRequest, NextResponse } from "next/server";
import { imssAccess, imssBranchScope, imssError } from '@/lib/services/compliance/imss-http';
import { isRegistroPatronal } from '@/lib/services/compliance/imss-registro';
import { ImssMovementService } from '@/lib/services/compliance/imss-movement-service';
import { db } from "@/lib/db";
import { users, employeeProfiles, employeeContracts, branches } from "@/lib/db/schema";
import { eq, and, isNull, or, notInArray, desc, inArray } from "drizzle-orm";
import { decryptProfileRecords } from "@/lib/security/employee-cipher";
import {
    IMSS_EXCLUDED_PROFILE_STATUSES,
    IMSS_REGISTRABLE_ROLES,
    resolveAltaState,
    todayInMx,
    type ImssBlockedReason,
} from "@/lib/services/compliance/imss-rules";

export interface IMSSAlta {
    userId: string;
    branchId?: string | null;
    imssStatus?: string;
    fileId?: string | null;
    name: string;
    email: string;
    nss: string | null;
    curp: string | null;
    rfc: string | null;
    department: string | null;
    position: string | null;
    /** Salario base diario del contrato vigente, en centavos. `null` = sin contrato. */
    baseSalaryCents: number | null;
    hireDate: string | null;
    employeeNumber: string | null;
    branchName: string | null;
    /** Derivado por `resolveAltaState`; el vencimiento es un flag aparte (H2). */
    status: "PENDING" | "READY" | "REGISTERED";
    overdue: boolean;
    /** Días hábiles transcurridos desde el alta (H11). */
    daysSinceHire: number;
    /** `blocked_reason` de `imss_movements` para las filas no listas (H1). */
    blockedReasons: ImssBlockedReason[];
}

export interface IMSSAltaSummary {
    pending: number;
    inFile: number;
    blocked: number;
    ready: number;
    registered: number;
    overdue: number;
}

/**
 * GET /api/imss/altas
 * Empleados que requieren alta IMSS, clasificados con las reglas puras
 * (`imss-rules.ts`): identidad completa (RFC 12 **o** 13), plazo en días
 * hábiles y vencimiento como flag independiente del estado.
 *
 * `REGISTERED` se deriva del último movimiento confirmado de la contratación
 * vigente. Generar un archivo mantiene el movimiento sin confirmar.
 */
export async function GET(req: NextRequest) {
    try {
        const access = await imssAccess();
        const branchId = imssBranchScope(req, access.branchScope);

        const conditions = [
            eq(users.companyId, access.companyId),
            isNull(users.deletedAt),
            eq(users.active, true),
            or(
                isNull(employeeProfiles.employeeStatus),
                notInArray(employeeProfiles.employeeStatus, [...IMSS_EXCLUDED_PROFILE_STATUSES]),
            ),
        ];

        if (branchId && branchId !== "all" && branchId !== "ALL") {
            conditions.push(eq(users.branchId, branchId));
        }

        const employees = await decryptProfileRecords(access.companyId, await db
            .select({
                id: users.id,
                name: users.name,
                email: users.email,
                role: users.role,
                branchId: users.branchId,
                employeeStatus: employeeProfiles.employeeStatus,
                department: employeeProfiles.department,
                position: employeeProfiles.position,
                nss: employeeProfiles.nss,
                curp: employeeProfiles.curp,
                rfc: employeeProfiles.rfc,
                hireDate: employeeProfiles.hireDate,
                employeeNumber: employeeProfiles.employeeNumber,
            })
            .from(users)
            .leftJoin(employeeProfiles, eq(users.id, employeeProfiles.userId))
            .where(and(...conditions))
            .orderBy(desc(users.createdAt)));

        // Salario base del contrato VIGENTE (H10): se consulta aparte para no
        // multiplicar filas por contratos históricos y para no inventar 0.
        const userIds = employees.map(e => e.id);
        const imssStates = await ImssMovementService.getAfiliacionState(access.companyId, userIds);
        const contractByUser = new Map<string, number>();
        if (userIds.length > 0) {
            const contracts = await db
                .select({
                    userId: employeeContracts.userId,
                    baseSalary: employeeContracts.baseSalary,
                    startDate: employeeContracts.startDate,
                    endDate: employeeContracts.endDate,
                })
                .from(employeeContracts)
                .where(and(
                    eq(employeeContracts.companyId, access.companyId),
                    inArray(employeeContracts.userId, userIds),
                ))
                .orderBy(desc(employeeContracts.startDate));

            const todayMs = todayInMx().getTime();
            for (const contract of contracts) {
                if (contractByUser.has(contract.userId)) continue;
                const end = contract.endDate ? new Date(contract.endDate).getTime() : null;
                const start = new Date(contract.startDate).getTime();
                const isCurrent = start <= todayMs && (end === null || end >= todayMs);
                if (isCurrent) contractByUser.set(contract.userId, contract.baseSalary);
            }
        }

        // Nombres de sucursal para la columna de la tabla. Se filtra por empresa:
        // antes era un `findMany()` sin `where` y la respuesta incluía los nombres
        // de sucursal de OTRAS empresas (fuga entre tenants).
        const branchesAll = await db.query.branches.findMany({
            columns: { id: true, name: true, imssRegistroPatronal: true },
            where: and(eq(branches.companyId, access.companyId), branchId ? eq(branches.id, branchId) : undefined),
        });
        const branchMap: Record<string, string> = Object.fromEntries(
            branchesAll.map(b => [b.id, b.name])
        );

        const rpByBranch = new Map(branchesAll.map(row => [row.id, row.imssRegistroPatronal]));
        const today = todayInMx();

        const altas: IMSSAlta[] = employees
            .filter(e => (IMSS_REGISTRABLE_ROLES as readonly string[]).includes(e.role ?? ""))
            .map(e => {
                const movement = imssStates.get(e.id)?.ALTA;
                const currentMovement = movement && e.hireDate && movement.effectiveDate >= new Date(e.hireDate).toISOString().slice(0, 10) ? movement : undefined;
                const baseSalaryCents = contractByUser.get(e.id) ?? null;
                const rule = resolveAltaState(
                    {
                        nss: e.nss,
                        curp: e.curp,
                        rfc: e.rfc,
                        hireDate: e.hireDate,
                        baseSalaryCents,
                    },
                    today,
                    // Decisión 5 (`plan-imss`): sin contrato vigente no se puede
                    // armar el movimiento, así que la fila se reporta PENDIENTE con
                    // `SIN_SALARIO_BASE` en vez de ofrecer una descarga que el
                    // generador va a rechazar. La ruta YA resolvió el contrato (H10),
                    // así que este bloqueo no cuesta una consulta extra.
                    { requireBaseSalary: true, registered: currentMovement?.status === 'CONFIRMADO' },
                );

                const missing = [...rule.missing];
                if (!isRegistroPatronal(e.branchId ? rpByBranch.get(e.branchId) : null)) missing.push('SIN_REGISTRO_PATRONAL');
                const status: IMSSAlta["status"] =
                    currentMovement?.status === 'EN_ARCHIVO' ? 'PENDING' : rule.state === "REGISTRADO" ? "REGISTERED"
                        : missing.length === 0 ? "READY"
                            : "PENDING";

                return {
                    userId: e.id,
                    branchId: e.branchId,
                    fileId: currentMovement?.fileId ?? null,
                    name: e.name || e.email,
                    email: e.email,
                    nss: e.nss || null,
                    curp: e.curp || null,
                    rfc: e.rfc || null,
                    department: e.department || null,
                    position: e.position || null,
                    baseSalaryCents,
                    hireDate: e.hireDate ? new Date(e.hireDate).toISOString() : null,
                    employeeNumber: e.employeeNumber || null,
                    branchName: e.branchId ? (branchMap[e.branchId] || null) : null,
                    status,
                    imssStatus: currentMovement?.status ?? 'SIN_ALTA',
                    overdue: rule.overdue,
                    daysSinceHire: rule.daysElapsed,
                    blockedReasons: missing,
                };
            });

        // Summary se calcula sobre EXACTAMENTE las filas devueltas.
        const summary: IMSSAltaSummary = {
            inFile: altas.filter(row => row.imssStatus === 'EN_ARCHIVO').length,
            blocked: altas.filter(row => row.status === 'PENDING' && row.imssStatus !== 'EN_ARCHIVO').length,
            pending: altas.filter(a => a.status === "PENDING").length,
            ready: altas.filter(a => a.status === "READY").length,
            registered: altas.filter(a => a.status === "REGISTERED").length,
            overdue: altas.filter(a => a.overdue).length,
        };

        return NextResponse.json({
            altas,
            summary,
            branches: branchesAll,
            permissions: { canAdopt: access.canAcknowledge },
        });
    } catch (error) {
        return imssError(error);
    }
}
