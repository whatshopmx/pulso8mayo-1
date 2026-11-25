import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import { beforeAll, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { bankTransactions, branches, companies, companyBankAccounts, users } from "@/lib/db/schema";
import { setTenantContext } from "@/lib/db/tenant-context";
import { provisionRuntimeRole } from "./helpers/runtime-role";
import {
  createCompanyBankAccount,
  listCompanyBankAccounts,
} from "@/lib/services/company-bank-account-service";
import { importBankStatement } from "@/lib/services/bank-statement-service";
import { DekService } from "@/lib/security/dek";

beforeAll(async () => {
  await provisionRuntimeRole([
    "companies",
    "branches",
    "users",
    "company_bank_accounts",
    "bank_transactions",
  ]);
});

function loadMigration0167(): string[] {
  return readFileSync("drizzle/0167_sec05_tesoreria_rls.sql", "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Muestra sintética estructurada con encabezados de estado de cuenta bancario MX
 * (BBVA/Santander) con 3 movimientos válidos y 2 líneas defectuosas verificables.
 */
const SAMPLE_MX_BANK_CSV = [
  "Fecha,Descripcion,Monto,Referencia",
  "01/06/2026,SPEI ENVIADO PROVEEDOR HARINA SA,-12500.50,REF-SPEI-001",
  "02/06/2026,ABONO LIQUIDACION TERMINAL CLIP,8450.00,DEP-CLIP-002",
  "03/06/2026,COMISION MANEJO DE CUENTA,(350.00),COM-003",
  "31/02/2026,FECHA INVALIDA,-100.00,BAD-DATE",
  "04/06/2026,MONTO INVALIDO,NO_ES_MONTO,BAD-AMT",
].join("\n");

it("BAN-01 V2: cuentas cifradas, aislamiento de cuenta origen, reimportación idempotente y errores por línea visibles bajo pulso_app", async () => {
  const host = (url: string) => new URL(url).hostname.replace(/-pooler(?=\.)/, "");
  expect(host(process.env.TEST_DATABASE_URL!)).not.toBe(
    host(parse(readFileSync(".env")).DATABASE_URL)
  );

  const companyA = randomUUID();
  const companyB = randomUUID();
  const branchA = randomUUID();
  const branchB = randomUUID();
  const userA = `u-ban01-a-${randomUUID()}`;
  const userB = `u-ban01-b-${randomUUID()}`;

  const rollback = new Error("BAN-01 rollback");
  const stmts = loadMigration0167();

  // Asegurar DEK fuera de la transacción de prueba usando buffer determinista en test
  const prevMasterKey = process.env.ENCRYPTION_MASTER_KEY;
  if (!prevMasterKey) {
    process.env.ENCRYPTION_MASTER_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  }

  // Interceptar DEK en memoria para que el rollback transaccional no deje claves huérfanas
  const origEnsure = DekService.ensureDek.bind(DekService);
  const origGet = DekService.getDek.bind(DekService);
  const fakeDek = Buffer.alloc(32, 7);
  DekService.ensureDek = async () => undefined;
  DekService.getDek = async () => fakeDek;

  try {
    await db.transaction(async (tx) => {
      for (const stmt of stmts) {
        await tx.execute(sql.raw(stmt));
      }

      await tx.insert(companies).values([
        { id: companyA, name: "Ban01 Co A" },
        { id: companyB, name: "Ban01 Co B" },
      ]);
      await tx.insert(branches).values([
        { id: branchA, companyId: companyA, name: "Branch A" },
        { id: branchB, companyId: companyB, name: "Branch B" },
      ]);
      await tx.insert(users).values([
        { id: userA, name: "Admin A", email: `${userA}@ban01.test`, createdAt: new Date(), updatedAt: new Date(), companyId: companyA },
        { id: userB, name: "Admin B", email: `${userB}@ban01.test`, createdAt: new Date(), updatedAt: new Date(), companyId: companyB },
      ]);

      // Bajar a rol runtime NOBYPASSRLS
      await tx.execute(sql.raw("SET LOCAL ROLE pulso_app"));
      const role = (
        await tx.execute(sql`SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user`)
      ).rows[0];
      expect(role).toMatchObject({ rolbypassrls: false, rolsuper: false });

      // 1. Empresa A crea su cuenta bancaria -> cifrada en reposo y segura en lectura
      await setTenantContext(tx, { companyId: companyA, branchId: branchA });
      const plainAccountNumber = "019876543210";
      const createdA = await createCompanyBankAccount(
        {
          companyId: companyA,
          label: "BBVA Operativa A",
          accountNumber: plainAccountNumber,
          bankCode: "012",
          registeredBy: userA,
        },
        tx
      );
      expect(createdA.accountLastFour).toBe("3210");
      expect((createdA as unknown as Record<string, unknown>).accountNumber).toBeUndefined();

      // En base de datos el número está cifrado, jamás en texto plano
      const [rawRow] = await tx
        .select({ accountNumber: companyBankAccounts.accountNumber })
        .from(companyBankAccounts)
        .where(eq(companyBankAccounts.id, createdA.id));
      expect(rawRow.accountNumber).not.toContain(plainAccountNumber);

      const listedA = await listCompanyBankAccounts(companyA, {}, tx);
      expect(listedA).toHaveLength(1);
      expect(listedA[0].accountLastFour).toBe("3210");

      // 2. Primera importación CSV en Empresa A -> 3 importados, 0 duplicados, 2 errores visibles por línea
      const firstImport = await importBankStatement(
        {
          companyId: companyA,
          csvText: SAMPLE_MX_BANK_CSV,
          sourceBankAccountId: createdA.id,
          importedBy: userA,
        },
        tx
      );
      expect(firstImport.importedCount).toBe(3);
      expect(firstImport.duplicateCount).toBe(0);
      expect(firstImport.errorCount).toBe(2);
      expect(firstImport.errors).toEqual([
        expect.objectContaining({ line: 5, message: "Fecha ilegible" }),
        expect.objectContaining({ line: 6, message: "Monto ilegible" }),
      ]);

      // 3. Reimportación idempotente -> 0 nuevos, 3 duplicados, mismos 2 errores visibles
      const secondImport = await importBankStatement(
        {
          companyId: companyA,
          csvText: SAMPLE_MX_BANK_CSV,
          sourceBankAccountId: createdA.id,
          importedBy: userA,
        },
        tx
      );
      expect(secondImport.importedCount).toBe(0);
      expect(secondImport.duplicateCount).toBe(3);
      expect(secondImport.errorCount).toBe(2);
      expect((await tx.select().from(bankTransactions)).length).toBe(3);

      // 4. Empresa B no puede importar usando la cuenta bancaria de Empresa A (400)
      await setTenantContext(tx, { companyId: companyB, branchId: branchB });
      await expect(
        importBankStatement(
          {
            companyId: companyB,
            csvText: SAMPLE_MX_BANK_CSV,
            sourceBankAccountId: createdA.id,
            importedBy: userB,
          },
          tx
        )
      ).rejects.toMatchObject({ statusCode: 400 });

      // Empresa B importando sin cuenta origen no colisiona con Empresa A (fingerprint acotado por empresa)
      const importB = await importBankStatement(
        {
          companyId: companyB,
          csvText: SAMPLE_MX_BANK_CSV,
          sourceBankAccountId: null,
          importedBy: userB,
        },
        tx
      );
      expect(importB.importedCount).toBe(3);
      expect(importB.duplicateCount).toBe(0);

      throw rollback;
    });
  } catch (err) {
    if (err !== rollback) throw err;
  } finally {
    DekService.ensureDek = origEnsure;
    DekService.getDek = origGet;
    if (prevMasterKey === undefined) delete process.env.ENCRYPTION_MASTER_KEY;
    else process.env.ENCRYPTION_MASTER_KEY = prevMasterKey;
  }

  for (const id of [companyA, companyB]) {
    expect(await db.select({ id: companies.id }).from(companies).where(eq(companies.id, id))).toEqual([]);
  }
});
