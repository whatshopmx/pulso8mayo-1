import { db } from "@/lib/db";
import { companies, branches, users, tenantOperatingConfig } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { CreateCompanyInput, UpdateCompanyInput } from "@/lib/validations/company";
import { ApiError } from "@/lib/api/error";

export class CompanyService {
    static async createCompany(data: CreateCompanyInput, ownerUserId?: string) {
        // 1. Create Company
        const newCompany = await db.insert(companies).values({
            name: data.name,
            taxId: data.taxId,
            plan: data.plan
        }).returning();

        const company = newCompany[0];

        // 2. Create the operating-model config with Case-A defaults (T41).
        //    The 7 dimensions can be reconfigured later from settings;
        //    getTenantOperatingConfig() also lazily falls back to these
        //    defaults for companies created before this hook existed.
        await db.insert(tenantOperatingConfig).values({
            companyId: company.id,
        }).onConflictDoNothing();

        // 3. If an owner is provided, assign them to this company and set as ADMIN/SUPER_ADMIN
        if (ownerUserId) {
            await db.update(users).set({
                companyId: company.id,
                role: 'ADMIN'
            }).where(eq(users.id, ownerUserId));
        }

        return company;
    }

    static async getCompany(id: string) {
        const company = await db.query.companies.findFirst({
            where: eq(companies.id, id)
        });
        if (!company) throw ApiError.notFound("Company not found");
        return company;
    }

    static async updateCompany(id: string, data: UpdateCompanyInput) {
        const updated = await db.update(companies).set({
            ...data,
            updatedAt: new Date()
        }).where(eq(companies.id, id)).returning();

        return updated[0];
    }
}
