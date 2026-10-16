import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import { workflowCompletionOutbox as outbox } from "@/lib/db/schema";
import { inngest } from "@/lib/inngest/client";
import { pendingWorkflowCompletions, publishWorkflowCompletion, resetWorkflowCompletion,
  runCompletionExtractor, setWorkflowExtractionStatus } from "@/lib/services/workflow-completion-delivery";

vi.mock("@/lib/db", () => ({ db: { transaction: vi.fn(), select: vi.fn(), update: vi.fn(), execute: vi.fn() } }));
vi.mock("@/lib/inngest/client", () => ({ inngest: { send: vi.fn() } }));

const ID = "00000000-0000-4000-8000-000000000028";
const dialect = new PgDialect();
type Row = Record<string, any>;
let rows: Row[];
let instances: Row[];
let tail: Promise<unknown>;
let failAcknowledgement: boolean;

// Adaptador transaccional controlado: filtros reales traducidos desde Drizzle,
// exclusión de transacciones y rollback del estado persistido. No simula red.
function matching(table: unknown, condition: any) {
  const { sql, params } = dialect.sqlToQuery(condition);
  return (table === outbox ? rows : instances).filter(row => {
    if (sql.includes('"instance_id"')) return params.includes(row.instanceId);
    if (sql.includes('"id"')) return params.includes(row.id);
    if (sql.includes('"status"')) return params.includes(row.status);
    return true;
  });
}

