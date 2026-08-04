/**
 * ProcurementEngine — Sprint 2 Track A Task 5 (v2 §7).
 *
 * Facade over the EXISTING procurement/inventory services. Delegates:
 *   - SuggestedOrderService.calculate (per visible branch) → reorder
 *     suggestions → aggregated by supplier (NegotiationOpportunities) and by
 *     item across branches (TransferRecommendations).
 *   - StockAlertService.getLowStockItems / getOutOfStockItems (per branch) →
 *     low-stock count surfacing.
 *   - CrossBranchService.getAllBranchesMerma → shrinkage context.
 *   - PurchaseOrderService.listPOs (pending) → open-procurement pipeline.
 *
 * Net-new (normalized to EngineOutput):
 *   - `transferRecommendations`: cross-branch stock balancing — move surplus
 *     of an item from a branch with excess to a branch below its reorder point.
 *   - `negotiationOpportunities`: suppliers with the largest total suggested
 *     order volume (leverage for price/terms negotiation).
 *
 * Cost note: SuggestedOrderService.calculate runs a per-item DB loop per
 * branch; this engine caps the branches it runs suggestions for at 15 to keep
 * the 6-hourly cron pass bounded (documented; larger groups should paginate —
 * TODO). Scope-aware via ctx?+branchVisibilityFilter (Pilar 4); refresh()
 * caches into corporate_twins.executive_state.engineSnapshots.procurement.
 *
 * `EngineId` union extended ('procurement') in types.ts — type-only.
 *
 * Source: docs/pulso-executive-os-v2.md §7, docs/pulso-executive-os-security.md §10.
 */
import { db } from "@/lib/db";
import { branches, inventoryBatches, inventoryItems } from "@/lib/db/schema";
import { eq, inArray, and, sql } from "drizzle-orm";
import { SuggestedOrderService } from "@/lib/services/suggested-order-service";
import { StockAlertService } from "@/lib/services/stock-alert-service";
import { PurchaseOrderService } from "@/lib/services/purchase-order-service";
import { CrossBranchService } from "@/lib/services/cross-branch-service";
import { ExecutiveTwinEngine } from "@/lib/services/executive-twin-engine";
import { branchVisibilityFilter } from "@/lib/rbac/branch-visibility";
import type { AccessContext } from "@/lib/rbac/abac";
import type {
  EngineOutput,
  IntelligenceEngine,
  Priority,
  Risk,
} from "./types";

const CLAMP = (n: number, min = 0, max = 100) =>
  Math.max(min, Math.min(max, Math.round(n)));

const SUGGESTION_BRANCH_CAP = 15;

/** Local mirror of SuggestedOrderService.SuggestedItem (not exported). */
interface Suggestion {
  itemId: string;
  itemName: string;
  sku: string | null;
  currentStock: number;
  minLevel: number;
  maxLevel: number | null;
  suggestedQty: number;
  supplierId: string | null;
  supplierName: string | null;
}

export interface TransferRecommendation {
  itemId: string;
  itemName: string;
  fromBranchId: string;
  fromBranchName: string;
  toBranchId: string;
  toBranchName: string;
  qty: number;
}

export interface NegotiationOpportunity {
  supplierId: string | null;
  supplierName: string | null;
  totalSuggestedQty: number;
  itemVariety: number;
}

export interface ProcurementEngineOutput extends EngineOutput {
  openPOsCount: number;
  openPOsTotalCents: number;
  lowStockItems: number;
  outOfStockItems: number;
  totalSuggestedQty: number;
  mermaCents: number;
  mermaWasteCount: number;
  transferRecommendations: TransferRecommendation[];
  negotiationOpportunities: NegotiationOpportunity[];
}

export interface ProcurementEngineInput {
  companyId: string;
  ctx?: AccessContext;
}

export const ProcurementEngine: IntelligenceEngine<
  ProcurementEngineInput,
  ProcurementEngineOutput
