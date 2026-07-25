import "dotenv/config";
import { db } from "@/lib/db";
import { companies, users, branches, holidays, storageLocations, suppliers, serviceProviders } from "@/lib/db/schema";
import { employeeProfiles } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { COMPANY_ID, USER_SUPER_ADMIN, USER_ADMIN, USER_GERENTE, USER_SUPERVISOR, USER_EMPLEADO_1, USER_EMPLEADO_2, USER_EMPLEADO_3 } from "./seed-constants";

async function main() {
  const allUserIds = [USER_SUPER_ADMIN, USER_ADMIN, USER_GERENTE, USER_SUPERVISOR, USER_EMPLEADO_1, USER_EMPLEADO_2, USER_EMPLEADO_3];

  console.log("Foundation:");
  console.log("  Company:", (await db.select({ id: companies.id }).from(companies).where(eq(companies.id, COMPANY_ID))).length);
  console.log("  Users:", (await db.select({ id: users.id }).from(users).where(eq(users.companyId, COMPANY_ID))).length);
  console.log("  Branches:", (await db.select({ id: branches.id }).from(branches).where(eq(branches.companyId, COMPANY_ID))).length);
  console.log("  Holidays:", (await db.select({ id: holidays.id }).from(holidays).where(eq(holidays.companyId, COMPANY_ID))).length);
  console.log("  Storage:", (await db.select({ id: storageLocations.id }).from(storageLocations).where(eq(storageLocations.companyId, COMPANY_ID))).length);
  console.log("  Suppliers:", (await db.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.companyId, COMPANY_ID))).length);
  console.log("  ServiceProviders:", (await db.select({ id: serviceProviders.id }).from(serviceProviders).where(eq(serviceProviders.companyId, COMPANY_ID))).length);

  const firstUser = USER_SUPER_ADMIN;
  console.log("\nHR Profiles:");
  console.log("  Profiles:", (await db.select({ id: employeeProfiles.id }).from(employeeProfiles).where(eq(employeeProfiles.userId, firstUser))).length > 0 ? "OK" : "MISSING");
  let profCount = 0; 
  for (const uid of allUserIds) {
    profCount += (await db.select({ id: employeeProfiles.id }).from(employeeProfiles).where(eq(employeeProfiles.userId, uid))).length;
  }
  console.log("  Profiles count:", profCount);

  process.exit(0);
}
main().catch(console.error);
