import "dotenv/config";
import { getControlReport } from "@/lib/services/control-kpi-service";

const COMPANY = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const MES = process.argv[2] ?? "2026-08";

async function main() {
  const r = await getControlReport({ companyId: COMPANY, month: MES });
  console.log("mes:", r.month, "| sucursal:", r.branchId ?? "(toda la empresa)", "| sucursales en alcance:", r.branchCount);

  console.log("\n--- Ejecucion presupuestal (celdas con dato) ---");
  console.table(
    r.budgetExecution.rows
      .filter((x) => x.budgetedCents > 0 || x.committedCents > 0)
      .map((x) => ({
        suc: x.branchCode ?? x.branchName,
        centro: x.costCenterCode,
        presup: x.budgetedCents / 100,
        comprom: x.committedCents / 100,
        dispon: x.availableCents / 100,
        consumo: x.consumedPercent === null ? "-" : `${x.consumedPercent.toFixed(1)}%`,
        sinTecho: x.unbudgeted,
        estado: x.status,
      })),
  );
  console.log("\n--- Totales ---");
  console.table([r.budgetExecution.totals]);

  console.log("\n--- % emergencias ---");
  console.table([r.emergencyShare]);

  console.log("\n--- Ranking de proveedores ---");
  console.table(
    r.supplierRanking.map((s) => ({
      proveedor: s.supplierName,
      monto: s.totalCents / 100,
      oc: s.purchaseOrders,
      os: s.serviceOrders,
      participacion: `${s.sharePercent.toFixed(1)}%`,
    })),
  );

  console.log("\n--- Comparativo de precios entre sucursales ---");
  console.table(
    r.priceComparison.map((p) => ({
      insumo: p.itemName,
      unidad: p.unit,
      sucursales: p.branches.length,
      min: p.minCents / 100,
      max: p.maxCents / 100,
      dispersion: p.spreadPercent === null ? "-" : `${p.spreadPercent.toFixed(1)}%`,
      barata: p.cheapestBranch,
      cara: p.dearestBranch,
      estado: p.status,
    })),
  );

  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
