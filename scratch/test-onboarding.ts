import 'dotenv/config';
import { db } from "../lib/db";
import { CompanyService } from "../lib/services/company-service";
import { BranchService } from "../lib/services/branch-service";
import { users } from "../lib/db/schema";
import { eq } from "drizzle-orm";

async function test() {
    const testUserId = "2eb2b310-856c-45af-b7d5-c1bb920bd3d4"; // david escamilla
    console.log("Starting test onboarding for user:", testUserId);
    
    try {
        // 1. Create Company and assign user as Owner/Admin
        const company = await CompanyService.createCompany({
            name: "Test Company LLC",
            plan: "FREE"
        }, testUserId);

        console.log("Company Created:", company.id);

        // 2. Create Initial Branch linked to that Company
        const branch = await BranchService.createBranch({
            name: "Test Branch",
            companyId: company.id,
            address: "123 Test St",
            timezone: "America/Mexico_City"
        });

        console.log("Branch Created:", branch.id);

        // 3. Update user with companyId and branchId directly in DB
        await db.update(users).set({
            companyId: company.id,
            branchId: branch.id,
            role: 'ADMIN',
            updatedAt: new Date()
        }).where(eq(users.id, testUserId));

        console.log("User updated successfully!");
    } catch (e) {
        console.error("ONBOARDING FAILURE DETECTED:", e);
    }
}

test();
