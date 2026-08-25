// lib/services/__tests__/expiration-alert.test.ts
// Task 2 (plan loteprod-gaps): alertas escalonadas de caducidad — manual
// loteprod.md §5.4.
//
// Contratos congelados aquí:
//   - Vencido (fecha <= ahora)            → EXPIRED  (bloqueo FEFO + merma obligatoria)
//   - Vence en ≤24h                       → H24      (urgente + uso/promoción)
//   - Vence en ≤48h y >24h                → H48      (aviso al gerente)
//   - Vence en >48h                       → null     (fuera de vigilancia)
//   - Límites inclusive hacia la ventana más urgente (exactamente 24h ⇒ H24)
//   - Contenido de notificación por ventana con severidad escalonada

import { describe, expect, it } from "vitest";
import {
    classifyExpirationWindow,
    buildExpirationNotification,
} from "../expiration-alert-service";

const NOW = new Date("2026-08-26T12:00:00.000Z");

function hoursFromNow(h: number): Date {
    return new Date(NOW.getTime() + h * 3_600_000);
}

describe("classifyExpirationWindow", () => {
    it("fecha pasada → EXPIRED", () => {
        expect(classifyExpirationWindow(hoursFromNow(-1), NOW)).toBe("EXPIRED");
        expect(classifyExpirationWindow(hoursFromNow(-72), NOW)).toBe("EXPIRED");
    });

    it("vencimiento exactamente ahora → EXPIRED (inclusive)", () => {
        expect(classifyExpirationWindow(NOW, NOW)).toBe("EXPIRED");
    });

    it("23h59m → H24", () => {
        expect(classifyExpirationWindow(hoursFromNow(23.98), NOW)).toBe("H24");
    });

    it("exactamente 24h → H24 (límite inclusive hacia la ventana urgente)", () => {
        expect(classifyExpirationWindow(hoursFromNow(24), NOW)).toBe("H24");
    });

    it("24h+1s y 47h59m → H48", () => {
        expect(classifyExpirationWindow(new Date(NOW.getTime() + 24 * 3_600_000 + 1), NOW)).toBe("H48");
        expect(classifyExpirationWindow(hoursFromNow(47.99), NOW)).toBe("H48");
    });

    it("exactamente 48h → H48", () => {
        expect(classifyExpirationWindow(hoursFromNow(48), NOW)).toBe("H48");
    });

    it("48h+1s y 7 días → null (fuera de las ventanas vigiladas)", () => {
        expect(classifyExpirationWindow(new Date(NOW.getTime() + 48 * 3_600_000 + 1), NOW)).toBeNull();
        expect(classifyExpirationWindow(hoursFromNow(24 * 7), NOW)).toBeNull();
    });
});

describe("buildExpirationNotification — severidad escalonada", () => {
    const item = { name: "Pollo crudo", lot: "L-001", qty: 4, unit: "kg" };

    it("H48 → MEDIA, aviso de planificación FEFO", () => {
        const n = buildExpirationNotification("H48", item.name, item.lot, item.qty, item.unit);
        expect(n.severity).toBe("MEDIA");
        expect(n.message).toContain("≤48 horas");
        expect(n.message).toContain("Pollo crudo");
        expect(n.message).toContain("lote L-001");
        expect(n.message).toContain("4 kg");
    });

    it("H24 → ALTA, urgente con sugerencia de uso/promoción", () => {
        const n = buildExpirationNotification("H24", item.name, null, item.qty, item.unit);
        expect(n.severity).toBe("ALTA");
        expect(n.message).toContain("URGENTE");
        expect(n.message).toContain("promoci");
        // sin lote no debe colar "lote undefined"
        expect(n.message).not.toContain("undefined");
    });

    it("EXPIRED → CRITICA, merma obligatoria y bloqueo FEFO", () => {
        const n = buildExpirationNotification("EXPIRED", item.name, item.lot, item.qty, item.unit);
        expect(n.severity).toBe("CRITICA");
        expect(n.message).toContain("merma");
        expect(n.message.toLowerCase()).toContain("bloqueado");
    });
});
