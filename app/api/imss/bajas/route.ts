import { NextRequest, NextResponse } from "next/server";
import { imssAccess, imssBranchScope, imssError } from '@/lib/services/compliance/imss-http';
import { isRegistroPatronal } from '@/lib/services/compliance/imss-registro';
import { ImssMovementService } from '@/lib/services/compliance/imss-movement-service';
import { db } from "@/lib/db";
import { users, employeeProfiles, branches } from "@/lib/db/schema";
import { eq, and, isNull, inArray, desc } from "drizzle-orm";
import { decryptProfileRecords } from "@/lib/security/employee-cipher";
import { resolveCurrentContracts } from '@/lib/services/compliance/imss-contracts';
import {
    IMSS_DEREGISTRATION_PROFILE_STATUSES,
    IMSS_REGISTRABLE_ROLES,
    resolveBajaState,
    resolveAltaState,
    todayInMx,
    type ImssBlockedReason,
} from "@/lib/services/compliance/imss-rules";

export interface IMSSBaja {
    userId: string;
    branchId?: string | null;
    imssStatus?: string;
    fileId?: string | null;
    name: string;
    email: string;
    nss: string | null;
    employeeNumber: string | null;
    branchName: string | null;
    terminationDate: string | null;
    /** Motivo REAL capturado en el offboard; `null` si nunca se registró (H4). */
    terminationReason: string | null;
    /** Derivado por `resolveBajaState`; el vencimiento es un flag aparte (H2). */
    status: "PENDING" | "READY" | "DEREGISTERED";
    overdue: boolean;
    /** Días hábiles transcurridos desde la baja (H11). */
    daysSinceTermination: number;
    blockedReasons: ImssBlockedReason[];
}

export interface IMSSBajaSummary {
    pending: number;
    inFile: number;
    blocked: number;
    /** Bajas listas para incluir en el archivo IDSE. */
    ready: number;
    registered: number;
    overdue: number;
}

/**
 * GET /api/imss/bajas
 * Empleados con baja pendiente de aviso al IMSS.
 *
 * Corrige H3: el `select` no traía `employeeStatus`, así que el filtro leía
 * `undefined` y la lista salía SIEMPRE vacía. Ahora el estado se filtra en SQL
 * con la precedencia correcta (`status ∈ {TERMINATED, RESIGNED}`, sin `&&`/`||`
 * encadenados) y el motivo de baja ya no se inventa.
 */
export async function GET(req: NextRequest) {
    try {
        const access = await imssAccess();
        const branchId = imssBranchScope(req, access.branchScope);

        const conditions = [
            eq(users.companyId, access.companyId),
            isNull(users.deletedAt),
            inArray(employeeProfiles.employeeStatus, [...IMSS_DEREGISTRATION_PROFILE_STATUSES]),
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
                nss: employeeProfiles.nss,
                curp: employeeProfiles.curp,
                rfc: employeeProfiles.rfc,
                hireDate: employeeProfiles.hireDate,
                employeeStatus: employeeProfiles.employeeStatus,
                terminationDate: employeeProfiles.terminationDate,
                terminationReason: employeeProfiles.terminationReason,
                employeeNumber: employeeProfiles.employeeNumber,
            })
            .from(users)
            .leftJoin(employeeProfiles, eq(users.id, employeeProfiles.userId))
            .where(and(...conditions))
            .orderBy(desc(employeeProfiles.terminationDate), desc(users.updatedAt)));

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
        const imssStates = await ImssMovementService.getAfiliacionState(access.companyId, employees.map(row => row.id));
        const contracts = await resolveCurrentContracts(access.companyId, employees.map(row => row.id), today);

        const bajas: IMSSBaja[] = employees
            .filter(e => (IMSS_REGISTRABLE_ROLES as readonly string[]).includes(e.role ?? ""))
            .map(e => {
                const movement = imssStates.get(e.id)?.BAJA;
                const currentMovement = movement && e.terminationDate && movement.effectiveDate >= new Date(e.terminationDate).toISOString().slice(0, 10) ? movement : undefined;
                const rule = resolveBajaState(
                    { nss: e.nss, curp: e.curp, terminationDate: e.terminationDate },
                    today,
                    { registered: currentMovement?.status === 'CONFIRMADO' },
                );

                const missing = [...new Set([...rule.missing, ...resolveAltaState({ ...e, baseSalaryCents: contracts.get(e.id)?.baseSalaryCents }, today, { requireBaseSalary: true }).missing])];
                if (!isRegistroPatronal(e.branchId ? rpByBranch.get(e.branchId) : null)) missing.push('SIN_REGISTRO_PATRONAL');
                const status: IMSSBaja["status"] =
                    currentMovement?.status === 'EN_ARCHIVO' ? 'PENDING' : rule.state === "REGISTRADO" ? "DEREGISTERED"
                        : missing.length === 0 ? "READY"
                            : "PENDING";

                return {
                    userId: e.id,
                    branchId: e.branchId,
                    fileId: currentMovement?.fileId ?? null,
                    name: e.name || e.email,
                    email: e.email,
                    nss: e.nss || null,
                    employeeNumber: e.employeeNumber || null,
                    branchName: e.branchId ? (branchMap[e.branchId] || null) : null,
                    terminationDate: e.terminationDate
                        ? new Date(e.terminationDate).toISOString()
                        : null,
                    terminationReason: e.terminationReason || null,
                    status,
                    imssStatus: currentMovement?.status ?? 'SIN_BAJA',
                    overdue: rule.overdue,
                    daysSinceTermination: rule.daysElapsed,
                    blockedReasons: missing,
                };
            });

        // Summary sobre EXACTAMENTE las filas devueltas.
        const summary: IMSSBajaSummary = {
            inFile: bajas.filter(row => row.imssStatus === 'EN_ARCHIVO').length,
            blocked: bajas.filter(row => row.status === 'PENDING' && row.imssStatus !== 'EN_ARCHIVO').length,
            pending: bajas.filter(b => b.status === "PENDING").length,
            ready: bajas.filter(b => b.status === "READY").length,
            registered: bajas.filter(b => b.status === "DEREGISTERED").length,
            overdue: bajas.filter(b => b.overdue).length,
        };

        return NextResponse.json({
            bajas,
            summary,
            branches: branchesAll,
            permissions: { canAdopt: access.canAcknowledge },
        });
    } catch (error) {
        return imssError(error);
    }
}
