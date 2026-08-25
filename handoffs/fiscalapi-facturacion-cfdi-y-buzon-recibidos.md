# Handoff — FiscalAPI: facturación CFDI de prueba + buzón de facturas recibidas (COMPLETADO en sandbox)

**Fecha:** sesión 2026-08-24/25
**Repositorio:** `C:/Users/david/pulso29` — Pulso HORECA (Next.js 16 App Router, TypeScript, Drizzle + Neon)
**Commit base:** `dd66afa` feat(fiscal): facturación CFDI 4.0 de OCs y gastos vía FiscalAPI
**Estado:** ✅ Emisión CFDI de OCs/gastos end-to-end (4/4 timbradas). ✅ Buzón (descarga masiva SAT) FUNCIONANDO en sandbox: persona+FIEL+regla+solicitud+metadatos+conciliación contra OCs y gastos. Pendiente sólo la variante producción (ver §5).
**Credenciales:** `FISCALAPI_API_KEY`, `FISCALAPI_TENANT`, `FISCALAPI_API_URL=https://test.fiscalapi.com`, `FISCALAPI_ENV=test` en `.env` (no trackeado).

---

## 1. Resumen para retomar

La petición del usuario fue probar FiscalAPI para facturar órdenes de compra y gastos operativos con datos de prueba, y luego **giró al caso realista multitenant**: los proveedores NUNCA comparten su CSD (es su firma de facturación), así que lo que corresponde a Pulso es el lado receptor — el "buzón" de facturas recibidas vía **descarga masiva del SAT** (reglas + solicitudes + metadatos/XMLs), autenticada con la **FIEL/e.firma propia**, no con CSDs ajenos.

Lo ya logrado está detallado abajo. **El flujo del buzón se corre con:**

```bash
npx tsx scripts/test-fiscalapi-buzon.ts                # OC → buzón → concilia
npx tsx scripts/test-fiscalapi-buzon.ts --gasto <id>   # ídem con gasto operativo
npx tsx scripts/seed-gasto-demo.ts                     # crea payee+gasto demo si faltan
```

**Convención de trabajo:** los scripts de diagnóstico `scripts/__diag-*.ts` son desechables pero útiles — no commitearlos.

---

## 2. Arquitectura conceptual acordada con el usuario

```
PROVEEDOR (su infraestructura, SU CSD — jamás compartido)     PULSO (este tenant FiscalAPI)
──────────────────────────────────────────────────────       ──────────────────────────────
Emite CFDI hacia el RFC receptor de Pulso            ──SAT──→ Llega al buzón del RFC
En pruebas se SIMULA con los CSD públicos                     Se baja por DESCARGA MASIVA
de prueba del SAT (docs.fiscalapi.com/                        usando LA FIEL DE PULSO
testing-data: existen exactamente para esto)                  (e.firma ≠ CSD: firma
                                                              solicitudes, no facturas)
                                                              → conciliación contra OC/gasto
```

- **Lado emisor** = simulación de pruebas. Ya funciona (sección 3).
- **Lado receptor (buzón)** = la función de producto realista que el usuario quiere ver. En curso (sección 4-5).

---

## 3. LO QUE YA FUNCIONA (commiteado en `dd66afa`)

### Archivos clave
| Archivo | Qué hace |
|---|---|
| `lib/fiscal/fiscalapi.ts` | Cliente SDK oficial (`fiscalapi@4.0.387`), config por env, fecha −2h |
| `lib/fiscal/sat-test-data.ts` | Catálogo de 26 personas de prueba del SAT; `loadCsdForTin()`, `loadFielForTin()` (esta última SIN commitear) |
| `lib/services/fiscal-invoicing-service.ts` | OC/gasto → CFDI por valores; verifica total vs anexo 20; reintento dedup |
| `lib/services/fiscal-service.ts` | `validateInvoice` migrada al contrato v4 real; nómina intacta (10/10 specs) |
| `scripts/test-fiscalapi.ts` | `pnpm test:fiscalapi --dry-run \| --live` |
| `scripts/seed-fiscalapi-test-rfcs.ts` | Asigna RFCs de prueba a proveedores/payees (idempotente) |

### Proveedores demo con RFCs de prueba asignados (ya en BD)
Distribuidora de Alimentos→EKU9003173C9 · Carnes Selectas→IIA040805DZ4 · Licores→H&E951128469 · Lácteos→IVD920810GU2 · Frutas y Verduras→IXS7607092R5 · Equipamiento→JES900109Q90

