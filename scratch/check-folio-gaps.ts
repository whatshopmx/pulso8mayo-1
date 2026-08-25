import "dotenv/config";
import { findFolioGaps } from "@/lib/services/folio-generator";
const COMPANY_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
async function main() {
  const gaps = await findFolioGaps(COMPANY_ID);
  if (gaps.length === 0) console.log("SIN HUECOS ✓ — todas las series consecutivas");
  else { console.log("HUECOS DETECTADOS:"); console.log(JSON.stringify(gaps, null, 2)); }
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
