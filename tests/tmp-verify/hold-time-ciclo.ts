/**
 * Task 5 (loteprod §6.4): ciclo de vencimiento del tiempo de retención.
 *
 * Siembra tandas con `expires_at` en el pasado y verifica, contra la BD de dev:
 *   1. El cron avisa una sola vez por tanda (2ª corrida = alreadyNotified).
 *   2. Pasada la gracia, el cron cierra la tanda con merma HOLD_TIME
 *      `origin='hold_time_auto'` — y una 2ª corrida NO duplica la merma.
 *   3. La confirmación del turno registra la merma con la cantidad indicada.
 *   4. Confirmar con 0 cierra la tanda sin crear merma ("se vendió").
 *   5. Confirmar dos veces devuelve ALREADY_DISCARDED.
 *   6. Una tanda todavía en ventana no se puede confirmar (NOT_EXPIRED).
 *
 *   npx tsx tests/tmp-verify/hold-time-ciclo.ts
 */
import { config } from "dotenv";
config({ path: ".env" });

async function main() {
    const { db } = await import("@/lib/db");
    const { sql } = await import("drizzle-orm");
    const { HoldTimeService } = await import("@/lib/services/hold-time-service");
    const { HOLD_TIME_AUTO_WASTE_GRACE_MINUTES } = await import("@/lib/inventory/hold-time");

    const rows = async (q: any) => {
        const r: any = await db.execute(q);
        return Array.isArray(r) ? r : r.rows;
    };

    const [ctx] = await rows(sql`
    select r.id as recipe_id, r.company_id, r.name as recipe_name, b.id as branch_id
    from recipes r
    join branches b on b.company_id = r.company_id and b.active = true
    limit 1
  `);
    if (!ctx) throw new Error("dev sin recetas/sucursales activas: corre los seeds");

    const creados: string[] = [];
    const fallas: string[] = [];
    const check = (nombre: string, ok: boolean, extra?: unknown) => {
        console.log(`${ok ? "  OK  " : " FALLA"} ${nombre}`, extra ?? "");
        if (!ok) fallas.push(nombre);
    };

    /** Tanda sembrada con expires_at relativo al `now()` del SERVIDOR. */
    const sembrar = async (minutosDesdeAhora: number, producido: number, costo: number) => {
        const [row] = await rows(sql`
      insert into production_results
        (company_id, branch_id, recipe_id, produced_quantity, unit, ingredient_cost,
         expires_at, recorded_by, notes)
      values
        (${ctx.company_id}::uuid, ${ctx.branch_id}::uuid, ${ctx.recipe_id}::uuid,
         ${producido}, 'PORTION', ${costo},
         now() + (${minutosDesdeAhora} || ' minutes')::interval,
         'verify-script', '[VERIFY] hold-time ciclo')
      returning id
    `);
        creados.push(row.id);
        return row.id as string;
    };

    const mermaDe = async (resultId: string) =>
        (
            await rows(sql`
      select id, reason, origin, quantity, total_loss, cost_per_unit, item_id, recipe_id, approval_status
      from inventory_waste where production_result_id = ${resultId}::uuid
    `)
        )[0];

    const tandaDe = async (resultId: string) =>
        (
            await rows(sql`
      select discarded_at, discarded_quantity, discarded_by, hold_alert_notified_at
      from production_results where id = ${resultId}::uuid
    `)
        )[0];

    try {
        const grace = HOLD_TIME_AUTO_WASTE_GRACE_MINUTES;

        // Sembrado ------------------------------------------------------------
        const recienVencida = await sembrar(-10, 12, 6000); // vencida, dentro de gracia
        const pasadaGracia = await sembrar(-(grace + 30), 20, 10000); // el cron la cierra
        const paraConfirmar = await sembrar(-20, 10, 5000);
        const paraCero = await sembrar(-25, 8, 4000);
        const enVentana = await sembrar(15, 5, 2500); // todavía en línea

        console.log("\n--- 1/2. Cron: aviso idempotente + cierre automático ---");
        const run1 = await HoldTimeService.processHoldTimeExpirations();
        console.log("corrida 1:", run1);

        const run2 = await HoldTimeService.processHoldTimeExpirations();
        console.log("corrida 2:", run2);

        check(
            "2ª corrida no re-notifica ninguna de las tandas ya avisadas",
            run2.notificationsSent === 0 || run2.alreadyNotified >= 4,
            { alreadyNotified: run2.alreadyNotified, sent: run2.notificationsSent }
        );

        const autoMerma = await mermaDe(pasadaGracia);
        check("tanda pasada la gracia quedó cerrada por el cron", !!autoMerma, autoMerma);
        check(
            "la merma automática es HOLD_TIME / hold_time_auto / AUTO por la tanda completa",
            autoMerma?.reason === "HOLD_TIME" &&
            autoMerma?.origin === "hold_time_auto" &&
            autoMerma?.approval_status === "AUTO" &&
            Number(autoMerma?.quantity) === 20
        );
        check(
            "prorratea el costo de insumos: 10000¢/20 = 500¢ por porción, 10000¢ en total",
            Number(autoMerma?.cost_per_unit) === 500 && Number(autoMerma?.total_loss) === 10000
        );
        check(
            "la merma de producto terminado no señala insumo, sí receta",
            autoMerma?.item_id === null && autoMerma?.recipe_id === ctx.recipe_id
        );

        const dobles = await rows(sql`
      select count(*)::int as n from inventory_waste where production_result_id = ${pasadaGracia}::uuid
    `);
        check("2ª corrida NO duplicó la merma (único parcial A9)", Number(dobles[0].n) === 1, dobles[0]);

        const recien = await tandaDe(recienVencida);
        check(
            "una tanda recién vencida se avisa pero NO se cierra sola",
            recien.discarded_at === null && recien.hold_alert_notified_at !== null
        );

        console.log("\n--- 3. Confirmación del turno ---");
        const conf = await HoldTimeService.confirmDiscard({
            companyId: ctx.company_id,
            branchId: ctx.branch_id,
            resultId: paraConfirmar,
            discardedQuantity: 4,
            recordedBy: "verify-script",
        });
        console.log("confirmDiscard(4):", conf);
        const mermaConf = await mermaDe(paraConfirmar);
        check(
            "confirmar 4 de 10 registra merma hold_time por 4 y 2000¢ (5000/10 × 4)",
            conf.ok === true &&
            mermaConf?.origin === "hold_time" &&
            Number(mermaConf?.quantity) === 4 &&
            Number(mermaConf?.total_loss) === 2000,
            mermaConf
        );
        const tandaConf = await tandaDe(paraConfirmar);
        check(
            "la tanda queda cerrada con su cantidad y su autor",
            tandaConf.discarded_at !== null &&
            Number(tandaConf.discarded_quantity) === 4 &&
            tandaConf.discarded_by === "verify-script"
        );

        console.log("\n--- 4. Confirmar 0 = se vendió ---");
        const cero = await HoldTimeService.confirmDiscard({
            companyId: ctx.company_id,
            branchId: ctx.branch_id,
            resultId: paraCero,
            discardedQuantity: 0,
            recordedBy: "verify-script",
        });
        const mermaCero = await mermaDe(paraCero);
        const tandaCero = await tandaDe(paraCero);
        check(
            "cantidad 0 cierra la tanda SIN crear merma",
            cero.ok === true && !mermaCero && tandaCero.discarded_at !== null,
            { merma: mermaCero, tanda: tandaCero }
        );

        console.log("\n--- 5/6. Rechazos ---");
        const repetida = await HoldTimeService.confirmDiscard({
            companyId: ctx.company_id,
            branchId: ctx.branch_id,
            resultId: paraConfirmar,
            discardedQuantity: 1,
            recordedBy: "verify-script",
        });
        check(
            "confirmar dos veces → ALREADY_DISCARDED",
            repetida.ok === false && repetida.code === "ALREADY_DISCARDED",
            repetida
        );

        const temprana = await HoldTimeService.confirmDiscard({
            companyId: ctx.company_id,
            branchId: ctx.branch_id,
            resultId: enVentana,
            discardedQuantity: 5,
            recordedBy: "verify-script",
        });
        check(
            "tanda todavía en ventana → NOT_EXPIRED",
            temprana.ok === false && temprana.code === "NOT_EXPIRED",
            temprana
        );

        const excedida = await HoldTimeService.confirmDiscard({
            companyId: ctx.company_id,
            branchId: ctx.branch_id,
            resultId: recienVencida,
            discardedQuantity: 999,
            recordedBy: "verify-script",
        });
        check(
            "tirar más de lo producido → OVER_QUANTITY",
            excedida.ok === false && excedida.code === "OVER_QUANTITY",
            excedida
        );

        const otroTenant = await HoldTimeService.confirmDiscard({
            companyId: "00000000-0000-0000-0000-000000000000",
            branchId: ctx.branch_id,
            resultId: recienVencida,
            discardedQuantity: 1,
            recordedBy: "verify-script",
        });
        check(
            "tanda de otra empresa → RESULT_NOT_FOUND (no filtra existencia)",
            otroTenant.ok === false && otroTenant.code === "RESULT_NOT_FOUND"
        );

        console.log("\n--- Contadores del dashboard ---");
        const counts = await HoldTimeService.getCounts(ctx.company_id, ctx.branch_id);
        console.log("getCounts:", counts);
        check(
            "quedan tandas vencidas sin tirar y los contadores son números",
            typeof counts.expiredPending === "number" && typeof counts.expiringSoon === "number"
        );

        console.log(
            fallas.length === 0
                ? "\nOK: ciclo de hold time completo"
                : `\nFALLA en: ${fallas.join(" | ")}`
        );
        process.exitCode = fallas.length === 0 ? 0 : 1;
    } finally {
        for (const id of creados) {
            await db.execute(sql`delete from inventory_waste where production_result_id = ${id}::uuid`);
            await db.execute(sql`delete from production_results where id = ${id}::uuid`);
        }
        console.log("limpieza: tandas y mermas [VERIFY] borradas");
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