### Última corrida live: 4/4 TIMBRADAS
PO-2026-0551 (EKU, $440.64) · PO-2026-0491 (IIA, $1470) · PO-2026-0361 (IXS, $369) · GASTO renta sucursal ($20000). Reporte en `scratch/fiscalapi-test-report.json`.

### Fixes técnicos descubiertos en live (críticos, ya en código)
1. **ItemSku obligatorio** en modo por valores → `skuDeLinea()` genera `PLS-<id>` determinista.
2. **TasaOCuota textual**: el PAC rechaza `0.16` numérico (CFDI40179); enviar string `"0.160000"`.
3. **Fecha con margen −2h**: los nodos del sandbox desplazan hasta +1h la fecha de emisión (tzdata viejo con DST abolido); el rango PAC es [−72h, +5min] así que pasado moderado pasa siempre. NO usar fechas ingenuas `AAAA-MM-DDThh:mm:ss`.
4. **Dedup de contenido**: reintentar un CFDI idéntico da "A record with the same unique values already exists" → `stamp()` reintenta variando la serie.
5. Errores HTTP llegan como texto axios genérico → extraer cuerpo real de `response.details`.

---

## 4. BUZÓN — RESUELTO (commiteado)

### Archivos
| Archivo | Qué hace |
|---|---|
| `lib/services/fiscal-buzon-service.ts` (**nuevo**) | persona receptora, FIEL, regla, solicitud, metadatos, simulación de emisión por referencias, conciliación |
| `lib/fiscal/sat-test-data.ts` (**modificado**) | agregó `loadFielForTin()` (fileType 2=cert FIEL, 3=key FIEL) |
| `tests/fixtures/fiscalapi-certs/URE180429TM6/fiel.cer\|fiel.key` (**nuevos**) | e.firma de prueba del receptor (públicas del SAT/SW) |
| `scripts/test-fiscalapi-buzon.ts` (**nuevo**) | orquestador de 5 pasos; flags `--gasto <id>`, `--sin-timbrar`, `--dias N`, `--valores` |
| `scripts/seed-gasto-demo.ts` (**nuevo**) | payee "Luces & Obras Servicios" (L&O950913MSA) + gasto MANTENIMIENTO $1,160 idempotente |

### Hallazgos de live que explican TODO el diseño (validados contra test.fiscalapi.com)
1. **`createTestRule()` crea UNA REGLA Y UNA SOLICITUD juntas** y devuelve `ApiResponse<DownloadRequest>`: el id que devuelve ES el de la SOLICITUD (real), NO el de la regla. El id de la regla se resuelve SIEMPRE con `downloadRules.getList()` (ordena más-nueva-primero). El 404 original fue pasar el id-solicitud como `downloadRuleId`.
2. **Sandbox bloquea la descarga masiva real**: `downloadRequests.create` manual → 403 *"La descarga masiva de XML solo está disponible en producción"* (y `downloadRules.create` → 403 de cuota/módulo en tenant free). Único camino: `createTestRule()`.
3. **El simulador del sandbox SÓLO refleja facturas POR REFERENCIAS entre personas del tenant.** Las por-valores (las OCs timbradas con fiscal-invoicing-service) NUNCA aparecen en metadatos. Por eso el orquestador simula la emisión del proveedor por referencias.
4. **Receta para total exacto por referencias**: una línea `{id: producto, quantity: 1, unitPrice: subtotal}`; el IVA lo impone el PRODUCTO (`satTaxObjectId`: "02"=con IVA 16%, "01"=sin impuestos). Los overrides por línea (`taxObjectCode`, `itemTaxes`) son IGNORADOS por el API. Con una sola línea el redondeo cae exacto al centavo vs la OC.
5. **Estado anidado**: `getById` devuelve `satRequestStatus:{id:"3",description:"Terminada"}` como objeto, no campo plano. `Terminada`+`Completada` llegan juntos casi instantáneo en sandbox.
6. **Monto del metadata**: campo `amount` (pesos con impuestos). No existen `total` ni `monto` en la respuesta real.
7. **Email/persona**: el username derivado del RFC no puede llevar `+` ni `&` (validator de FiscalAPI) → emails sanitizados a `[a-z0-9]`.
8. Precondición de `createTestRule`: al menos una factura por referencias entre dos personas del tenant ("No hay facturas en el tenant actual para simular la descarga masiva XML").

