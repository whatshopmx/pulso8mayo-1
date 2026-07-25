import "dotenv/config";
import { db } from "@/lib/db";
import { companies, users, branches, holidays, storageLocations, suppliers, serviceProviders } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { COMPANY_ID } from "./seed-constants";

async function main() {
  const c = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, COMPANY_ID));
  console.log("Company:", c.length > 0 ? "OK" : "MISSING");

  const u = await db.select({ id: users.id }).from(users).where(eq(users.companyId, COMPANY_ID));
  console.log("Users:", u.length);

  const b = await db.select({ id: branches.id }).from(branches).where(eq(branches.companyId, COMPANY_ID));
  console.log("Branches:", b.length);

  const h = await db.select({ id: holidays.id }).from(holidays).where(eq(holidays.companyId, COMPANY_ID));
  console.log("Holidays:", h.length);

  const sl = await db.select({ id: storageLocations.id }).from(storageLocations).where(eq(storageLocations.companyId, COMPANY_ID));
  console.log("Storage Locations:", sl.length);

  const sup = await db.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.companyId, COMPANY_ID));
  console.log("Suppliers:", sup.length);

  const sp = await db.select({ id: serviceProviders.id }).from(serviceProviders).where(eq(serviceProviders.companyId, COMPANY_ID));
  console.log("Service Providers:", sp.length);

  process.exit(0);
}

main().catch(console.error);
