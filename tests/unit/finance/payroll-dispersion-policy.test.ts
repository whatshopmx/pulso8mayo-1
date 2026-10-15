import { describe, expect, it } from "vitest";
import { politicaPorCampo } from "@/lib/company/operating-policy-catalog";
import { DEFAULT_TENANT_OPERATING_CONFIG } from "@/lib/services/tenant-config-service";

/**
 * C21 — Política de dispersión de nómina (`payrollDispersion`).
 *
 * Hallazgo H04: Las siete dimensiones se capturaban en UI prometiendo efectos operativos
 * no soportados por el backend.
 *
 * Criterios de aceptación C21:
 *  1. La UI y el catálogo no prometen pagos automatizados ni transferencias bancarias
 *     que el producto no ejecuta (no existe dispersión directa hacia cuentas bancarias).
 *  2. El comportamiento definido respeta empresa, sucursal y permisos:
 *     - Permiso exigido para modificar la política: `settings/update`.
 *     - Alcance declarado a nivel Grupo/Tenant.
 *     - Las operaciones reales de nómina (cálculo, timbrado, exportación y programación en tesorería)
 *       se acotan por `companyId` y verifican pertenencia.
 *  3. Cada modalidad (CONSOLIDADA, POR_RAZON_SOCIAL, MIXTO) demuestra su resultado
 *     honesto como clasificación descriptiva sin ejecutar ni prometer transferencias de dinero real.
 */
describe("C21 — Política de dispersión de nómina (payrollDispersion)", () => {
  const politica = politicaPorCampo("payrollDispersion");

  it("está registrada en el catálogo oficial de políticas operativas", () => {
    expect(politica).toBeDefined();
    expect(politica?.campo).toBe("payrollDispersion");
    expect(politica?.input).toBe("payrollDispersion");
    expect(politica?.seccion).toBe("dimension");
    expect(politica?.grupo).toBe("Tesorería y Dispersión de Pagos");
  });

  it("mantiene clasificación 'descriptiva' y carece de consumidor operativo directo", () => {
    expect(politica?.clasificacion).toBe("descriptiva");
    expect(politica?.consumidor).toBeNull();
    expect(politica?.consumidores).toBeUndefined();
  });

  it("exige permiso 'settings/update' y alcance de Grupo", () => {
    expect(politica?.permiso).toBe("settings/update");
    expect(politica?.alcance).toBe("Grupo");
  });

  it("declara explícitamente que no envía dinero real ni ejecuta dispersión bancaria autónoma", () => {
    expect(politica?.aplicacion).toMatch(/m[oó]dulo de n[oó]mina/i);
    expect(politica?.aplicacion).toMatch(/no ejecuta dispersi[oó]n bancaria/i);
    expect(politica?.excepciones).toMatch(/ni activa pagos/i);
  });

  it("documenta las tres opciones honestamente sin prometer pagos automatizados", () => {
    const valores = politica?.valores.map((v) => v.valor);
    expect(valores).toEqual(["CONSOLIDADA", "POR_RAZON_SOCIAL", "MIXTO"]);

    for (const val of politica!.valores) {
      // Cada valor debe ser descriptivo (caso null)
      expect(val.caso).toBeNull();
      expect(val.titulo).toBeTruthy();
    }
  });

  it("posee el valor por omisión 'CONSOLIDADA' en la configuración base", () => {
    expect(DEFAULT_TENANT_OPERATING_CONFIG.payrollDispersion).toBe("CONSOLIDADA");
    expect(politica?.vacio).toMatch(/default `CONSOLIDADA`/i);
  });

  it("registra la decisión de negocio sobre dispersión bancaria y trazabilidad", () => {
    expect(politica?.decisionPendiente).toBeDefined();
    expect(politica?.decisionPendiente).toMatch(/C21/);
    expect(politica?.decisionPendiente).toMatch(/no cuenta con integración de dispersión bancaria directa/i);
    expect(politica?.decisionPendiente).toMatch(/sin enviar dinero real/i);
  });
});
