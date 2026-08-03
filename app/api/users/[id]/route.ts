import { NextRequest } from "next/server";
import { UserService } from "@/lib/services/user-service";
import { ApiHandler } from "@/lib/api/response";
import { updateUserSchema } from "@/lib/validations/user";
import { withTenantAuth } from "@/lib/api/with-auth";

export const GET = withTenantAuth(async (req: NextRequest, { params, auth }) => {
    try {
        const { id } = await (params as unknown as Promise<{ id: string }>);
        const user = await UserService.getUser(id);
        // Ensure the user belongs to the authenticated tenant
        if ((user as any).companyId !== auth.tenantId) {
            return ApiHandler.error(new Error("Not found"), 404);
        }
        return ApiHandler.success(user);
    } catch (error) {
        return ApiHandler.error(error);
    }
});

export const PATCH = withTenantAuth(async (req: NextRequest, { params, auth }) => {
    try {
        const { id } = await (params as unknown as Promise<{ id: string }>);
        const body = await req.json();
        const data = updateUserSchema.parse(body);
        // Prevent privilege escalation — strip any role/companyId from body
        delete (data as any).role;
        delete (data as any).companyId;
        const updatedUser = await UserService.updateUser(id, data);
        return ApiHandler.success(updatedUser);
    } catch (error) {
        return ApiHandler.error(error);
    }
});

export const DELETE = withTenantAuth(async (req: NextRequest, { params, auth }) => {
    try {
        const { id } = await (params as unknown as Promise<{ id: string }>);
        await UserService.deleteUser(id);
        return ApiHandler.success({ message: "User deleted successfully" });
    } catch (error) {
        return ApiHandler.error(error);
    }
});