describe("C28 — entrega durable con fallos y duplicados", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rows = [{ id: "outbox-28", instanceId: ID, status: "pending", attempts: 0, generation: 0,
      completedExtractors: [], lastError: null }];
    instances = [{ id: ID, status: "COMPLETED", completionEffectsStatus: "pending" }];
    tail = Promise.resolve();
    failAcknowledgement = false;
    vi.mocked(inngest.send).mockResolvedValue({ ids: ["event-28"] } as never);
    vi.mocked(db.execute).mockResolvedValue([] as never);
    vi.mocked(db.select).mockImplementation(() => ({ from: (table: unknown) => ({ where: (condition: unknown) => {
      const result = matching(table, condition);
      return Object.assign(Promise.resolve(result), {
        for: () => Promise.resolve(result),
        orderBy: () => ({ limit: (n: number) => Promise.resolve(result.slice(0, n)) }),
      });
    } }) }) as never);
    vi.mocked(db.update).mockImplementation((table: unknown) => ({ set: (patch: Row) => ({ where: async (condition: unknown) => {
      if (failAcknowledgement && patch.status === "delivered") {
        failAcknowledgement = false;
        throw new Error("caída después del envío");
      }
      for (const row of matching(table, condition)) Object.assign(row, patch);
    } }) }) as never);
    vi.mocked(db.transaction).mockImplementation((async (callback: (tx: typeof db) => Promise<unknown>) => {
      const prior = tail;
      let release!: () => void;
      tail = new Promise<void>(resolve => { release = resolve; });
      await prior;
      const snapshot = structuredClone({ rows, instances });
      try { return await callback(db); }
      catch (error) { rows = snapshot.rows; instances = snapshot.instances; throw error; }
      finally { release(); }
    }) as never);
  });

  it("recupera una intención tras la caída antes del envío; aceptar evento aún no aplica efectos", async () => {
    expect(await pendingWorkflowCompletions()).toHaveLength(1);
    await publishWorkflowCompletion(ID);
    expect(rows[0].status).toBe("delivered");
    expect(instances[0].completionEffectsStatus).toBe("pending");
    expect(await pendingWorkflowCompletions()).toHaveLength(0);
  });

  it("caída después del envío conserva intención y reenvía con el mismo identificador", async () => {
    failAcknowledgement = true;
    await expect(publishWorkflowCompletion(ID)).rejects.toThrow("caída después del envío");
    expect(rows[0].status).toBe("pending");
    await publishWorkflowCompletion(ID);
    const ids = vi.mocked(inngest.send).mock.calls.map(([event]) => (event as any).id);
    expect(ids).toEqual([`workflow-extractors:${ID}:0`, `workflow-extractors:${ID}:0`]);
    expect(rows[0].status).toBe("delivered");
  });

  it("dos publicadores concurrentes confirman una sola entrega", async () => {
    await Promise.all([publishWorkflowCompletion(ID), publishWorkflowCompletion(ID)]);
    expect(inngest.send).toHaveBeenCalledTimes(1);
    expect(rows[0].attempts).toBe(1);
  });

  it("cinco fallos dejan estado terminal visible y error sin secretos", async () => {
    vi.mocked(inngest.send).mockRejectedValue(new Error("token=secreto"));
    for (let n = 0; n < 5; n++) await publishWorkflowCompletion(ID);
    expect(rows[0]).toMatchObject({ status: "failed", attempts: 5 });
    expect(rows[0].lastError).not.toContain("secreto");
    expect(instances[0].completionEffectsStatus).toBe("failed");
    await publishWorkflowCompletion(ID);
    expect(inngest.send).toHaveBeenCalledTimes(5);
  });

  it("entrega duplicada ejecuta un extractor una sola vez, incluso concurrente", async () => {
    let documents = 0;
    const extract = async () => { documents++; };
    await Promise.all([runCompletionExtractor(ID, "receiving", extract, 0), runCompletionExtractor(ID, "receiving", extract, 0)]);
    expect(documents).toBe(1);
    expect(rows[0].completedExtractors).toEqual(["receiving"]);
  });

  it("recupera solo el extractor fallido; doble clic abre una generación y conserva éxitos", async () => {
    const done = vi.fn().mockResolvedValue(undefined);
    const failed = vi.fn().mockRejectedValueOnce(new Error("bd caída")).mockResolvedValue(undefined);
    await runCompletionExtractor(ID, "receiving", done, 0);
    await expect(runCompletionExtractor(ID, "production", failed, 0)).rejects.toThrow("bd caída");
    await setWorkflowExtractionStatus(ID, "failed", 0);
    await Promise.all([resetWorkflowCompletion(ID), resetWorkflowCompletion(ID)]);
    expect(rows[0]).toMatchObject({ generation: 1, status: "pending", completedExtractors: ["receiving"] });
    await publishWorkflowCompletion(ID);
    expect(inngest.send).toHaveBeenCalledWith(expect.objectContaining({ id: `workflow-extractors:${ID}:1` }));
    await runCompletionExtractor(ID, "receiving", done, 1);
    await runCompletionExtractor(ID, "production", failed, 1);
    await setWorkflowExtractionStatus(ID, "completed", 1);
    expect(done).toHaveBeenCalledTimes(1);
    expect(failed).toHaveBeenCalledTimes(2);
    expect(instances[0].completionEffectsStatus).toBe("completed");
  });

  it("una corrida obsoleta no ejecuta ni cambia el estado de la recuperación", async () => {
    rows[0].generation = 1;
    const extract = vi.fn();
    await runCompletionExtractor(ID, "merma", extract, 0);
    await setWorkflowExtractionStatus(ID, "failed", 0);
    await runCompletionExtractor(ID, "merma", extract);
    await setWorkflowExtractionStatus(ID, "failed");
    expect(extract).not.toHaveBeenCalled();
    expect(instances[0].completionEffectsStatus).toBe("pending");
  });

  it("no fabrica éxito ni recuperación para ejecuciones anteriores sin outbox", async () => {
    rows = [];
    instances[0].completionEffectsStatus = null;
    await setWorkflowExtractionStatus(ID, "completed");
    expect(instances[0].completionEffectsStatus).toBeNull();
    await expect(resetWorkflowCompletion(ID)).rejects.toThrow("no tiene una entrega recuperable");
  });
});
