import "dotenv/config";
import { getControlReport } from "@/lib/services/control-kpi-service";

const COMPANY = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

async function main() {
  const r = await getControlReport({ companyId: COMPANY, month: "2026-08" });
  console.log("mes:", r.month, "| sucursal:", r.branchId ?? "(toda la empresa)");
  console.log("\n--- Ejecución presupuestal (celdas con dato) ---");
  console.table(
    r.budgetExecution.rows
      .filter((x) => x.budgetedCents > 0 || x.committedCents > 0)
      .map((x) => ({
        suc: x.branchCode ?? x.branchName,
        centro: x.costCenterCode,
        presup: x.budgetedCents / 100,
        comprom: x.committedCents / 100,
        dispon: x.availableCents / 100,
        consumo: x.consumedPercent === null ? "—" : `${x.consumedPercent.toFixed(1)}%`,
        sinTecho: x.unbudgeted,
        estado: x.status,
      })),
  );
  console.log("filas totales (suc×centro):", r.budgetExecution.rows.length);
  console.log("\n--- Totales ---"); console.table([r.budgetExecution.totals]);
  console.log("\n--- % emergencias ---"); console.table([r.emergencyShare]);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
