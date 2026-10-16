import { beforeEach, expect, it, vi } from "vitest";
import { workflowExtractorsFn } from "@/lib/inngest/functions/workflow-extractors";
import { runCompletionExtractor, setWorkflowExtractionStatus } from "@/lib/services/workflow-completion-delivery";

vi.mock("@/lib/inngest/client", () => ({ inngest: { createFunction: (config: unknown, handler: unknown) => ({ config, handler }) } }));
vi.mock("@/lib/services/workflow-completion-delivery", () => ({ runCompletionExtractor: vi.fn(), setWorkflowExtractionStatus: vi.fn() }));
vi.mock("@/lib/services/receiving-from-workflow", () => ({ extractReceivingFromInstance: vi.fn() }));
vi.mock("@/lib/services/stock-count-from-workflow", () => ({ extractStockCountFromInstance: vi.fn() }));
vi.mock("@/lib/services/merma-from-workflow", () => ({ extractMermaFromInstance: vi.fn() }));
vi.mock("@/lib/services/production-from-workflow", () => ({ extractProductionFromInstance: vi.fn() }));

const fn = workflowExtractorsFn as unknown as {
  handler: (ctx: any) => Promise<unknown>;
  config: { onFailure: (ctx: any) => Promise<void> };
};
const step = { run: vi.fn(async (_id: string, action: () => Promise<unknown>) => action()) };
const data = { instanceId: "instance-28", generation: 2 };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(runCompletionExtractor).mockResolvedValue(undefined);
  vi.mocked(setWorkflowExtractionStatus).mockResolvedValue(undefined);
});

it("no marca completado hasta que terminaron los cuatro extractores", async () => {
  const order: string[] = [];
  vi.mocked(runCompletionExtractor).mockImplementation(async (_id, name) => { order.push(name); });
  vi.mocked(setWorkflowExtractionStatus).mockImplementation(async (_id, status) => { order.push(status); });
  await fn.handler({ event: { data }, step });
  expect(order).toEqual(["processing", "receiving", "stock-count", "merma", "production", "completed"]);
});

it("un extractor fallido no impide los demás y deja el resultado fallido", async () => {
  vi.mocked(runCompletionExtractor).mockImplementation(async (_id, name) => {
    if (name === "stock-count") throw new Error("agotó reintentos");
  });
  await expect(fn.handler({ event: { data }, step })).rejects.toThrow("stock-count");
  expect(runCompletionExtractor).toHaveBeenCalledTimes(4);
  expect(setWorkflowExtractionStatus).toHaveBeenLastCalledWith(data.instanceId, "failed", 2);
  expect(setWorkflowExtractionStatus).not.toHaveBeenCalledWith(data.instanceId, "completed", 2);
});

it("el handler terminal registra también fallos de infraestructura fuera del extractor", async () => {
  await fn.config.onFailure({ event: { data: { event: { data } } }, step });
  expect(setWorkflowExtractionStatus).toHaveBeenCalledWith(data.instanceId, "failed", 2);
});

it("rechaza eventos sin instancia antes de producir cambios", async () => {
  await expect(fn.handler({ event: { data: {} }, step })).rejects.toThrow("sin instanceId");
  expect(setWorkflowExtractionStatus).not.toHaveBeenCalled();
  expect(runCompletionExtractor).not.toHaveBeenCalled();
});
