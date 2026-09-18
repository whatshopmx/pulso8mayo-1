import "dotenv/config";
import { LiveCommandService } from "../lib/services/live-command-service";

const COMPANY = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

async function main() {
  const s = await LiveCommandService.getLivePulse(COMPANY);
  console.log("businessDate        :", s.businessDate);
  console.log("totalBranches       :", s.totalBranches);
  console.log("openRatePercent     :", s.openRatePercent + "%");
  console.log("staffAttendanceRate :",
    s.staffAttendanceRate === null ? "null (sin dotación planificada)" : s.staffAttendanceRate + "%");
  console.log("salesTodayCents     :", s.salesTodayCents);
  console.log("");
  console.log(">>> criticalAlertsCount :", s.criticalAlertsCount,
              s.criticalAlertsCount > 0 ? "==> BANNER ROJO (antes: 0 / verde)" : "==> banner verde");
  console.log(">>> rushAlerts (lo que el banner puede mostrar):");
  for (const a of s.rushAlerts) console.log(`      [${a.severity}] ${a.branchName}: ${a.title}`);
  console.log("");
  console.log(">>> semáforos por sucursal:");
  for (const b of s.branches) {
    console.log(`      ${b.branchName.padEnd(9)} apertura=${b.opening.status.padEnd(8)} personal=${b.staff.status.padEnd(8)} (${b.staff.activeCount}/${b.staff.expectedCount}, ${b.staff.lateCount} tarde) nom251=${b.nom251.status.padEnd(10)} venta=${b.sales.totalCents}`);
  }
}
main().catch(e => { console.error("ERR:", e.message, e.stack?.split("\n").slice(0,3).join("\n")); process.exit(1); });
