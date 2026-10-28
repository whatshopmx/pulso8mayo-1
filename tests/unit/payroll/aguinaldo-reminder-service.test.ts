import { describe, expect, it, vi } from "vitest";

// El servicio importa `@/lib/db` como cliente por defecto; las pruebas puras no
// abren conexiones. Se sustituye para que el módulo no cree un pool al cargar.
vi.mock("@/lib/db", () => ({ db: {} }));

import {
  ROLES_RECORDATORIO,
  clasificarEstadoAguinaldo,
  construirRecordatorio,
  esDestinatarioValido,
  type EstadoAguinaldoEmpresa,
} from "@/lib/services/aguinaldo-reminder-service";
import { hasPermission, type Role } from "@/lib/permissions";
import { hasAccess } from "@/lib/rbac/permissions";

/**
 * OPS-02.nomina.D — contrato del recordatorio de aguinaldo.
 *
 * Congela tres decisiones que el cron anterior no respetaba:
 *   1. Una corrida `COMPLETED` es TIMBRADO, no pago.
 *   2. Ningún aviso afirma que el aguinaldo esté pagado/dispersado.
 *   3. Los destinatarios son roles que el RBAC de rutas reconoce y que pueden
 *      ejecutar la nómina; `OWNER` no es uno de ellos.
 */

const estado = (parcial: Partial<EstadoAguinaldoEmpresa>): EstadoAguinaldoEmpresa => ({
  companyId: "company-1",
  anioFiscal: 2026,
  estado: "SIN_CORRIDA",
  estadoCorrida: null,
  timbradoCompleto: false,
  ...parcial,
});

describe("clasificarEstadoAguinaldo", () => {
  it("sin corrida no inventa un estado", () => {
    expect(clasificarEstadoAguinaldo(null)).toBe("SIN_CORRIDA");
  });

  it("COMPLETED es timbrado completo, no pago", () => {
    expect(clasificarEstadoAguinaldo("COMPLETED")).toBe("TIMBRADO");
  });

  it.each(["DRAFT", "PROCESSING", "ERROR", "COMPLETED_WITH_ERRORS"])(
    "%s sigue en proceso: el timbrado no terminó para todos",
    (estadoCorrida) => {
      expect(clasificarEstadoAguinaldo(estadoCorrida)).toBe("EN_PROCESO");
    },
  );
});

describe("construirRecordatorio", () => {
  it("sin corrida: avisa del plazo legal y del timbrado pendiente", () => {
    const aviso = construirRecordatorio(estado({ estado: "SIN_CORRIDA" }));
    expect(aviso.tipo).toBe("warning");
    expect(aviso.titulo).toContain("2026");
    expect(aviso.titulo).toContain("19 de diciembre");
    expect(aviso.mensaje).toMatch(/No hay corrida de aguinaldo 2026/);
    expect(aviso.mensaje).toMatch(/Art\. 87 LFT/);
  });

  it("en proceso: muestra el estado crudo y no declara pagado", () => {
    const aviso = construirRecordatorio(
      estado({ estado: "EN_PROCESO", estadoCorrida: "COMPLETED_WITH_ERRORS" }),
    );
    expect(aviso.tipo).toBe("warning");
    expect(aviso.mensaje).toContain("COMPLETED_WITH_ERRORS");
    expect(aviso.mensaje).toMatch(/no acredita el pago/i);
  });

  it("timbrado: separa explícitamente el CFDI de la entrega del dinero", () => {
    const aviso = construirRecordatorio(
      estado({ estado: "TIMBRADO", estadoCorrida: "COMPLETED", timbradoCompleto: true }),
    );
    expect(aviso.tipo).toBe("info");
    expect(aviso.titulo).toMatch(/timbrado/i);
    expect(aviso.titulo).toMatch(/sin confirmar/i);
    expect(aviso.mensaje).toMatch(/no puede confirmar el pago desde el CFDI/i);
    expect(aviso.mensaje).not.toMatch(/ya está dispersad|ya se pagó|pago confirmado/i);
  });

  it("la clave de dedupe distingue empresa, año y estado", () => {
    const a = construirRecordatorio(estado({ estado: "SIN_CORRIDA" }));
    const b = construirRecordatorio(
      estado({ estado: "TIMBRADO", estadoCorrida: "COMPLETED", timbradoCompleto: true }),
    );
    const otraEmpresa = construirRecordatorio(
      estado({ companyId: "company-2", estado: "SIN_CORRIDA" }),
    );

    expect(a.dedupe).toBe("aguinaldo-company-1-2026-SIN_CORRIDA");
    expect(b.dedupe).toBe("aguinaldo-company-1-2026-TIMBRADO");
    expect(otraEmpresa.dedupe).toBe("aguinaldo-company-2-2026-SIN_CORRIDA");
    expect(new Set([a.dedupe, b.dedupe, otraEmpresa.dedupe]).size).toBe(3);
  });

  it("todos los estados usan el mismo evento de notificación", () => {
    const avisos = [
      construirRecordatorio(estado({ estado: "SIN_CORRIDA" })),
      construirRecordatorio(estado({ estado: "EN_PROCESO", estadoCorrida: "ERROR" })),
      construirRecordatorio(
        estado({ estado: "TIMBRADO", estadoCorrida: "COMPLETED", timbradoCompleto: true }),
      ),
    ];
    expect(new Set(avisos.map((a) => a.eventType))).toEqual(
      new Set(["aguinaldo_dispersion_reminder"]),
    );
  });
});

describe("destinatarios del recordatorio", () => {
  it("cada destinatario existe en UserRole, puede ejecutar nómina y abrir la pantalla", () => {
    for (const role of ROLES_RECORDATORIO) {
      expect(hasPermission(role as Role, "reports", "manage"), role).toBe(true);
      expect(hasAccess(role, "/dashboard/labor/payroll"), role).toBe(true);
    }
  });

  it("no depende de OWNER: el rol existe en la DB pero no en el RBAC de rutas", () => {
    expect(ROLES_RECORDATORIO).not.toContain("OWNER" as never);
    expect(esDestinatarioValido("OWNER")).toBe(false);
    // OWNER sí está en la matriz de permisos: la brecha es de UserRole/rutas.
    expect(hasPermission("OWNER", "reports", "manage")).toBe(true);
  });

  it("roles sin reports:manage no reciben el aviso aunque abran la pantalla", () => {
    for (const role of ["GERENTE", "SUPERVISOR", "EMPLEADO", "READONLY"]) {
      expect(esDestinatarioValido(role), role).toBe(false);
    }
  });

  it("un rol desconocido falla cerrado", () => {
    expect(esDestinatarioValido("DIRECTOR_OPS")).toBe(false);
  });
});
