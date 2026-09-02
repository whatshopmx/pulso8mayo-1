import { inngest } from "@/lib/inngest/client";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import { revalidarCfdiConciliados } from "@/lib/services/cfdi-revalidation-service";

/**
 * A6.3 / F15 — Revalidación mensual de CFDI ya conciliados contra el SAT.
 *
 * Un comprobante se validaba una sola vez, al recibirlo, y después se conciliaba
 * y no se volvía a mirar nunca. La cancelación es unilateral del emisor y no
 * avisa: si un proveedor cancela una factura que el grupo ya dedujo, el receptor
 * se entera cuando el SAT le rechaza la deducción, meses después y con recargos.
 *
 * Mensual y no diario a propósito: el PAC cobra por consulta y una cancelación
 * no es una emergencia de hoy —es un ajuste de la declaración del mes. El día 3
 * a las 6 de la mañana, después del cierre contable del mes anterior y antes de
 * que alguien mire los números.
 *
 * Un inquilino por paso: `step.run` memoiza cada uno, así que un fallo del PAC a
 * media lista no obliga a re-consultar (y re-pagar) los que ya se revisaron.
 */
export const cronCfdiRevalidation = inngest.createFunction(
  {
    id: "cron-cfdi-revalidation",
    triggers: [{ cron: "0 6 3 * *" }],
    retries: 2,
  },
  async ({ step }) => {
    const empresas = await step.run("listar-empresas", async () => {
      const rows = await db.select({ id: companies.id, name: companies.name }).from(companies);
      return rows;
    });

    const resultados: Array<{ companyId: string; canceladas: number; revisadas: number }> = [];

    for (const empresa of empresas) {
      const r = await step.run(`revalidar-${empresa.id}`, async () =>
        revalidarCfdiConciliados(empresa.id),
      );
      resultados.push({
        companyId: empresa.id,
        canceladas: r.canceladas,
        revisadas: r.revisadas,
      });
    }

    return {
      success: true,
      empresas: empresas.length,
      canceladasTotal: resultados.reduce((s, r) => s + r.canceladas, 0),
      resultados,
    };
  },
);
