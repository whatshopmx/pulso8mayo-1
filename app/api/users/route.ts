import { NextRequest } from "next/server";
import { UserService } from "@/lib/services/user-service";
import { ApiHandler } from "@/lib/api/response";
import { requireTenantAuth } from "@/lib/api/with-auth";
import { createUserSchema } from "@/lib/validations/user";
import { hasPermission, ROLES_HIERARCHY, type Role } from "@/lib/permissions";
import { resolveBranchScope } from "@/lib/branch-scope";

const USER_LIST_ROLES: ReadonlySet<Role> = new Set([
    "SUPER_ADMIN",
    "OWNER",
    "ADMIN",
    "GERENTE",
    "SUPERVISOR",
    "READONLY",
]);

function canAssignRole(actorRole: Role, targetRole: Role): boolean {
    if (actorRole === "SUPER_ADMIN") return true;
    return ROLES_HIERARCHY[actorRole] > ROLES_HIERARCHY[targetRole];
}

function stripPinCode<T extends Record<string, unknown>>(row: T): Omit<T, "pinCode"> {
    const { pinCode: _pinCode, ...safe } = row;
    return safe;
}

export async function GET(req: NextRequest) {
    try {
        const auth = await requireTenantAuth();
        const actorRole = auth.user.role as Role;

        if (!USER_LIST_ROLES.has(actorRole)) {
            return ApiHandler.error(
                { message: "No tienes permisos para ver el listado de usuarios", code: "FORBIDDEN" },
                403
            );
        }

        const { searchParams } = new URL(req.url);
        const page = searchParams.get("page") ? parseInt(searchParams.get("page")!) : 1;
        const limit = searchParams.get("limit") ? parseInt(searchParams.get("limit")!) : 20;
        const search = searchParams.get("search") || undefined;
        const roleFilter = searchParams.get("role") || undefined;
        const requestedBranchId = searchParams.get("branchId") || undefined;

        const scope = resolveBranchScope(actorRole, auth.branchId, requestedBranchId);
        if (scope.kind === "NONE") {
            return ApiHandler.success({
                data: [],
                meta: { page, limit, total: 0, totalPages: 0 },
            });
        }

        const effectiveBranchId = scope.kind === "BRANCH" ? scope.branchId : undefined;

        const result = await UserService.listUsers(auth.tenantId, {
            page,
            limit,
            search,
            role: roleFilter as Role | undefined,
            branchId: effectiveBranchId,
        });

        return ApiHandler.success({
            ...result,
            data: Array.isArray(result.data)
                ? result.data.map((u) => stripPinCode(u as Record<string, unknown>))
                : [],
        });
    } catch (error) {
        return ApiHandler.error(error);
    }
}

export async function POST(req: NextRequest) {
    try {
        const auth = await requireTenantAuth();
        const actorRole = auth.user.role as Role;

        // Permission check: Only SUPER_ADMIN, OWNER, ADMIN, or GERENTE can create users
        if (!hasPermission(actorRole, "users", "create")) {
            return ApiHandler.error(
                {
                    message: "No tienes permisos para crear usuarios",
                    code: "FORBIDDEN",
                },
                403
            );
        }

        const body = await req.json();
        const validatedData = createUserSchema.parse({
            ...body,
            companyId: auth.tenantId, // Enforce user creation in current tenant
        });

        // Role hierarchy check: cannot create users with higher or equal role (except SUPER_ADMIN)
        if (validatedData.role && !canAssignRole(actorRole, validatedData.role)) {
            return ApiHandler.error(
                {
                    message: "No puedes crear usuarios con un rol igual o superior al tuyo",
                    code: "FORBIDDEN",
                },
                403
            );
        }

        // Branch scope check for branch-scoped managers (GERENTE)
        const scope = resolveBranchScope(actorRole, auth.branchId, validatedData.branchId ?? null);
        if (scope.kind === "NONE") {
            return ApiHandler.error(
                { message: "Tu usuario no tiene una sucursal asignada", code: "FORBIDDEN" },
                403
            );
        }
        if (scope.kind === "BRANCH") {
            if (validatedData.branchId && validatedData.branchId !== scope.branchId) {
                return ApiHandler.error(
                    { message: "No puedes crear usuarios en otra sucursal", code: "FORBIDDEN" },
                    403
                );
            }
            validatedData.branchId = scope.branchId;
        }

        const newUser = await UserService.createUser(validatedData);
        return ApiHandler.success(
            newUser ? stripPinCode(newUser as unknown as Record<string, unknown>) : newUser,
            201
        );
    } catch (error) {
        return ApiHandler.error(error);
    }
}
