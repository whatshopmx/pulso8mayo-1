import { db } from "@/lib/db";
import { 
  operationalTwins, 
  corporateTwins, 
  workflowInstances, 
  inventoryMovements, 
  inventoryItems,
  productionResults,
  productionIngredients,
  shiftSessions,
  temperatureLogs,
  costRecords,
  incidents,
  branches,
  operationalTwinStateEnum
} from "@/lib/db/schema";
import { eq, and, gte, inArray, ne, sql } from "drizzle-orm";

/**
 * Recalculates the Operational Twin state and scores for a specific branch location.
 * Evaluates execution, inventory, recipe, labor, quality, and finance signals over the last 7 days.
 */
export async function recalculateTwin(branchId: string): Promise<any> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  // 1. Fetch current twin or create one
  let twin = await db.query.operationalTwins.findFirst({
    where: eq(operationalTwins.branchId, branchId),
  });

  if (!twin) {
    const [newTwin] = await db
      .insert(operationalTwins)
      .values({
        branchId,
        currentState: "CREATE",
        healthScore: 100,
        driftScore: 0,
        marginLeakageScore: 0,
        confidenceScore: 100,
      })
      .returning();
    twin = newTwin;
  }

  // ── Dimension 1: Execution (Workflows & Checklists) ──
  const wfInstances = await db
    .select({
      id: workflowInstances.id,
      status: workflowInstances.status,
      dueDate: workflowInstances.dueDate,
    })
    .from(workflowInstances)
    .where(
      and(
        eq(workflowInstances.branchId, branchId),
        gte(workflowInstances.createdAt, sevenDaysAgo)
      )
    );

  const wfScheduled = wfInstances.length;
  const wfCompleted = wfInstances.filter((w) => w.status === "COMPLETED").length;
  const wfOverdue = wfInstances.filter(
    (w) =>
      w.status === "OVERDUE" ||
      (w.status === "PENDING" && w.dueDate && w.dueDate < new Date())
  ).length;

  const completionRate = wfScheduled > 0 ? Math.round((wfCompleted / wfScheduled) * 100) : 100;
  const executionState = {
    scheduled: wfScheduled,
    completed: wfCompleted,
    overdue: wfOverdue,
    completionRate,
  };

  // ── Dimension 2: Inventory ──
  const movements = await db
    .select({
      type: inventoryMovements.type,
      quantityChange: inventoryMovements.quantityChange,
      lastCost: inventoryItems.lastCost,
    })
    .from(inventoryMovements)
    .innerJoin(inventoryItems, eq(inventoryMovements.itemId, inventoryItems.id))
    .where(
      and(
        eq(inventoryMovements.branchId, branchId),
        gte(inventoryMovements.timestamp, sevenDaysAgo)
      )
    );

  let wasteCostCents = 0;
  let adjustmentCostCents = 0;

  for (const m of movements) {
    const cost = Math.abs(Number(m.quantityChange)) * (m.lastCost || 0);
    if (m.type === "WASTE") {
      wasteCostCents += cost;
    } else if (m.type === "ADJUSTMENT") {
      adjustmentCostCents += cost;
    }
  }

  const totalVarianceCents = wasteCostCents + adjustmentCostCents;
  const inventoryState = {
    wasteCostCents,
    adjustmentCostCents,
    totalVarianceCents,
  };

  // ── Dimension 3: Recipes ──
  const prodResults = await db
    .select({ id: productionResults.id })
    .from(productionResults)
    .where(
      and(
        eq(productionResults.branchId, branchId),
        gte(productionResults.productionDate, sevenDaysAgo)
      )
    );

  let theoreticalVsActualCostCents = 0;
  let totalIngredientsChecked = 0;
  let compliantIngredients = 0;

  if (prodResults.length > 0) {
    const resultIds = prodResults.map((r) => r.id);
    const ingredients = await db
      .select({
        expectedQuantity: productionIngredients.expectedQuantity,
        actualQuantity: productionIngredients.actualQuantity,
        unitCost: productionIngredients.unitCost,
      })
      .from(productionIngredients)
      .where(inArray(productionIngredients.resultId, resultIds));

    totalIngredientsChecked = ingredients.length;
    for (const ing of ingredients) {
      // A7b: las cantidades son `numeric(12,4)` y llegan como string.
      const diff = Number(ing.actualQuantity) - Number(ing.expectedQuantity);
      theoreticalVsActualCostCents += diff * (ing.unitCost || 0);
      if (diff === 0) {
        compliantIngredients++;
      }
    }
  }

  const recipeCompliance =
    totalIngredientsChecked > 0
      ? Math.round((compliantIngredients / totalIngredientsChecked) * 100)
      : 100;

  const recipeState = {
    recipeCompliance,
    theoreticalVsActualCostCents,
  };

  // ── Dimension 4: Labor ──
  const sessions = await db
    .select({
      status: shiftSessions.status,
      lateMinutes: shiftSessions.lateMinutes,
      overtimeMinutes: shiftSessions.overtimeMinutes,
    })
    .from(shiftSessions)
    .where(
      and(
        eq(shiftSessions.branchId, branchId),
        gte(shiftSessions.startedAt, sevenDaysAgo)
      )
    );

  const totalSessions = sessions.length;
  const noShows = sessions.filter((s) => s.status === "NO_SHOW").length;
  const attendanceRate =
    totalSessions > 0 ? Math.round(((totalSessions - noShows) / totalSessions) * 100) : 100;
  const totalLateMinutes = sessions.reduce((acc, s) => acc + (s.lateMinutes || 0), 0);
  const totalOvertimeMinutes = sessions.reduce((acc, s) => acc + (s.overtimeMinutes || 0), 0);
  
  // Overtime rate estimation: ~250 cents per minute ($150 MXN/hr)
  const overtimeCostCents = totalOvertimeMinutes * 250;

  const laborState = {
    attendanceRate,
    totalLateMinutes,
    totalOvertimeMinutes,
    overtimeCostCents,
  };

  // ── Dimension 5: Quality & Compliance ──
  const tempLogs = await db
    .select({ isCompliant: temperatureLogs.isCompliant })
    .from(temperatureLogs)
    .where(
      and(
        eq(temperatureLogs.branchId, branchId),
        gte(temperatureLogs.timestamp, sevenDaysAgo)
      )
    );

  const totalTemps = tempLogs.length;
  const compliantTemps = tempLogs.filter((t) => t.isCompliant).length;
  const tempComplianceRate = totalTemps > 0 ? Math.round((compliantTemps / totalTemps) * 100) : 100;

  const activeIncidents = await db
    .select({ id: incidents.id })
    .from(incidents)
    .where(and(eq(incidents.branchId, branchId), ne(incidents.status, "RESOLVED")));

  const qualityState = {
    tempComplianceRate,
    activeIncidentsCount: activeIncidents.length,
  };

  // ── Dimension 6: Finance ──
  const costs = await db
    .select({ amount: costRecords.amount })
    .from(costRecords)
    .where(
      and(
        eq(costRecords.branchId, branchId),
        gte(costRecords.recordedAt, sevenDaysAgo)
      )
    );

  const totalExpensesCents = costs.reduce((acc, c) => acc + c.amount, 0);
  const financeState = {
    totalExpensesCents,
  };

  // ── Dimension Scores (0-100) ──
  const executionScore = completionRate;
  const inventoryScore = Math.max(0, 100 - Math.round(totalVarianceCents / 1000));
  const recipeScore = Math.max(0, 100 - Math.round(Math.abs(theoreticalVsActualCostCents) / 500));
  const laborScore = Math.max(0, 100 - (totalLateMinutes + totalOvertimeMinutes));
  const qualityScore = Math.max(0, tempComplianceRate - activeIncidents.length * 10);
  const financeScore = 100;
  const maintenanceScore = 100;
  const complianceScore = 100;
  const customerExperienceScore = 100;

  // ── Weighted Health Calculation ──
  const healthScore = Math.round(
    executionScore * 0.25 +
      inventoryScore * 0.20 +
      recipeScore * 0.15 +
      qualityScore * 0.15 +
      laborScore * 0.10 +
      financeScore * 0.10 +
      maintenanceScore * 0.05
  );

  const driftScore = 100 - healthScore;

  // ── Margin Leakage calculation (in cents) ──
  const marginLeakageScore =
    totalVarianceCents +
    Math.max(0, theoreticalVsActualCostCents) +
    overtimeCostCents +
    wfOverdue * 2000;

  // ── Confidence score (data coverage) ──
  const hasExecution = wfScheduled > 0 ? 1 : 0;
  const hasInventory = movements.length > 0 ? 1 : 0;
  const hasTemps = totalTemps > 0 ? 1 : 0;
  const hasLabor = totalSessions > 0 ? 1 : 0;
  const confidenceScore = Math.round(((hasExecution + hasInventory + hasTemps + hasLabor) / 4) * 100);

  // ── State Machine Transitions ──
  let nextState: typeof operationalTwinStateEnum.enumValues[number] = "ACTIVE";
  const prevState = twin.currentState;

  if (healthScore >= 85) {
    nextState = "ACTIVE";
  } else if (healthScore >= 70) {
    if (prevState === "CRITICAL" || prevState === "RECOVERING") {
      nextState = "RECOVERING";
    } else {
      nextState = "DEGRADING";
    }
  } else {
    nextState = "CRITICAL";
  }

  // 2. Persist projected Operational Twin values
  const [updatedTwin] = await db
    .update(operationalTwins)
    .set({
      currentState: nextState,
      healthScore,
      driftScore,
      marginLeakageScore,
      confidenceScore,
      executionState,
      inventoryState,
      recipeState,
      laborState,
      qualityState,
      financeState,
      maintenanceState: {},
      complianceState: {},
      customerExperienceState: {},
      lastUpdated: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(operationalTwins.id, twin.id))
    .returning();

  return updatedTwin;
}

