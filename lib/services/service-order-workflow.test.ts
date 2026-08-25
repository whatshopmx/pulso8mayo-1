import { describe, expect, it } from "vitest";
import {
    actionTransitionError,
    conformityDenial,
    evidenceGuardError,
    quoteGuardError,
} from "./service-order-service";

describe("actionTransitionError", () => {
    it("schedule solo desde APPROVED", () => {
        expect(actionTransitionError("APPROVED", "schedule")).toBeNull();
        expect(actionTransitionError("DRAFT", "schedule")).toMatch(/aprobada/);
        expect(actionTransitionError("SCHEDULED", "schedule")).toMatch(/aprobada/);
    });

    it("start solo desde SCHEDULED", () => {
        expect(actionTransitionError("SCHEDULED", "start")).toBeNull();
        expect(actionTransitionError("APPROVED", "start")).toMatch(/programada/);
    });

    it("complete solo desde IN_PROGRESS", () => {
        expect(actionTransitionError("IN_PROGRESS", "complete")).toBeNull();
        expect(actionTransitionError("SCHEDULED", "complete")).toMatch(/ejecución/);
    });

    it("cancel desde estados no terminales con trabajo pendiente; no desde CLOSED", () => {
        for (const s of ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SCHEDULED"]) {
            expect(actionTransitionError(s, "cancel")).toBeNull();
        }
        expect(actionTransitionError("CLOSED", "cancel")).toMatch(/cancelar/);
        expect(actionTransitionError("CANCELLED", "cancel")).toMatch(/cancelar/);
        expect(actionTransitionError("REJECTED", "cancel")).toMatch(/cancelar/);
    });
});

describe("quoteGuardError", () => {
    it("solo se adjuntan en DRAFT", () => {
        expect(quoteGuardError("DRAFT")).toBeNull();
        for (const s of ["PENDING_APPROVAL", "APPROVED", "CLOSED"]) {
            expect(quoteGuardError(s)).toMatch(/borrador/);
        }
    });
});

describe("evidenceGuardError", () => {
    it("bloqueada solo en estados terminales", () => {
        for (const s of ["CLOSED", "REJECTED", "CANCELLED"]) {
            expect(evidenceGuardError(s)).toMatch(/evidencia/);
        }
        for (const s of ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SCHEDULED", "IN_PROGRESS", "PENDING_CONFORMITY"]) {
            expect(evidenceGuardError(s)).toBeNull();
        }
    });
});

describe("conformityDenial", () => {
    it("rol insuficiente → denegación ROLE aunque el estado sea correcto", () => {
        const denial = conformityDenial("SUPERVISOR", "PENDING_CONFORMITY");
        expect(denial?.kind).toBe("ROLE");
    });

    it("sin rol → denegación ROLE (fail closed)", () => {
        expect(conformityDenial(null, "PENDING_CONFORMITY")?.kind).toBe("ROLE");
        expect(conformityDenial(undefined, "PENDING_CONFORMITY")?.kind).toBe("ROLE");
    });

    it("estado incorrecto con rol suficiente → denegación STATUS", () => {
        expect(conformityDenial("GERENTE", "IN_PROGRESS")?.kind).toBe("STATUS");
        expect(conformityDenial("OWNER", "CLOSED")?.kind).toBe("STATUS");
        expect(conformityDenial("ADMIN", "DRAFT")?.kind).toBe("STATUS");
    });

    it("GERENTE+ en PENDING_CONFORMITY → permitido", () => {
        expect(conformityDenial("GERENTE", "PENDING_CONFORMITY")).toBeNull();
        expect(conformityDenial("ADMIN", "PENDING_CONFORMITY")).toBeNull();
        expect(conformityDenial("OWNER", "PENDING_CONFORMITY")).toBeNull();
        expect(conformityDenial("SUPER_ADMIN", "PENDING_CONFORMITY")).toBeNull();
    });
});
