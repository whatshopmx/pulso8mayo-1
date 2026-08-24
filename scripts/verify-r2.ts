/**
 * Verificación puntual de R2 (modelo privado, multi-tenant):
 *   1. configuración + subida con key scopeada por empresa/sucursal
 *   2. lectura privada vía SDK
 *   3. lectura vía URL presignada (el camino que usan los endpoints de evidencia)
 *   4. borrado (se limpia solo)
 *
 * Uso: npx tsx --env-file=.env scripts/verify-r2.ts
 */
import {
  isR2Configured,
  uploadToR2,
  getFromR2,
  deleteFromR2,
  fileExistsInR2,
  generatePresignedUrl,
} from "../lib/storage/r2-client";

async function main() {
  console.log("1) isConfigured:", isR2Configured());
  if (!isR2Configured()) {
    console.error("❌ R2 NO está configurado (revisa R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_ACCOUNT_ID)");
    process.exit(1);
  }
  console.log("   bucket:", process.env.R2_BUCKET_NAME || "pulso-documents");

  // Round-trip con la jerarquía multi-tenant estándar (scoped-evidence)
  const companyId = "r2-verify-test";
  const branchId = "branch-verify";
  const key = `companies/${companyId}/branches/${branchId}/_healthcheck/${Date.now()}.txt`;
  const payload = Buffer.from(`pulso29 r2 healthcheck ${new Date().toISOString()}`);

  console.log("2) Subiendo (key scopeada):", key);
  const storedKey = await uploadToR2(payload, key, "text/plain", {
    "x-verify": "pulso29-healthcheck",
  });
  console.log("   key devuelta:", storedKey, storedKey === key ? "✅" : "❌");

  console.log("3) fileExistsInR2:", await fileExistsInR2(key));

  console.log("4) Lectura privada (SDK)...");
  const downloaded = await getFromR2(key);
  const okPrivate = downloaded ? downloaded.equals(payload) : false;
  console.log("   contenido coincide:", okPrivate);

  console.log("5) Lectura vía URL presignada (camino de los endpoints de evidencia)...");
  const signedUrl = await generatePresignedUrl(key, 120);
  const res = await fetch(signedUrl);
  const signedBody = await res.text();
  const okSigned = res.ok && signedBody === payload.toString();
  console.log(`   HTTP ${res.status} ${okSigned ? "✅" : "❌"} — "${signedBody.slice(0, 40)}…"`);

  // La key NO debe ser accesible sin firma: si R2_PUBLIC_URL sigue activa,
  // este GET devolvería 200 y hay que desactivarla.
  let publicLeak = false;
  try {
    if (process.env.R2_PUBLIC_URL) {
      const pub = await fetch(`${process.env.R2_PUBLIC_URL}/${key}`, { method: "HEAD" });
      publicLeak = pub.ok;
    }
  } catch { /* sin URL pública no hay nada que probar */ }

  console.log("6) Borrando...");
  await deleteFromR2(key);
  console.log("   existe tras borrar:", await fileExistsInR2(key));

  if (okPrivate && okSigned && !publicLeak) {
    console.log("\n✅ R2 operativo en modo privado: upload + presigned OK, sin exposición pública");
  } else {
    console.log("\n⚠️ Revisar: private=" + okPrivate + " signed=" + okSigned + " publicLeak=" + publicLeak);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("❌ Falló la verificación de R2:", err.message);
  process.exit(1);
});
