import "dotenv/config";
import { getControlReport } from "@/lib/services/control-kpi-service";
const COMPANY = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const BR_CONDESA = "b1000001-0000-4000-8000-000000000001";
async function main() {
  for (const [label, branchId] of [["empresa", null], ["Condesa", BR_CONDESA]] as const) {
    const r = await getControlReport({ companyId: COMPANY, month: "2026-08", branchId });
    console.log(`\n===== ${label} =====`);
    console.log("ventas del mes:", r.foodCost.salesCents / 100);
    console.log("food cost REAL     :", r.foodCost.real.percent, "% | fuente:", r.foodCost.real.source, "| estado:", r.foodCost.real.status);
    console.log("   nota:", r.foodCost.real.note);
    console.log("food cost TEORICO  :", r.foodCost.theoretical.percent, "| fuente:", r.foodCost.theoretical.source);
    console.log("   nota:", r.foodCost.theoretical.note);
    console.log("brecha (pp)        :", r.foodCost.gapPoints);
    const oe = r.operatingExpense;
    console.log("gasto operativo    :", oe.percent, "% =", oe.serviceSpendCents / 100, "OS /", oe.salesCents / 100, "ventas | OS:", oe.serviceOrderCount, "| semaforo:", oe.status);
    console.log("   nota:", oe.note);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