### Corridas exitosas
- OC PO-2026-0361 (IXS7607092R5, $369 sin IVA) → timbrada por referencias → metadata `$369` → conciliada a OC de Frutas y Verduras La Huerta.
- Gasto MANTENIMIENTO $1,160 (payee L&O950913MSA) → timbrado por referencias ($1,000+IVA exacto) → metadata `$1160` → conciliado a payee + descripción del gasto.
- Buzón acumulado: 24c31a82 ($348, la primera por-referencias) + las anteriores.

---

## 5. PRÓXIMOS PASOS (ordenados)

1. ~~Crear solicitud con el id REAL de la regla~~ ✅ HECHO — ver §4.
2. ~~Poll TERMINADA + metadatos~~ ✅ HECHO.
3. ~~Integrar en `fiscal-buzon-service.ts`~~ ✅ HECHO.
4. ~~Flujo completo OC~~ ✅ HECHO. ~~Gastos (--gasto)~~ ✅ HECHO.
5. **Producción**: cuando haya tenant live, `downloadRules.create`/`downloadRequests.create` manuales pasan a ser el camino primario (el servicio ya los intenta primero y cae a `createTestRule` sólo con 403). Ventanas por `--dias`; agendar baja periódica (siguiente punto).
6. **Ideas posteriores (no iniciadas)**:
   - Tabla `cfdi_recibidos` en Drizzle + endpoint API con RBAC para el dashboard.
   - Conciliación completa contra `invoice-matching-service.ts` (3-way match ya existe); hoy el match es emisor→contraparte por taxId + monto ±$0.01 (si dos OCs comparten total gana la más reciente).
   - Automatizar la baja periódica del buzón como función Inngest (patrón cron existente).
   - `getXmls(requestId)` / `downloadPackage(requestId)` para guardar el XML completo, no sólo metadatos.

### NOTA sobre WIP ajeno en el árbol
Al cerrar esta fase quedan SIN commitear (de otro workstream, no tocar aquí): `lib/services/fiscal-service.ts` (~300 líneas: nómina timbra de verdad vía v4 con complemento payroll) y `tests/timbrado-idempotente.spec.ts`. Ese WIP tenía un `catch` duplicado que rompía `tsc` — se corrigió para poder validar, specs 10/10.

---

## 6. Estado del tenant FiscalAPI (test.fiscalapi.com)

- **~25 facturas timbradas** acumuladas (por valores + varias por referencias para el buzón).
- **Personas**: `whatsa` (del usuario) · URE180429TM6 `74871dde…` (FIEL subida, satCfdiUse G01) · IXS7607092R5 `04f46a90…` (CSD subido) · L&O950913MSA (creada por el flujo de gasto, CSD subido).
- **Productos**: "Servicio buzon Pulso" (con IVA) y "Servicio buzon Pulso sin IVA".
- **Reglas/solicitudes de prueba**: se acumulan 1 par por corrida (`createTestRule` no reutiliza); todas TERMINADA. Reuso implementado en `asegurarReglaDescarga` (getList-first).
- **Sin solicitudes manuales** (bloqueadas 403 sandbox) — las de prueba funcionan.

## 7. Gotchas rápidos

- `getById` de factura espera el **id interno** de FiscalAPI, no el UUID del SAT (404 si pasas UUID).
- `getMetadataItems(requestId)` — un solo argumento (el sample del README dice otra cosa); monto en campo `amount`.
- El id que devuelve `createTestRule()` es el de la SOLICITUD; la regla real se resuelve con `downloadRules.getList()`.
- Emails de personas sin `+`/`&` (validator del API sólo acepta letras/dígitos en el username).
- Overrides de impuestos POR LÍNEA en modo por-referencias se ignoran: el IVA lo decide el producto (`satTaxObjectId`).
- El zip de certificados de prueba: https://developers.sw.com.mx/wp-content/uploads/2023/07/Certificados_Pruebas.zip (FIEL = `rfc.cer` de raíz + `Claveprivada_FIEL_*.key`; no todas las personas la traen — URE180429TM6 sí).
- Playwright nómina spec intacto: `pnpm exec playwright test --no-deps --project=chromium tests/timbrado-idempotente.spec.ts` (10/10).