/**
 * Aggregates all branch twin states for a company to calculate the Corporate Twin state.
 */
export async function recalculateCorporateTwin(companyId: string): Promise<any> {
  // Get all branches of the company
  const compBranches = await db
    .select({ id: branches.id })
    .from(branches)
    .where(eq(branches.companyId, companyId));

  if (compBranches.length === 0) return null;

  const branchIds = compBranches.map((b) => b.id);

  // Fetch twins for all company branches
  const twins = await db
    .select()
    .from(operationalTwins)
    .where(inArray(operationalTwins.branchId, branchIds));

  if (twins.length === 0) return null;

  // Aggregate metrics
  const totalHealth = twins.reduce((acc, t) => acc + t.healthScore, 0);
  const totalDrift = twins.reduce((acc, t) => acc + t.driftScore, 0);
  const totalLeakage = twins.reduce((acc, t) => acc + t.marginLeakageScore, 0);

  const averageHealth = Math.round(totalHealth / twins.length);
  const averageDrift = Math.round(totalDrift / twins.length);

  // Benchmarking and risk analysis
  const sortedByHealth = [...twins].sort((a, b) => b.healthScore - a.healthScore);
  const bestPerformingBranchId = sortedByHealth[0]?.branchId || null;
  const lowestPerformingBranchId = sortedByHealth[sortedByHealth.length - 1]?.branchId || null;

  // Shared risks (e.g. check how many branches have an inventory score < 80)
  const lowInventoryCount = twins.filter((t) => {
    const inv = t.inventoryState as Record<string, any>;
    const score = Math.max(0, 100 - Math.round((inv?.totalVarianceCents || 0) / 1000));
    return score < 80;
  }).length;

  const sharedRisks = [];
  if (lowInventoryCount / twins.length >= 0.5) {
    sharedRisks.push({
      riskType: "SYSTEMIC_INVENTORY_VARIANCE",
      description: "Over 50% of branches display high inventory variance levels.",
      severity: "WARNING",
    });
  }

  const networkState = {
    branchCount: twins.length,
    bestPerformingBranchId,
    lowestPerformingBranchId,
    sharedRisks,
  };

  // Find corporate twin row or create it
  let corpTwin = await db.query.corporateTwins.findFirst({
    where: eq(corporateTwins.companyId, companyId),
  });

  if (!corpTwin) {
    const [newCorpTwin] = await db
      .insert(corporateTwins)
      .values({
        companyId,
        healthScore: averageHealth,
        driftScore: averageDrift,
        marginLeakageScore: totalLeakage,
        networkState,
      })
      .returning();
    return newCorpTwin;
  }

  const [updatedCorpTwin] = await db
    .update(corporateTwins)
    .set({
      healthScore: averageHealth,
      driftScore: averageDrift,
      marginLeakageScore: totalLeakage,
      networkState,
      lastUpdated: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(corporateTwins.id, corpTwin.id))
    .returning();

  return updatedCorpTwin;
}