> = {
  engineId: "procurement",
  engineName: "Procurement Engine",

  async analyze(
    input: ProcurementEngineInput,
  ): Promise<ProcurementEngineOutput> {
    const { companyId, ctx } = input;
    const generatedAt = new Date();

    const allBranches = await db
      .select({
        id: branches.id,
        name: branches.name,
        ownershipType: branches.ownershipType,
        franchiseeUserId: branches.franchiseeUserId,
      })
      .from(branches)
      .where(eq(branches.companyId, companyId));

    const visibleBranchIds = ctx
      ? branchVisibilityFilter(
          ctx,
          allBranches.map((b) => ({
            id: b.id,
            ownershipType: (b.ownershipType ?? "OWNED") as "OWNED" | "FRANCHISE",
            franchiseeUserId: b.franchiseeUserId,
          })),
        )
      : allBranches.map((b) => b.id);

    if (visibleBranchIds.length === 0) {
      return {
        score: 0,
        confidence: 0,
        insights: ["Sin sucursales visibles para el análisis de abastecimiento."],
        priorities: [],
        risks: [],
        generatedAt,
        openPOsCount: 0,
        openPOsTotalCents: 0,
        lowStockItems: 0,
        outOfStockItems: 0,
        totalSuggestedQty: 0,
        mermaCents: 0,
        mermaWasteCount: 0,
        transferRecommendations: [],
        negotiationOpportunities: [],
      };
    }

    const branchName = new Map(allBranches.map((b) => [b.id, b.name]));

    // Open PO pipeline: fetch recent POs and treat non-terminal ones as
    // "open". listPOs returns { orders, total }; we scope to visible branches.
    const openPORes = (await PurchaseOrderService.listPOs({
      companyId,
      limit: 200,
    })) as {
      orders: Array<{
        po: { branchId: string | null; status: string; totalAmount: number | null };
      }>;
    };
    const OPEN_STATUS = new Set([
      "DRAFT",
      "PENDING_APPROVAL",
      "APPROVED",
      "SENT",
      "PARTIALLY_RECEIVED",
    ]);
    const openPOsScoped = openPORes.orders.filter(
      (o) =>
        OPEN_STATUS.has(o.po.status) &&
        (!o.po.branchId || visibleBranchIds.includes(o.po.branchId)),
    );
    const openPOsCount = openPOsScoped.length;
    const openPOsTotalCents = openPOsScoped.reduce(
      (a, o) => a + Number(o.po.totalAmount ?? 0),
      0,
    );

    // Merma (shrinkage) across the visible scope.
    const merma = (await CrossBranchService.getAllBranchesMerma(companyId))
      .filter((m) => visibleBranchIds.includes(m.branchId));
    const mermaCents = merma.reduce((a, m) => a + m.totalLossCents, 0);
    const mermaWasteCount = merma.reduce((a, m) => a + m.wasteCount, 0);

    // Low / out-of-stock per branch (lighter than full suggestions).
    const branchIdsForStock = visibleBranchIds.slice(0, SUGGESTION_BRANCH_CAP);
    const [lowStockArrays, outOfStockArrays] = await Promise.all([
      Promise.all(
        branchIdsForStock.map((b) => StockAlertService.getLowStockItems(b, 100)),
      ),
      Promise.all(
        branchIdsForStock.map((b) => StockAlertService.getOutOfStockItems(b)),
      ),
    ]);
    const lowStockItems = lowStockArrays.reduce((a, arr) => a + (arr?.length ?? 0), 0);
    const outOfStockItems = outOfStockArrays.reduce(
      (a, arr) => a + (arr?.length ?? 0),
      0,
    );

    // Suggested orders per visible branch (capped). Aggregate by supplier and
    // collect per-branch stock to derive transfer recommendations.
    const suggestionsByBranch = await Promise.all(
      branchIdsForStock.map(async (b) => ({
        branchId: b,
        suggestions: (await SuggestedOrderService.calculate(
          companyId,
          b,
        )) as unknown as Suggestion[],
      })),
    );

    // Negotiation opportunities: aggregate suggestedQty by supplier.
    const supplierMap = new Map<
      string,
      { supplierName: string | null; totalQty: number; items: Set<string> }
    >();
    for (const { suggestions } of suggestionsByBranch) {
      for (const s of suggestions) {
        const key = s.supplierId ?? "__unknown__";
        const entry = supplierMap.get(key) ?? {
          supplierName: s.supplierName,
          totalQty: 0,
          items: new Set<string>(),
        };
        entry.totalQty += s.suggestedQty;
        entry.items.add(s.itemId);
        supplierMap.set(key, entry);
      }
    }
    const negotiationOpportunities: NegotiationOpportunity[] = [...supplierMap]
      .map(([supplierId, e]) => ({
        supplierId: supplierId === "__unknown__" ? null : supplierId,
        supplierName: e.supplierName,
        totalSuggestedQty: e.totalQty,
        itemVariety: e.items.size,
      }))
      .filter((n) => n.totalSuggestedQty > 0)
      .sort((a, b) => b.totalSuggestedQty - a.totalSuggestedQty);

    const totalSuggestedQty = negotiationOpportunities.reduce((a, n) => a + n.totalSuggestedQty, 0);

    // Transfer recommendations: balance stock across branches. One grouped
    // query over inventory_batches (current qty) joined to inventory_items for
    // min/max levels + name — independent of the per-branch suggestion loop so
    // we see surplus branches (the summary only surfaces deficits).
    const stockRows = (await db
      .select({
        itemId: inventoryBatches.itemId,
        branchId: inventoryBatches.branchId,
        stock: sql<number>`coalesce(sum(${inventoryBatches.currentQuantity}), 0)`,
        itemName: inventoryItems.name,
        minLevel: inventoryItems.minLevel,
        maxLevel: inventoryItems.maxLevel,
      })
      .from(inventoryBatches)
      .leftJoin(
        inventoryItems,
        eq(inventoryItems.id, inventoryBatches.itemId),
      )
      .where(
        and(
          inArray(inventoryBatches.branchId, visibleBranchIds),
          eq(inventoryItems.companyId, companyId),
          eq(inventoryItems.active, true),
        ),
      )
      .groupBy(inventoryBatches.itemId, inventoryBatches.branchId, inventoryItems.name, inventoryItems.minLevel, inventoryItems.maxLevel)) as Array<{
        itemId: string;
        branchId: string;
        stock: number;
        itemName: string;
        minLevel: number | null;
        maxLevel: number | null;
      }>;

    const perItem = new Map<
      string,
      {
        itemName: string;
        min: number;
        surplusThreshold: number;
        branches: Map<string, number>;
      }
    >();
    for (const r of stockRows) {
      const min = r.minLevel ?? 0;
      const surplusThreshold =
        (r.maxLevel ?? 0) > min ? (r.maxLevel as number) : Math.max(min * 2, min + 1);
      let entry = perItem.get(r.itemId);
      if (!entry) {
        entry = {
          itemName: r.itemName,
          min,
          surplusThreshold,
          branches: new Map(),
        };
        perItem.set(r.itemId, entry);
      }
      entry.branches.set(r.branchId, Number(r.stock));
    }

    const transferRecommendations: TransferRecommendation[] = [];
    for (const [itemId, e] of perItem) {
      if (e.min <= 0) continue;
      const deficits: { branchId: string; need: number }[] = [];
      const surpluses: { branchId: string; excess: number }[] = [];
      for (const [branchId, stock] of e.branches) {
        if (stock < e.min) deficits.push({ branchId, need: e.min - stock });
        else if (stock >= e.surplusThreshold)
          surpluses.push({ branchId, excess: stock - e.min });
      }
      // match each deficit with the largest surplus available.
      for (const d of deficits) {
        let remaining = d.need;
        for (const s of surpluses) {
          if (remaining <= 0) break;
          if (s.excess <= 0) continue;
          const move = Math.min(remaining, s.excess);
          transferRecommendations.push({
            itemId,
            itemName: e.itemName,
            fromBranchId: s.branchId,
            fromBranchName: branchName.get(s.branchId) ?? s.branchId,
            toBranchId: d.branchId,
            toBranchName: branchName.get(d.branchId) ?? d.branchId,
            qty: move,
          });
          s.excess -= move;
          remaining -= move;
        }
      }
    }
    transferRecommendations.sort((a, b) => b.qty - a.qty);
    const transferRecommendationsCapped = transferRecommendations.slice(0, 50);

    // Score: procurement health = inverse of stock-out exposure, plus a bonus
    // when transfer opportunities can cover deficits without emergency re-buy.
    const stockOutPenalty = Math.min(60, outOfStockItems * 4 + lowStockItems);
    const transferBonus = transferRecommendationsCapped.length > 0 ? 20 : 0;
    const score = CLAMP(100 - stockOutPenalty + transferBonus);
    const confidence = CLAMP(
      Math.min(100, 40 + suggestionsByBranch.length * 5 + openPOsCount),
    );

    const insights: string[] = [];
    insights.push(
      `${outOfStockItems} agotado(s) y ${lowStockItems} bajo mín a lo ancho del scope visible.`,
    );
    if (openPOsCount > 0) {
      insights.push(
        `${openPOsCount} OC(s) pendiente(s) por ${(openPOsTotalCents / 100).toFixed(2)} MXN en pipeline.`,
      );
    }
    if (transferRecommendationsCapped.length > 0) {
      insights.push(
        `${transferRecommendationsCapped.length} oportunidad(es) de transferencia cross-branch para re-balancear inventario.`,
      );
    }
    if (negotiationOpportunities.length > 0) {
      const top = negotiationOpportunities[0];
      insights.push(
        `Proveedor con mayor volumen sugerido: ${top.supplierName ?? "(sin asignar)"} ` +
          `(${top.totalSuggestedQty} uds, ${top.itemVariety} ítem(s)) — candidato para negociar mejores condiciones.`,
      );
    }

    const priorities: Priority[] = [];
    if (outOfStockItems > 0) {
      priorities.push({
        id: "procurement-out-of-stock",
        title: "Reabastecer ítems agotados",
        description: `${outOfStockItems} ítem(s) agotado(s) en el scope visible requieren reabastecimiento urgente.`,
        impact: "CRITICAL",
      });
    }
    if (transferRecommendationsCapped.length > 0) {
      priorities.push({
        id: "procurement-rebalance",
        title: "Re-balancear inventario cross-branch",
        description: `${transferRecommendationsCapped.length} transferencia(s) sugerida(s) para mover excedentes a sucursales deficitarias.`,
        impact: "HIGH",
      });
    }
    if (negotiationOpportunities.length > 0) {
      priorities.push({
        id: "procurement-negotiate",
        title: "Negociar con proveedores de mayor volumen",
        description: negotiationOpportunities
          .slice(0, 3)
          .map((n) => n.supplierName ?? "(sin asignar)")
          .join(", "),
        impact: "MEDIUM",
      });
    }

    const risks: Risk[] = [];
    if (outOfStockItems > 3 || lowStockItems > 15) {
      risks.push({
        type: "stock-out",
        severity: outOfStockItems > 5 ? "CRITICAL" : "HIGH",
        probability: 0.8,
        impactCents: 0,
        mitigation:
          "Acelerar OCs pendientes y ejecutar transferencias cross-branch para cubrir déficits inmediatos.",
      });
    }

    return {
      score,
      confidence,
      insights,
      priorities,
      risks,
      generatedAt,
      openPOsCount,
      openPOsTotalCents,
      lowStockItems,
      outOfStockItems,
      totalSuggestedQty,
      mermaCents,
      mermaWasteCount,
      transferRecommendations: transferRecommendationsCapped,
      negotiationOpportunities,
    };
  },

  async getLatest(companyId: string): Promise<ProcurementEngineOutput | null> {
    const twin = await ExecutiveTwinEngine.getLatest(companyId);
    const snap = twin?.executiveState?.engineSnapshots?.procurement;
    return (snap as ProcurementEngineOutput | undefined) ?? null;
  },

  async refresh(companyId: string): Promise<ProcurementEngineOutput> {
    const output = await this.analyze({ companyId });
    await ExecutiveTwinEngine.setEngineSnapshot(companyId, this.engineId, output);
    return output;
  },
} as const;