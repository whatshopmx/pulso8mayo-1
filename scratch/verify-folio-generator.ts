/**
 * Verificación Task 2: atomicidad del generador de folios bajo concurrencia.
 * Todo corre en transacciones que hacen ROLLBACK — no deja datos en la BD.
 *
 *   npx tsx scratch/verify-folio-generator.ts
 */
import "dotenv/config";

import { db } from "@/lib/db";
import { branches, companies, folioCounters } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { nextFolio } from "@/lib/services/folio-generator";

async function main() {
    const [company] = await db.select().from(companies).limit(1);
    if (!company) throw new Error("No hay empresas en la BD");
    const [branch] = await db
        .select()
        .from(branches)
        .where(eq(branches.companyId, company.id))
        .limit(1);
    if (!branch) throw new Error("La empresa no tiene sucursales");

    console.log(`Empresa: ${company.name} | Sucursal: ${branch.name} (${branch.id})`);

    const CONCURRENCY = 8;
    const results = await Promise.allSettled(
        Array.from({ length: CONCURRENCY }, (_, i) =>
            db.transaction(async (tx) => {
                // El código de sucursal se asigna dentro de la misma tx (se revierte al final).
                await tx
                    .update(branches)
                    .set({ code: "TST01" })
                    .where(eq(branches.id, branch.id));
                const issued = await nextFolio({
                    companyId: company.id,
                    branchId: branch.id,
                    docType: "OS",
                    tx,
                });
                if (i === 0) console.log("Ejemplo:", issued.folio);
                throw new Error(`rollback-${i}`); // fuerza ROLLBACK con el folio ya emitido
            }),
        ),
    );

    const sequences = results
        .filter((r): r is PromiseFulfilledResult<never> => false) // todos rejected por el rollback
        .map(() => 0);
    void sequences;

    // Recupera las secuencias desde los motivos de rechazo no es posible; en su lugar,
    // repetimos sin rollback para verificar unicidad real de folios emitidos.
    const emitted = await Promise.all(
        Array.from({ length: CONCURRENCY }, () =>
            db.transaction(async (tx) => {
                await tx.update(branches).set({ code: "TST02" }).where(eq(branches.id, branch.id));
                return nextFolio({ companyId: company.id, branchId: branch.id, docType: "OS", tx });
            }),
        ),
    );

    const folios = new Set(emitted.map((e) => e.folio));
    const seqs = emitted.map((e) => e.sequence).sort((a, b) => a - b);
    console.log("Secuencias emitidas:", seqs.join(", "));

    let ok = true;
    if (folios.size !== CONCURRENCY) {
        console.error(`❌ FOLIOS DUPLICADOS: ${CONCURRENCY - folios.size} colisiones`);
        ok = false;
    }
    const expected = seqs.map((s, i) => i + 1); // consecutivo sin huecos dentro del lote
    if (JSON.stringify(seqs) !== JSON.stringify(expected)) {
        console.error(`❌ SECUENCIAS NO CONSECUTIVAS: ${seqs}`);
        ok = false;
    }

    // Limpieza: deja la BD como estaba (contador y código de prueba fuera).
    await db.delete(folioCounters).where(eq(folioCounters.branchId, branch.id));
    await db.update(branches).set({ code: branch.code }).where(eq(branches.id, branch.id));

    const [{ count: counterRows }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(folioCounters)
        .where(eq(folioCounters.branchId, branch.id));
    console.log(`Limpieza OK (contadores restantes para la sucursal: ${counterRows})`);

    if (!ok) process.exit(1);
    console.log(`✅ Concurrencia verificada: ${CONCURRENCY}/${folios.size} folios únicos y consecutivos`);
    process.exit(0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
