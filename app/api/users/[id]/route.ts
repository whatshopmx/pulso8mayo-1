import { NextRequest } from "next/server";
import { UserService } from "@/lib/services/user-service";
import { ApiHandler } from "@/lib/api/response";
import { updateUserSchema } from "@/lib/validations/user";
import { withTenantAuth } from "@/lib/api/with-auth";
import { hasPermission, ROLES_HIERARCHY, type Role } from "@/lib/permissions";
import { resolveBranchScope } from "@/lib/branch-scope";

const USER_READ_ROLES: ReadonlySet<Role> = new Set([
    "SUPER_ADMIN",
    "OWNER",
    "ADMIN",
    "GERENTE",
    "SUPERVISOR",
    "READONLY",
]);

function canActOnRole(actorRole: Role, targetRole: Role): boolean {
    if (actorRole === "SUPER_ADMIN") return true;
    return ROLES_HIERARCHY[actorRole] > ROLES_HIERARCHY[targetRole];
}

function stripPinCode<T extends Record<string, unknown>>(row: T): Omit<T, "pinCode"> {
    const { pinCode: _pinCode, ...safe } = row;
    return safe;
}

export const GET = withTenantAuth(async (req: NextRequest, { params, auth }) => {
    try {
        const { id } = await (params as unknown as Promise<{ id: string }>);
        const actorRole = auth.user.role as Role;
        const isSelf = auth.user.id === id;

        if (!isSelf && !USER_READ_ROLES.has(actorRole)) {
            return ApiHandler.error(
                { message: "No tienes permisos para ver otros usuarios", code: "FORBIDDEN" },
                403
            );
        }

        const user = await UserService.getUser(id);
        // Ensure the user belongs to the authenticated tenant
        if ((user as Record<string, unknown>).companyId !== auth.tenantId) {
            return ApiHandler.error(new Error("Not found"), 404);
        }

        if (!isSelf) {
            const scope = resolveBranchScope(actorRole, auth.branchId, null);
            if (
                scope.kind === "NONE" ||
                (scope.kind === "BRANCH" && (user as Record<string, unknown>).branchId !== scope.branchId)
            ) {
                return ApiHandler.error(
                    { message: "No tienes permisos para ver usuarios de otra sucursal", code: "FORBIDDEN" },
                    403
                );
            }
        }

        return ApiHandler.success(stripPinCode(user as unknown as Record<string, unknown>));
    } catch (error) {
        return ApiHandler.error(error);
    }
});

export const PATCH = withTenantAuth(async (req: NextRequest, { params, auth }) => {
    try {
        const { id } = await (params as unknown as Promise<{ id: string }>);
        const actorRole = auth.user.role as Role;

        if (!hasPermission(actorRole, "users", "update")) {
            return ApiHandler.error(
                { message: "No tienes permisos para editar usuarios", code: "FORBIDDEN" },
                403
            );
        }

        const targetUser = await UserService.getUser(id);
        if ((targetUser as Record<string, unknown>).companyId !== auth.tenantId) {
            return ApiHandler.error(new Error("Not found"), 404);
        }

        const scope = resolveBranchScope(actorRole, auth.branchId, null);
        if (
            scope.kind === "NONE" ||
            (scope.kind === "BRANCH" && (targetUser as Record<string, unknown>).branchId !== scope.branchId)
        ) {
            return ApiHandler.error(
                { message: "No puedes editar usuarios de otra sucursal", code: "FORBIDDEN" },
                403
            );
        }

        const targetRole = (targetUser as Record<string, unknown>).role as Role | undefined;
        if (targetRole && !canActOnRole(actorRole, targetRole)) {
            return ApiHandler.error(
                { message: "No puedes editar un usuario con rol igual o superior al tuyo", code: "FORBIDDEN" },
                403
            );
        }

        const body = await req.json();
        const data = updateUserSchema.parse(body);
        delete (data as Record<string, unknown>).companyId;

        if (data.role !== undefined && !canActOnRole(actorRole, data.role)) {
            return ApiHandler.error(
                { message: "No puedes asignar un rol igual o superior al tuyo", code: "FORBIDDEN" },
                403
            );
        }

        if (scope.kind === "BRANCH" && data.branchId !== undefined && data.branchId !== scope.branchId) {
            return ApiHandler.error(
                { message: "No puedes transferir usuarios a otra sucursal", code: "FORBIDDEN" },
                403
            );
        }

        const updatedUser = await UserService.updateUser(id, data);
        return ApiHandler.success(
            updatedUser ? stripPinCode(updatedUser as unknown as Record<string, unknown>) : updatedUser
        );
    } catch (error) {
        return ApiHandler.error(error);
    }
});

export const DELETE = withTenantAuth(async (req: NextRequest, { params, auth }) => {
    try {
        const { id } = await (params as unknown as Promise<{ id: string }>);
        const actorRole = auth.user.role as Role;

        if (!hasPermission(actorRole, "users", "delete")) {
            return ApiHandler.error(
                { message: "No tienes permisos para eliminar usuarios", code: "FORBIDDEN" },
                403
            );
        }

        if (auth.user.id === id) {
            return ApiHandler.error(
                { message: "No puedes eliminar tu propio usuario", code: "BAD_REQUEST" },
                400
            );
        }

        const targetUser = await UserService.getUser(id);
        if ((targetUser as Record<string, unknown>).companyId !== auth.tenantId) {
            return ApiHandler.error(new Error("Not found"), 404);
        }

        const targetRole = (targetUser as Record<string, unknown>).role as Role | undefined;
        if (targetRole && !canActOnRole(actorRole, targetRole)) {
            return ApiHandler.error(
                { message: "No puedes eliminar un usuario con rol igual o superior al tuyo", code: "FORBIDDEN" },
                403
            );
        }

        await UserService.deleteUser(id);
        return ApiHandler.success({ message: "User deleted successfully" });
    } catch (error) {
        return ApiHandler.error(error);
    }
});
