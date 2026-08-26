/**
 * Task 6a (loteprod §6.2): Hoja de Producción Diaria — datos y servicio.
 *
 * Siembra líneas de dos estaciones sobre una receta con insumos y lotes reales
 * de dev, y verifica:
 *   1. La hoja agrupa por estación y respeta acentos/mayúsculas como una sola.
 *   2. El estatus sale de la hora límite (atrasada / por vencer / pendiente).
 *   3. Cada línea muestra el lote FEFO que consumirá, el más próximo a vencer.
 *   4. Dos líneas del mismo insumo NO anuncian las dos el mismo lote.
 *   5. Completar una línea descuenta el lote correcto vía allocateFEFO,
 *      registra la producción y firma la orden.
 *   6. Los rechazos: ALREADY_COMPLETED, ORDER_CANCELLED, ORDER_NOT_FOUND
 *      cross-tenant, INVALID_QUANTITY.
 *
 *   npx tsx tests/tmp-verify/prep-list-6a.ts
 */
import { config } from "dotenv";
config({ path: ".env" });

async function main() {
    const { db } = await import("@/lib/db");
    const { sql } = await import("drizzle-orm");
    const { PrepListService, PrepListError } = await import("@/lib/services/prep-list-service");

    const rows = async (q: any) => {
        const r: any = await db.execute(q);
        return Array.isArray(r) ? r : r.rows;
    };

    // Receta con al menos un insumo hoja y lotes disponibles en la sucursal.
    const [ctx] = await rows(sql`
    select r.id as recipe_id, r.company_id, r.name as recipe_name, r.unit,
           b.id as branch_id, b.timezone,
           ri.item_id, ri.quantity as receta_qty
    from recipes r
    join recipe_items ri on ri.recipe_id = r.id and ri.is_sub_recipe = false
    join branches b on b.company_id = r.company_id and b.active = true
    join inventory_batches ib on ib.item_id = ri.item_id and ib.branch_id = b.id
         and ib.status = 'AVAILABLE' and ib.current_quantity > 0
    limit 1
  `);
    if (!ctx) throw new Error("dev sin receta con insumo y lote disponible: corre los seeds");

    const fallas: string[] = [];
    const ordenes: string[] = [];
    const check = (nombre: string, ok: boolean, extra?: unknown) => {
        console.log(`${ok ? "  OK  " : " FALLA"} ${nombre}`, extra ?? "");
        if (!ok) fallas.push(nombre);
    };

    // Fecha local de la sucursal: la hoja se pide por fecha de calendario.
    const { localDateString, localMoment } = await import("@/lib/workflows/today");
    const hoy = localDateString(new Date(), ctx.timezone);
    const ahoraMin = localMoment(new Date(), ctx.timezone).minutesOfDay;
    const hhmm = (min: number) => {
        const m = ((min % 1440) + 1440) % 1440;
        return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    };

    const sembrar = async (opts: {
        station: string | null;
        deadlineTime: string | null;
        cantidad: number;
        shift?: string | null;
        status?: string;
    }) => {
        const order = await PrepListService.createLine({
            companyId: ctx.company_id,
            branchId: ctx.branch_id,
            recipeId: ctx.recipe_id,
            plannedQuantity: opts.cantidad,
            unit: ctx.unit || "PORTION",
            plannedDate: new Date(`${hoy}T00:00:00.000Z`),
            station: opts.station,
            shift: opts.shift ?? "MATUTINO",
            responsibleUserId: null,
            deadlineTime: opts.deadlineTime,
            notes: "[VERIFY] prep list 6a",
            createdBy: "verify-script",
        });
        ordenes.push(order.id);
        if (opts.status) {
            await db.execute(sql`update production_orders set status = ${opts.status}::production_order_status where id = ${order.id}::uuid`);
        }
        return order.id as string;
    };

    const stockDe = async (batchId: string) =>
        Number((await rows(sql`select current_quantity from inventory_batches where id = ${batchId}::uuid`))[0].current_quantity);

    // Foto del stock de la sucursal ANTES de tocar nada: completar una línea
    // descuenta lotes de verdad y esta BD la comparten las specs e2e.
    const stockAntes: { id: string; current_quantity: string }[] = await rows(sql`
    select id, current_quantity from inventory_batches where branch_id = ${ctx.branch_id}::uuid
  `);

    try {
        console.log(`\ncontexto: receta=${ctx.recipe_name} sucursal=${ctx.branch_id} fecha=${hoy} (${ctx.timezone}, ${hhmm(ahoraMin)})`);

        // Sembrado -------------------------------------------------------------
        // Atrasada: 90 min antes de ahora. Por vencer: dentro de la ventana de
        // aviso (30 min). Pendiente: 4 h por delante. Se acotan a la ventana del
        // día para no cruzar la medianoche en una corrida de madrugada.
        const minAtrasada = Math.max(1, ahoraMin - 90);
        const minPorVencer = Math.min(1439, ahoraMin + 10);
        const minPendiente = Math.min(1439, ahoraMin + 240);

        const atrasada = await sembrar({ station: "Cocina Fría", deadlineTime: hhmm(minAtrasada), cantidad: 1 });
        const porVencer = await sembrar({ station: "cocina fria", deadlineTime: hhmm(minPorVencer), cantidad: 1 });
        const pendiente = await sembrar({ station: "Parrilla", deadlineTime: hhmm(minPendiente), cantidad: 1 });
        const sinHora = await sembrar({ station: null, deadlineTime: null, cantidad: 1 });
        const cancelada = await sembrar({ station: "Parrilla", deadlineTime: hhmm(minAtrasada), cantidad: 1, status: "CANCELLED" });

        console.log("\n--- 1/2. Agrupado por estación y estatus por hora límite ---");
        const hoja = await PrepListService.getPrepList({
            companyId: ctx.company_id,
            branchId: ctx.branch_id,
            date: hoy,
        });

        const grupos = new Map(hoja.groups.map(g => [g.label, g]));
        const lineaPorId = new Map(hoja.groups.flatMap(g => g.lines).map(l => [l.id, l]));

        check(
            "'Cocina Fría' y 'cocina fria' caen en UN solo grupo con la primera etiqueta",
            !!grupos.get("Cocina Fría") && grupos.get("Cocina Fría")!.lines.length >= 2 && !grupos.has("cocina fria"),
            [...grupos.keys()]
        );
        check(
            "la línea sin estación cae en 'Sin estación', y ese grupo va al final",
            hoja.groups[hoja.groups.length - 1].label === "Sin estación",
            hoja.groups.map(g => g.label)
        );
        check("línea con hora pasada = ATRASADA", lineaPorId.get(atrasada)?.state === "ATRASADA", lineaPorId.get(atrasada)?.deadlineTime);
        check("línea dentro de la ventana de aviso = POR_VENCER", lineaPorId.get(porVencer)?.state === "POR_VENCER", lineaPorId.get(porVencer)?.deadlineTime);
        check("línea lejana = PENDIENTE", lineaPorId.get(pendiente)?.state === "PENDIENTE", lineaPorId.get(pendiente)?.deadlineTime);
        check("línea sin hora límite nunca se marca atrasada", lineaPorId.get(sinHora)?.state === "PENDIENTE");
        check("línea cancelada = CANCELADA y no cuenta en el total", lineaPorId.get(cancelada)?.state === "CANCELADA");
        check(
            "el grupo Parrilla cuenta 1 contable (la cancelada no suma)",
            grupos.get("Parrilla")?.total === 1,
            { total: grupos.get("Parrilla")?.total, lineas: grupos.get("Parrilla")?.lines.length }
        );
        check(
            "dentro de la estación lo atrasado va primero",
            grupos.get("Cocina Fría")?.lines[0].id === atrasada
        );

        console.log("\n--- 3/4. Vista previa FEFO ---");
        const fefoAtrasada = lineaPorId.get(atrasada)?.fefo ?? [];
        check("cada línea abierta trae su lote FEFO", fefoAtrasada.length > 0, fefoAtrasada.map(f => ({ item: f.itemName, lote: f.lotNumber, qty: f.allocatedQuantity, falta: f.shortfall })));

        const [primerLote] = await rows(sql`
      select id, lot_number, current_quantity from inventory_batches
      where item_id = ${ctx.item_id}::uuid and branch_id = ${ctx.branch_id}::uuid
        and status = 'AVAILABLE' and current_quantity > 0
      order by expiration_date nulls last, created_at
      limit 1
    `);
        const previstoItem = fefoAtrasada.find(f => f.itemId === ctx.item_id);
        check(
            "el lote previsto es el más próximo a vencer (mismo orden que allocateFEFO)",
            previstoItem?.batchId === primerLote.id,
            { previsto: previstoItem?.lotNumber, esperado: primerLote.lot_number }
        );

        const consumoPrevisto = new Map<string, number>();
        for (const linea of hoja.groups.flatMap(g => g.lines)) {
            for (const f of linea.fefo) {
                if (!f.batchId) continue;
                consumoPrevisto.set(f.batchId, (consumoPrevisto.get(f.batchId) ?? 0) + f.allocatedQuantity);
            }
        }
        const sobreasignados: string[] = [];
        for (const [batchId, previsto] of consumoPrevisto) {
            const disponible = await stockDe(batchId);
            if (previsto > disponible + 1e-6) sobreasignados.push(`${batchId}: ${previsto} > ${disponible}`);
        }
        check(
            "la previsión reparte el stock: ningún lote se promete dos veces",
            sobreasignados.length === 0,
            sobreasignados
        );

        console.log("\n--- 5. Completar una línea dispara la producción real ---");
        const antes = await stockDe(primerLote.id);
        const resultado = await PrepListService.completeLine({
            companyId: ctx.company_id,
            branchId: ctx.branch_id,
            orderId: pendiente,
            userId: "verify-script",
        });
        const despues = await stockDe(primerLote.id);
        console.log("completeLine:", resultado, { antes, despues });

        check("completar devuelve la producción registrada", !!resultado.resultId && resultado.producedQuantity === 1);
        check(
            "descontó del lote FEFO (o lo reportó como faltante si el lote no alcanzaba)",
            despues < antes || resultado.shortfalls.length > 0,
            { antes, despues, faltantes: resultado.shortfalls }
        );

        const [orden] = await rows(sql`
      select status, completed_at, completed_by from production_orders where id = ${pendiente}::uuid
    `);
        check(
            "la orden queda COMPLETED, con hora y firma de quien la cerró",
            orden.status === "COMPLETED" && orden.completed_at !== null && orden.completed_by === "verify-script",
            orden
        );

        const [prod] = await rows(sql`
      select id, order_id, produced_quantity, recorded_by from production_results
      where order_id = ${pendiente}::uuid
    `);
        check(
            "la producción quedó ligada a la línea de la hoja",
            !!prod && Number(prod.produced_quantity) === 1 && prod.recorded_by === "verify-script",
            prod
        );

        const hoja2 = await PrepListService.getPrepList({ companyId: ctx.company_id, branchId: ctx.branch_id, date: hoy });
        const completada = hoja2.groups.flatMap(g => g.lines).find(l => l.id === pendiente);
        check("la hoja ya la muestra HECHA y sin previsión FEFO", completada?.state === "HECHA" && completada?.fefo.length === 0);

        console.log("\n--- 6. Rechazos ---");
        const intentar = async (nombre: string, fn: () => Promise<unknown>, codigo: string) => {
            try {
                await fn();
                check(nombre, false, "no lanzó");
            } catch (e) {
                const code = e instanceof PrepListError ? e.code : String(e);
                check(nombre, code === codigo, code);
            }
        };

        await intentar(
            "completar dos veces → ALREADY_COMPLETED",
            () => PrepListService.completeLine({ companyId: ctx.company_id, branchId: ctx.branch_id, orderId: pendiente, userId: "verify-script" }),
            "ALREADY_COMPLETED"
        );
        await intentar(
            "línea cancelada → ORDER_CANCELLED",
            () => PrepListService.completeLine({ companyId: ctx.company_id, branchId: ctx.branch_id, orderId: cancelada, userId: "verify-script" }),
            "ORDER_CANCELLED"
        );
        await intentar(
            "línea de otra empresa → ORDER_NOT_FOUND (no filtra existencia)",
            () => PrepListService.completeLine({ companyId: "00000000-0000-0000-0000-000000000000", branchId: ctx.branch_id, orderId: atrasada, userId: "verify-script" }),
            "ORDER_NOT_FOUND"
        );
        await intentar(
            "cantidad producida 0 → INVALID_QUANTITY",
            () => PrepListService.completeLine({ companyId: ctx.company_id, branchId: ctx.branch_id, orderId: atrasada, userId: "verify-script", producedQuantity: 0 }),
            "INVALID_QUANTITY"
        );

        console.log(
            fallas.length === 0
                ? "\nOK: prep list 6a completa"
                : `\nFALLA en: ${fallas.join(" | ")}`
        );
        process.exitCode = fallas.length === 0 ? 0 : 1;
    } finally {
        for (const id of ordenes) {
            const results = await rows(sql`select id from production_results where order_id = ${id}::uuid`);
            for (const r of results) {
                await db.execute(sql`delete from inventory_waste where production_result_id = ${r.id}::uuid`);
                await db.execute(sql`delete from production_ingredients where result_id = ${r.id}::uuid`);
                await db.execute(sql`delete from production_results where id = ${r.id}::uuid`);
            }
            await db.execute(sql`delete from production_orders where id = ${id}::uuid`);
        }
        // La merma por lote insuficiente que pudo escribir la producción no
        // cuelga del resultado: se borra por su nota.
        await db.execute(sql`delete from inventory_waste where notes like '%[VERIFY]%' or notes like 'Lote insuficiente al completar la prep list%'`);

        // Devolver el stock a como estaba: el descuento FEFO de la línea
        // completada es real.
        let restaurados = 0;
        for (const b of stockAntes) {
            const [ahora] = await rows(sql`select current_quantity from inventory_batches where id = ${b.id}::uuid`);
            if (!ahora || String(ahora.current_quantity) === String(b.current_quantity)) continue;
            await db.execute(sql`update inventory_batches set current_quantity = ${b.current_quantity} where id = ${b.id}::uuid`);
            restaurados += 1;
        }
        console.log(`limpieza: órdenes, producciones y mermas [VERIFY] borradas; ${restaurados} lote(s) restaurado(s)`);
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
