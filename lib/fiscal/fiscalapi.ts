// Cliente FiscalAPI (CFDI 4.0) — SDK oficial `fiscalapi`.
//
// Contrato real de la API (docs.fiscalapi.com):
//   - Ambientes:  https://test.fiscalapi.com (pruebas, gratis)
//                 https://live.fiscalapi.com (producción)
//   - Autenticación: headers `X-API-KEY` + `X-TENANT-KEY`
//   - Recursos:   api/v4/invoices, api/v4/persons, api/v4/catalogs, ...
//
// Para activar el ambiente de pruebas (una sola vez):
//   1. Crear cuenta en https://test.fiscalapi.com y confirmar correo.
//   2. Activar suscripción de prueba con tarjeta de prueba
//      (Visa 4242 4242 4242 4242, cualquier fecha futura, CVC al azar).
//      Los timbres de prueba también se compran con esa tarjeta: no cuestan.
//   3. Copiar API Key (Developers » API Keys) y Tenant Key (perfil » TID).
//   4. Ponerlas en .env:
//        FISCALAPI_API_URL=https://test.fiscalapi.com
//        FISCALAPI_API_KEY=<api key>
//        FISCALAPI_TENANT=<tenant key>
//
// Personas y certificados de prueba del SAT: lib/fiscal/sat-test-data.ts
// (catálogo completo de docs.fiscalapi.com/testing-data).

import { FiscalapiClient } from "fiscalapi";
import { SAT_TEST_MORALES } from "./sat-test-data";

/**
 * Fecha del comprobante. Debe ser un **instante absoluto** (`Date`, que axios
 * serializa a ISO-UTC): las 6 primeras facturas de prueba pasaron así, mientras
 * que cadenas ingenuas en formato SAT las interpretó el backend con un tzdata
 * viejo (DST abolido de México aún activo → +1h) y el PAC las rechazó con
 * "401 - El rango de la fecha de generación no debe ser mayor a 72 horas".
 */
export type FechaComprobante = Date;

export type FiscalApiEnv = "test" | "production";

const TEST_BASE_URL = "https://test.fiscalapi.com";
const LIVE_BASE_URL = "https://live.fiscalapi.com";

export interface FiscalApiConfig {
  apiUrl: string;
  apiKey: string;
  tenant: string;
  env: FiscalApiEnv;
}

/**
 * Lee la configuración del entorno. `env` por defecto es `test`: nunca
 * producir facturas reales por omisión; producción es explícito.
 */
export function getFiscalApiConfig(): FiscalApiConfig | null {
  const apiKey = process.env.FISCALAPI_API_KEY;
  const tenant = process.env.FISCALAPI_TENANT;
  const env: FiscalApiEnv = process.env.FISCALAPI_ENV === "production" ? "production" : "test";
  const apiUrl = process.env.FISCALAPI_API_URL || (env === "production" ? LIVE_BASE_URL : TEST_BASE_URL);

  if (!apiKey || !tenant) return null;
  return { apiUrl, apiKey, tenant, env };
}

export function isFiscalApiConfigured(): boolean {
  return getFiscalApiConfig() !== null;
}

/** Cliente listo para usar, o error con instrucciones de alta. */
export function getFiscalApiClient(): FiscalapiClient {
  const config = getFiscalApiConfig();
  if (!config) {
    throw new Error(
      "FiscalAPI no configurado. Agrega FISCALAPI_API_KEY y FISCALAPI_TENANT a tu .env " +
        "(alta gratis en https://test.fiscalapi.com). Opcional: FISCALAPI_API_URL y FISCALAPI_ENV."
    );
  }
  return FiscalapiClient.create({
    apiUrl: config.apiUrl,
    apiKey: config.apiKey,
    tenant: config.tenant,
    timeZone: "America/Mexico_City",
  });
}

// ---------------------------------------------------------------------------
// Personas de prueba por defecto
// ---------------------------------------------------------------------------

/** Emisor de respaldo cuando el proveedor no tiene un RFC de prueba válido. */
export const DEFAULT_TEST_ISSUER = SAT_TEST_MORALES[0]; // EKU9003173C9 · Kemper Urgate

/**
 * Receptor por defecto (la empresa Pulso en pruebas). Se puede fijar otro RFC
 * del catálogo con FISCALAPI_COMPANY_TEST_TIN.
 */
export const DEFAULT_TEST_RECIPIENT = SAT_TEST_MORALES.find((p) => p.tin === "URE180429TM6")!;
