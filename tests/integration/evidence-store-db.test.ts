import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { branches, companies, evidence, users } from "@/lib/db/schema";
import { EvidenceStore } from "@/lib/services/evidence-store";

/**
 * EVI-01 contra base Postgres real (Fase 2).
 *
 * Prueba lo que el `Map` en memoria no podía dar:
 * - la fila sobrevive fuera del proceso (durabilidad);
 * - alta/lectura/borrado exigen el `companyId` del actor (aislamiento).
 *
 * Requiere `TEST_DATABASE_URL` (ver `tests/integration/setup.ts`).
 */

type Tenant = { companyId: string; branchId: string; userId: string };

async function seedTenant(label: string): Promise<Tenant> {
  const companyId = randomUUID();
  const branchId = randomUUID();
  const userId = randomUUID();

  await db.insert(companies).values({ id: companyId, name: `EVI ${label} ${companyId.slice(0, 8)}` });
  await db.insert(branches).values({ id: branchId, companyId, name: `Sucursal ${label}` });
  await db.insert(users).values({
    id: userId,
    name: `Usuario ${label}`,
    email: `${userId}@evi.test`,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    companyId,
    branchId,
    role: "ADMIN",
  });

  return { companyId, branchId, userId };
}

describe("EVI-01 sobre base real: evidencia durable y aislada", () => {
  let a: Tenant;
  let b: Tenant;

  beforeEach(async () => {
    a = await seedTenant("A");
    b = await seedTenant("B");
  });

  it("persiste el adjunto y sigue consultable fuera del proceso", async () => {
    const stepId = randomUUID();
    const record = await EvidenceStore.store({
      companyId: a.companyId,
      branchId: a.branchId,
      entityType: "WORKFLOW_STEP",
      entityId: stepId,
      kind: "PHOTO",
      mimeType: "image/jpeg",
      url: "companies/a/workflows/x/1_step.jpg",
      createdBy: a.userId,
      aiMetadata: { classification: "cleaning_checklist" },
    });

    // La fila existe en la tabla (durabilidad real, no un Map del proceso).
    const rows = await db.select().from(evidence).where(eq(evidence.id, record.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].companyId).toBe(a.companyId);
    expect(rows[0].storageKey).toBeNull();
    expect(rows[0].url).toBe("companies/a/workflows/x/1_step.jpg");

    // Lectura por la fachada devuelve el registro con su metadata.
    const found = await EvidenceStore.getByEntity(a.companyId, "WORKFLOW_STEP", stepId);
    expect(found).toHaveLength(1);
    expect(found[0].id).toBe(record.id);
    expect(found[0].aiMetadata.classification).toBe("cleaning_checklist");
    expect(found[0].createdBy).toBe(a.userId);
  });

  it("no expone ni permite tocar evidencia de otra empresa", async () => {
    const stepId = randomUUID();
    const record = await EvidenceStore.store({
      companyId: a.companyId,
      branchId: a.branchId,
      entityType: "WORKFLOW_STEP",
      entityId: stepId,
      kind: "PHOTO",
      url: "companies/a/workflows/x/2_step.jpg",
    });

    // La otra empresa no ve la entidad ni el id.
    expect(await EvidenceStore.getByEntity(b.companyId, "WORKFLOW_STEP", stepId)).toHaveLength(0);
    expect(await EvidenceStore.getById(b.companyId, record.id)).toBeNull();
    expect(await EvidenceStore.getByBranch(b.companyId, a.branchId)).toHaveLength(0);

    // Tampoco puede adjuntar metadata ni borrar.
    expect(await EvidenceStore.attachMetadata(b.companyId, record.id, { labels: ["x"] })).toBeNull();
    expect(await EvidenceStore.softDelete(b.companyId, record.id)).toBe(false);

    // La fila sigue viva para su dueño.
    expect(await EvidenceStore.getById(a.companyId, record.id)).not.toBeNull();
  });

  it("merge de metadata y borrado lógico respetan al dueño", async () => {
    const stepId = randomUUID();
    const record = await EvidenceStore.store({
      companyId: a.companyId,
      branchId: a.branchId,
      entityType: "WORKFLOW_STEP",
      entityId: stepId,
      kind: "PHOTO",
      url: "companies/a/workflows/x/3_step.jpg",
      aiMetadata: { classification: "receiving", labels: ["fifo"] },
    });

    const merged = await EvidenceStore.attachMetadata(a.companyId, record.id, {
      verificationResult: { passed: true, confidence: 0.92 },
    });
    expect(merged?.aiMetadata.classification).toBe("receiving");
    expect(merged?.aiMetadata.labels).toEqual(["fifo"]);
    expect(merged?.aiMetadata.verificationResult?.passed).toBe(true);

    expect(await EvidenceStore.softDelete(a.companyId, record.id)).toBe(true);
    expect(await EvidenceStore.getById(a.companyId, record.id)).toBeNull();
    expect(await EvidenceStore.getByEntity(a.companyId, "WORKFLOW_STEP", stepId)).toHaveLength(0);

    // Segundo borrado del mismo registro: ya no está vivo → false (idempotente).
    expect(await EvidenceStore.softDelete(a.companyId, record.id)).toBe(false);
  });
});
