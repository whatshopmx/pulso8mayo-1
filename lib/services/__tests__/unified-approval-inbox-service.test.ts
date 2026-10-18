import { describe, expect, it } from "vitest";
import {
    mergeInbox,
    mapInboxItem,
    SOURCE_LABEL,
    type UnifiedApprovalItem,
} from "../unified-approval-inbox-service";
import type { InboxItem } from "../approval-matrix-service";

function inboxItem(overrides: Partial<InboxItem> = {}): InboxItem {
    return {
        requestId: "req-1",
        docType: "OC",
        docId: "doc-1",
        level: 1,
        requiredRole: "GERENTE",
        minQuotes: 2,
        requestedAt: new Date("2026-02-01T10:00:00Z"),
        folio: "OC-100",
        docStatus: "PENDING",
        amountCents: 150000,
        branchId: "branch-1",
        branchName: "Condesa",
        costCenterId: null,
        costCenterCode: null,
        costCenterName: null,
        requestedBy: "user-1",
        docCreatedAt: new Date("2026-02-01T09:00:00Z"),
        docTypeLabel: "STOCK",
        urgency: null,
        isEmergency: false,
        scope: null,
        notes: null,
        ...overrides,
    };
}

function unifiedItem(overrides: Partial<UnifiedApprovalItem> = {}): UnifiedApprovalItem {
    return {
        id: "EXPENSE:doc-2",
        source: "EXPENSE",
        sourceLabel: SOURCE_LABEL.EXPENSE,
        docId: "doc-2",
        title: "Renta — enero",
        amountCents: 2000000,
        requesterName: null,
        requiredRole: "ADMIN",
        createdAt: new Date("2026-02-02T10:00:00Z"),
        branchId: null,
        branchName: null,
        actionHref: "/dashboard/finance/expenses?focus=doc-2",
        ...overrides,
    };
}

describe("mapInboxItem", () => {
    it("genera enlace profundo al detalle de OC", () => {
        const item = mapInboxItem(inboxItem());
        expect(item.actionHref).toBe("/dashboard/inventory/purchase-orders/doc-1");
        expect(item.source).toBe("OC");
        expect(item.id).toBe("OC:req-1");
        expect(item.title).toContain("OC-100");
    });

    it("genera enlace profundo al detalle de OS", () => {
        const item = mapInboxItem(inboxItem({ docType: "OS", requestId: "req-2", docId: "doc-9" }));
        expect(item.actionHref).toBe(
            "/dashboard/equipment/compliance/service-orders/doc-9"
        );
        expect(item.source).toBe("OS");
        expect(item.id).toBe("OS:req-2");
    });
});

describe("mergeInbox", () => {
    it("ordena cronológicamente (más viejo primero)", () => {
        const merged = mergeInbox([
            [unifiedItem({ id: "EXPENSE:new", createdAt: new Date("2026-03-01") })],
            [unifiedItem({ id: "PAYMENT_RUN:old", createdAt: new Date("2026-01-01") })],
            [unifiedItem({ id: "EXPENSE:mid", createdAt: new Date("2026-02-01") })],
        ]);
        expect(merged.map((i) => i.id)).toEqual([
            "PAYMENT_RUN:old",
            "EXPENSE:mid",
            "EXPENSE:new",
        ]);
    });

    it("deduplica por llave única entre fuentes", () => {
        const merged = mergeInbox([
            [unifiedItem({ id: "EXPENSE:a" })],
            [unifiedItem({ id: "EXPENSE:a" })],
        ]);
        expect(merged).toHaveLength(1);
    });

    it("acepta una lista vacía de todas las fuentes", () => {
        expect(mergeInbox([[], [], []])).toEqual([]);
    });
});
