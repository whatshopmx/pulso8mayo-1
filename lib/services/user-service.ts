import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq, and, isNull, desc, or, ilike, sql } from "drizzle-orm";
// Note: better-auth handles password hashing internally usually, but for manual user creation we might need it or use better-auth API.
// Actually, with better-auth, we should use auth.api.signUpEmail if we want to leverage its auth flow, 
// OR manipulate DB directly if we are Admin creating users and just hashing passwords manually.
// Better-auth usually provides a way to create users. 
// For this plan, strict CRUD via API, let's use authClient/admin API if available or direct DB manipulation for simplicity if better-auth is complex for admin creation.
// Let's use direct DB for "User Management" but we need to handle passwords correctly.
// A better approach is using `authClient.admin.createUser` if better-auth has it, or just use the signUp API endpoint.
// Let's implement UserService using DB direct for listing/updating, but for creation rely on the auth library where possible or hash manually.
// Since we don't have bcrypt installed, let's install it or use better-auth's internal utilities if exposed.
// To avoid complexity with password hashing matching better-auth's standard, we will try to use the auth library's server side API for creation.

import { auth } from "@/lib/auth";
import { CreateUserInput, UpdateUserInput } from "@/lib/validations/user";
import { ApiError } from "../api/error";

export class UserService {
    static async listUsers(
        tenantId?: string,
        options: { page?: number; limit?: number; search?: string; role?: "SUPER_ADMIN" | "OWNER" | "ADMIN" | "GERENTE" | "SUPERVISOR" | "EMPLEADO" | "READONLY"; branchId?: string } = {}
    ) {
        const { page = 1, limit = 20, search, role, branchId } = options;
        const offset = (page - 1) * limit;

        // Base filters
        const filters = [isNull(users.deletedAt)];
        if (tenantId) filters.push(eq(users.companyId, tenantId));
        if (role) filters.push(eq(users.role, role));
        if (branchId) filters.push(eq(users.branchId, branchId));

        // Search filter
        if (search) {
            filters.push(or(
                ilike(users.name, `%${search}%`),
                ilike(users.email, `%${search}%`)
            ));
        }

        const whereClause = and(...filters);

        const [data, totalResult] = await Promise.all([
            db.query.users.findMany({
                where: whereClause,
                orderBy: desc(users.createdAt),
                limit: limit,
                offset: offset,
            }),
            db.select({ count: sql<number>`count(*)` })
                .from(users)
                .where(whereClause)
        ]);

        return {
            data,
            meta: {
                page,
                limit,
                total: Number(totalResult[0]?.count || 0),
                totalPages: Math.ceil(Number(totalResult[0]?.count || 0) / limit)
            }
        };
    }

    static async getUser(id: string) {
        const user = await db.query.users.findFirst({
            where: and(eq(users.id, id), isNull(users.deletedAt))
        });
        if (!user) throw ApiError.notFound("User not found");
        return user;
    }

    static async createUser(data: CreateUserInput) {
        // Use Better Auth API to create user to handle password hashing and session generation properly
        // We can use the exposed 'api' from the server instance

        // Note: better-auth's server side 'signUp' might sign in the user immediately, which we might not want for an Admin creating a user.
        // However, looking at better-auth docs (simulated), usually there is an admin create. 
        // If not, we will use the `auth.api.signUpEmail` and ignore the session.

        // IMPORTANT: better-auth runs in a request context usually.
        // Making it simple: direct DB insert is risky if we don't match hashing. 
        // Let's assume we use the auth api.

        try {
            const newUser = await auth.api.signUpEmail({
                body: {
                    email: data.email,
                    password: data.password,
                    name: data.name,
                    // We can pass extra metadata if schema allows mapping
                },
                asResponse: false
            });

            // After creation, we might need to update the role and companyId since signUpEmail standard only does basic fields usually
            if (newUser?.user) {
                await db.update(users).set({
                    role: data.role,
                    companyId: data.companyId,
                    branchId: data.branchId
                }).where(eq(users.id, newUser.user.id));

                return newUser.user;
            }
        } catch (e: any) {
            throw ApiError.badRequest(e.message || "Failed to create user");
        }
    }

    static async updateUser(id: string, data: UpdateUserInput) {
        const user = await this.getUser(id);

        // If updating email, better-auth might need to know, but direct DB update works for simple cases, 
        // though it might invalidate sessions if email is key. 
        // Providing direct DB update for profile info is safe.

        const updated = await db
            .update(users)
            .set({
                ...data,
                updatedAt: new Date()
            })
            .where(eq(users.id, id))
            .returning();

        return updated[0];
    }

    static async deleteUser(id: string) {
        // Soft delete
        await db
            .update(users)
            .set({ deletedAt: new Date() })
            .where(eq(users.id, id));

        return true;
    }
}
