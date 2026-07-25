import "dotenv/config";
import { db } from "@/lib/db";
import { account } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import {
  COMPANY_ID,
  USER_SUPER_ADMIN, USER_ADMIN, USER_GERENTE, USER_SUPERVISOR,
  USER_EMPLEADO_1, USER_EMPLEADO_2, USER_EMPLEADO_3, USER_READONLY,
} from "./seed-constants";

const PASSWORD = "123456";

const CREDENTIALS = [
  { id: USER_SUPER_ADMIN, email: "carlos@pulso.mx", name: "Carlos Méndez" },
  { id: USER_ADMIN,       email: "maria@pulso.mx",   name: "María García" },
  { id: USER_GERENTE,     email: "juan@pulso.mx",    name: "Juan López" },
  { id: USER_SUPERVISOR,  email: "ana@pulso.mx",     name: "Ana Martínez" },
  { id: USER_EMPLEADO_1,  email: "pedro@pulso.mx",   name: "Pedro Sánchez" },
  { id: USER_EMPLEADO_2,  email: "luisa@pulso.mx",   name: "Luisa Fernández" },
  { id: USER_EMPLEADO_3,  email: "roberto@pulso.mx", name: "Roberto Gutiérrez" },
  { id: USER_READONLY,    email: "diana@pulso.mx",   name: "Diana Torres" },
];

export async function main() {
  console.log("=== Seeding Passwords ===");
  console.log(`Password for all users: ${PASSWORD}`);

  console.log("Cleaning up existing credential accounts...");
  for (const cred of CREDENTIALS) {
    await db.delete(account).where(eq(account.userId, cred.id));
  }

  console.log("Hashing password and creating account records...");
  const hashedPassword = await hashPassword(PASSWORD);

  const now = new Date();
  for (const cred of CREDENTIALS) {
    await db.insert(account).values({
      id: `cred-${cred.id}`,
      accountId: cred.email,
      providerId: "credential",
      userId: cred.id,
      password: hashedPassword,
      createdAt: now,
      updatedAt: now,
    });
    console.log(`  ✓ ${cred.email} (${cred.name})`);
  }

  console.log("Done! All users can login with password:", PASSWORD);
}
