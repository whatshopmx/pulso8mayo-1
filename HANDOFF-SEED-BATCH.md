# Handoff: Batch Insert Fix for Seed Scripts

## Problem

`pnpm seed` hangs because seed scripts do individual `db.insert()` calls inside loops, causing thousands of sequential DB round-trips (~10-50ms each) against Neon Postgres.

## Completed

- **`scripts/seed-05-workflows.ts`** — Batched instances, steps, assignments, event triggers
- **`scripts/seed-06-labor.ts`** — Batched plannedShifts, shiftSessions, breakLogs

## Remaining (by priority)

### 1. `scripts/seed-04-inventory.ts` (HIGH - ~300+ individual inserts)

**Bottlenecks:**

| Section | Lines | Individual inserts | What to do |
|---|---|---|---|
| inventoryItems | 112-130 | 30 | Collect array, `db.insert().values(allItems).returning()` |
| unitConversions | 133-141 | 8 | Collect array, single `db.insert().values()` |
| inventoryBatches | 153-183 | ~70 | Collect array, `db.insert().values(allBatches).returning()` — nested loop |
| inventoryMovements | 186-231 | ~90 | Collect array, single `db.insert().values()` — nested loop with 2 insert types |
| priceHistory | 233-253 | ~40 | Collect array, single `db.insert().values()` |
| inventoryAlerts | 260-281 | 8 | Collect array, single `db.insert().values()` |
| inventoryWaste | 285-310 | 7 | Collect array, single `db.insert().values()` |
| temperatureLogs | 385-401 | 24 | Collect array, single `db.insert().values()` |
| costRecords | 405-419 | 12 | Collect array, single `db.insert().values()` |

**Pattern (example for items):**
```typescript
// BEFORE (slow):
for (const item of ITEMS) {
  const [row] = await db.insert(inventoryItems).values({...}).returning({ id: inventoryItems.id });
  itemRows.push(row);
}

// AFTER (fast):
const itemValues = ITEMS.map(item => ({...}));
const itemRows = await db.insert(inventoryItems).values(itemValues).returning({ id: inventoryItems.id });
```

For `inventoryBatches` the nested loop indexing is complex — careful to maintain the `batchRows` array in the exact same order.

### 2. `scripts/seed-07-compliance-kpi.ts` (HIGH - ~324 inserts)

| Section | Lines | Individual inserts | What to do |
|---|---|---|---|
| incidents | 52-67 | 6 | Batch with `.returning()` |
| kpiDefinitions | 135-154 | 10 | Batch with `.returning()` |
| kpiHistory (30 days x 10 KPIs) | 157-181 | **300** | Collect array, single `db.insert().values()` |
| kpiSnapshotLogs | 191-207 | 4 | Batch |
| psychosocialSurveys | 211-238 | 4 | Batch |

### 3. `scripts/seed-08-hr-advanced.ts` (MEDIUM - ~67 inserts)

| Section | Lines | Inserts | What to do |
|---|---|---|---|
| performanceReviewCriteria | 61-71 | 8 | Batch with `.returning()` |
| performanceReviews | 77-105 | 4 | Batch with `.returning()` |
| **performanceReviewResponses** | **108-117** | **32** | **Nested loop — batch** |
| performanceGoals | 127-140 | 5 | Batch |
| vacationRequests | 148-164 | 3 | Batch |
| employeeTraining | 236-255 | 7 | Batch |
| leaveBalances | 213-223 | 4 | Batch |

### 4. `scripts/seed-10-final.ts` (MEDIUM - ~60 inserts)

| Section | Lines | Inserts | What to do |
|---|---|---|---|
| inventoryAuditLog | 112-128 | **55** | Batch |

### 5. `scripts/seed-01-foundation.ts` (LOW - ~42 inserts)
### 6. `scripts/seed-02-hr-profiles.ts` (LOW - ~61 inserts)
### 7. `scripts/seed-03-equipment.ts` (LOW - ~59 inserts)

Small enough to be < 1s each, but still worth batching for consistency. Follow same pattern.

## Key Pattern

```typescript
// Collect all values first
const values: any[] = [];
for (const item of items) {
  values.push({ field1: item.a, field2: item.b });
}

// Single batch insert
await db.insert(myTable).values(values);
// If returning IDs:
const rows = await db.insert(myTable).values(values).returning({ id: myTable.id });
```

**Important**: For loops that use `.returning()` to capture IDs and the ID is used later in the same loop (e.g., `equipmentCatalog` IDs used for `branchEquipments`), you must batch the first section completely before starting the dependent section.

## Verification

After all changes, run:
```bash
pnpm seed
```

Expected: all 10 phases complete in < 30 seconds (was hanging indefinitely before).
