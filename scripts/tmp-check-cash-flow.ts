/**
 * Invariantes aritméticos de `getCashFlowProjection`, sin servidor ni navegador.
 *
 * Es el lazo rápido de la Fase 0: el spec de Playwright es el artefacto que
 * queda, pero para iterar sobre el servicio basta con llamarlo directo.
 *
 * Uso: npx tsx <ruta>/check-cash-flow-invariants.ts
 */

import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { getCashFlowProjection } from "@/lib/services/cash-flow-service";

const COMPANY_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const BRANCH_CONDESA = "b1000001-0000-4000-8000-000000000001";
const USER_SUPER_ADMIN = "u0000001-0000-4000-8000-000000000001";
const TAG = "[E2E]";
const VENTANA = 30;

const raw = neon(process.env.DATABASE_URL!);

/** Fechas de nómina de la ventana, en lectura local y en corte UTC. */
function fechasDeNomina(dias: number): string[] {
  const hoy = new Date();
  const fechas = new Set<string>();
  for (let i = 0; i < dias; i++) {
    const d = new Date(hoy.getTime() + i * 24 * 60 * 60 * 1000);
    const dm = d.getDate();
    if (dm !== 15 && dm !== 30 && !(dm === 28 && d.getMonth() === 1)) continue;
    fechas.add(d.toISOString().slice(0, 10));
    fechas.add(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(dm).padStart(2, "0")}`
    );
  }
  return [...fechas];
}

/** Siembra un gasto en cada día de nómina: sin colisión el bug no se ve. */
async function sembrarColisiones(): Promise<string[]> {
  await limpiar();
  const fechas = fechasDeNomina(VENTANA);
  for (const fecha of fechas) {
    await raw`
      INSERT INTO operating_expenses (
        company_id, branch_id, category, amount, description, status, requested_by, due_date
      ) VALUES (
        ${COMPANY_ID}, ${BRANCH_CONDESA}, 'OTROS', 123400,
        ${`${TAG} Gasto en día de nómina ${fecha}`}, 'APPROVED', ${USER_SUPER_ADMIN}, ${fecha}::date
      )
    `;
  }
  return fechas;
}

async function limpiar(): Promise<void> {
  await raw`DELETE FROM operating_expenses WHERE description LIKE ${`${TAG}%`}`;
}

let fallas = 0;

function verificar(nombre: string, condicion: boolean, detalle: string) {
  if (condicion) {
    console.log(`  OK   ${nombre}`);
  } else {
    fallas++;
    console.log(`  FALLA ${nombre}`);
    console.log(`        ${detalle}`);
  }
}

async function main() {
  const sembradas = await sembrarColisiones();
  console.log(`Gastos sembrados en: ${sembradas.join(", ")}\n`);

  const p = await getCashFlowProjection(COMPANY_ID, VENTANA);

  const primerDia = p.days[0].date;
  const ultimoDia = p.days[p.days.length - 1].date;
  console.log(`Ventana proyectada: ${primerDia} → ${ultimoDia} (${p.days.length} días)`);
  console.log(`Partidas: ${p.outflowItems.length} · Semanas: ${p.weeklyAggregation.length}\n`);

  // 1. Los días suman lo mismo que las partidas de la ventana.
  const sumaDias = p.days.reduce((t, d) => t + d.projectedOutflowCents, 0);
  const sumaPartidas = p.outflowItems
    .filter((i) => i.date >= primerDia && i.date <= ultimoDia)
    .reduce((t, i) => t + i.amountCents, 0);
  verificar(
    "Σ días == Σ partidas en la ventana",
    sumaDias === sumaPartidas,
    `días=${sumaDias} partidas=${sumaPartidas} diferencia=${sumaDias - sumaPartidas}`
  );

  // 2. El conteo por día coincide con las partidas de esa fecha.
  const porFecha = new Map<string, number>();
  for (const i of p.outflowItems) porFecha.set(i.date, (porFecha.get(i.date) ?? 0) + 1);
  const conteosMalos = p.days.filter(
    (d) => d.outflowItemsCount !== (porFecha.get(d.date) ?? 0)
  );
  verificar(
    "conteo de partidas por día",
    conteosMalos.length === 0,
    conteosMalos
      .map((d) => `${d.date}: día dice ${d.outflowItemsCount}, hay ${porFecha.get(d.date) ?? 0}`)
      .join(" | ")
  );

  // 3. Ninguna partida fuera del rango de días proyectados.
  const huerfanas = p.outflowItems.filter((i) => i.date < primerDia || i.date > ultimoDia);
  verificar(
    "ninguna partida fuera del rango de días",
    huerfanas.length === 0,
    huerfanas.map((i) => `${i.date} ${i.category} ${i.amountCents}`).join(" | ")
  );

  // 4. Cada semana suma exactamente sus días.
  const semanasMalas = p.weeklyAggregation.filter((s) => {
    const suma = p.days
      .filter((d) => d.date >= s.startDate && d.date <= s.endDate)
      .reduce((t, d) => t + d.projectedOutflowCents, 0);
    return suma !== s.totalOutflowCents;
  });
  verificar(
    "cada semana == suma de sus días",
    semanasMalas.length === 0,
    semanasMalas
      .map((s) => {
        const suma = p.days
          .filter((d) => d.date >= s.startDate && d.date <= s.endDate)
          .reduce((t, d) => t + d.projectedOutflowCents, 0);
        return `${s.weekLabel}: semana=${s.totalOutflowCents} días=${suma}`;
      })
      .join(" | ")
  );

  // 5. Las semanas cubren la ventana sin traslape.
  const cubiertos = new Set<string>();
  let traslapes = 0;
  for (const s of p.weeklyAggregation) {
    for (const d of p.days) {
      if (d.date < s.startDate || d.date > s.endDate) continue;
      if (cubiertos.has(d.date)) traslapes++;
      cubiertos.add(d.date);
    }
  }
  verificar(
    "semanas cubren la ventana sin traslape",
    traslapes === 0 && cubiertos.size === p.days.length,
    `cubiertos=${cubiertos.size}/${p.days.length} traslapes=${traslapes}`
  );

  // Contexto para leer las fallas de arriba.
  const nomina = p.outflowItems.filter((i) => i.isPayroll);
  console.log(`\nPartidas de nómina: ${nomina.map((n) => n.date).join(", ") || "ninguna"}`);
  for (const n of nomina) {
    const dia = p.days.find((d) => d.date === n.date);
    const partidasDelDia = p.outflowItems.filter((i) => i.date === n.date);
    const esperado = partidasDelDia.reduce((t, i) => t + i.amountCents, 0);
    console.log(
      `  ${n.date}: día=${dia?.projectedOutflowCents} esperado=${esperado} ` +
        `(${partidasDelDia.length} partidas, día dice ${dia?.outflowItemsCount})`
    );
  }

  await limpiar();
  console.log(fallas === 0 ? "\nTodos los invariantes pasan." : `\n${fallas} invariante(s) fallando.`);
  process.exit(fallas === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await limpiar().catch(() => {});
  process.exit(2);
});
