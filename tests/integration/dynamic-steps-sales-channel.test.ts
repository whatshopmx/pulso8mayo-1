import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { branches, channelCommissionRates, companies } from "@/lib/db/schema";
import { resolveDynamicSteps, DynamicStepsEmptyError } from "@/lib/workflows/dynamic-steps";
import type { WorkflowStep } from "@/lib/types/workflow";

/**
 * Fase 3 — el paso dinámico `sales_channel` expande una plataforma por cada
 * agregador ACTIVO (con tarifa capturada), no por la lista hardcodeada del
 * mercado. Aquí se comprueba contra Postgres real: ids `{parent}-{canal}`,
 * `{{name}}` interpolado y el canal fuera del catálogo incluido.
 *
 * Requiere `TEST_DATABASE_URL` (ver `tests/integration/setup.ts`).
 */

const PASO: WorkflowStep = {
  id: "paso-plataformas",
  type: "NUMBER",
  title: "Ventas {{name}} ($ MXN)",
  required: false,
  metadata: { dynamicSource: { entity: "sales_channel" } },
};

async function seedFixtures() {
  const companyId = randomUUID();
  const branchId = randomUUID();
  await db.insert(companies).values({ id: companyId, name: `ISO canales ${companyId.slice(0, 8)}` });
  await db.insert(branches).values({ id: branchId, companyId, name: "Sucursal canales" });
  return { companyId, branchId };
}

async function cleanup(companyId: string) {
  await db.delete(channelCommissionRates).where(eq(channelCommissionRates.companyId, companyId));
  await db.delete(branches).where(eq(branches.companyId, companyId));
  await db.delete(companies).where(eq(companies.id, companyId));
}

describe("resolveDynamicSteps · sales_channel", () => {
  let f: { companyId: string; branchId: string };

  beforeEach(async () => {
    f = await seedFixtures();
  });

  afterEach(async () => {
    await cleanup(f.companyId);
  });

  it("expande una plataforma por agregador activo, con id y título por canal", async () => {
    await db.insert(channelCommissionRates).values([
      { companyId: f.companyId, channel: "rappi", rateBps: 2750, effectiveFrom: "2026-01-01" },
      { companyId: f.companyId, channel: "uber", rateBps: 2500, effectiveFrom: "2026-01-01" },
    ]);

    const steps = await resolveDynamicSteps([PASO], { companyId: f.companyId });

    expect(steps.map((s) => s.id)).toEqual(["paso-plataformas-rappi", "paso-plataformas-uber"]);
    expect(steps[0].title).toBe("Ventas Rappi ($ MXN)");
    expect(steps[1].title).toBe("Ventas Uber Eats ($ MXN)");
    expect(steps[0].metadata?.entityId).toBe("rappi");
    expect(steps[1].metadata?.dynamicSource).toBeUndefined();
  });

  it("no incluye una plataforma sin tarifa", async () => {
    await db.insert(channelCommissionRates).values([
      { companyId: f.companyId, channel: "rappi", rateBps: 2750, effectiveFrom: "2026-01-01" },
    ]);

    const steps = await resolveDynamicSteps([PASO], { companyId: f.companyId });
    expect(steps.map((s) => s.id)).toEqual(["paso-plataformas-rappi"]);
  });

  it("incluye un agregador fuera del catálogo si tiene tarifa", async () => {
    await db.insert(channelCommissionRates).values([
      { companyId: f.companyId, channel: "nuevoagregador", rateBps: 1800, effectiveFrom: "2026-01-01" },
    ]);

    const steps = await resolveDynamicSteps([PASO], { companyId: f.companyId });
    expect(steps.map((s) => s.id)).toEqual(["paso-plataformas-nuevoagregador"]);
  });

  it("sin canales activos el paso no expande y se avisa con error, no con instancia vacía", async () => {
    await expect(resolveDynamicSteps([PASO], { companyId: f.companyId })).rejects.toBeInstanceOf(
      DynamicStepsEmptyError,
    );
  });
});
