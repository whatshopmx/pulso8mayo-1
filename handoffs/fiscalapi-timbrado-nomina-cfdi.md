# Handoff — FiscalAPI: timbrado de CFDI de nómina (hecho) + completar el flujo de nómina real (pendiente)

**Fecha:** sesión 2026-08-25
**Repositorio:** `C:/Users/david/pulso29` — Pulso HORECA (Next.js 16 App Router, TypeScript, Drizzle + Neon)
**Commit base:** `d733a9a` feat(fiscal): buzón de facturas recibidas — descarga masiva SAT (YA EN MAIN)
**Estado:** ✅ Timbrado de CFDI de nómina funcionando **end-to-end en sandbox live** (3 comprobantes timbrados, totales verificados, persistencia verificada). El endpoint ficticio `/cfdi/nomina/timbrar` fue reemplazado por el contrato v4 real (`POST /api/v4/invoices` + `complement.payroll`). 🔶 El mapeo usa agregados (una sola percepción + una deducción); falta desglose real, datos reales del empleado y emisor propio por empresa.
**Cambios sin commitear:** `lib/services/fiscal-service.ts`, `tests/timbrado-idempotente.spec.ts`. Diag script `scripts/__diag-nomina.ts` (gitignored, convención desechable).

---

## 1. Resumen para retomar

El hallazgo original: `timbrarNomina()` llamaba a `POST {baseUrl}/cfdi/nomina/timbrar` con payload snake_case — **endpoint que no existe en FiscalAPI v4**. Se investigó docs.fiscalapi.com + el SDK oficial (`github.com/FiscalAPI/fiscalapi-node`, ejemplos `ejemplos-factura-nomina-valores.ts`, `-referencias.ts` y `ejemplo-datos-empleado-empleador.ts`) y se reimplementó con el contrato real. Validado contra los ejemplos oficiales campo por campo: coincide 1:1 con el modo por valores.

**Siguiente paso concreto (sección 5, paso 1):** commitear los dos archivos modificados, luego extender `NominaTimbradoInput` con el **desglose real** de percepciones/deducciones (hoy colapsa todo a una línea "Sueldo nominal" + "ISR retenido").

**Convención:** los `scripts/__diag-*.ts` son desechables — no commitearlos. El SDK clonado quedó en `%TEMP%\opencode\fiscalapi-node\examples\` (re-clonar si se purga).

---

## 2. Arquitectura conceptual

```
Nómina en FiscalAPI NO tiene endpoint especial:
es un CFDI normal vía POST /api/v4/invoices con
  typeCode: "N"
  issuer  → tin + régimen 601 + employerData{registro patronal} + taxCredentials (CSD)
  recipient → RFC + régimen 605 + cfdiUseCode CN01 + employeeData{CURP, NSS, salarios...}
  complement.payroll v1.2 → período (fechas/días) + percepciones + deducciones + otrosPagos
Sin items: FiscalAPI genera el concepto "Pago de nómina" solo.
Total = Σ percepciones (gravado+exento) − Σ deducciones. Sin IVA.
```

Dos modos como en facturación normal: **por valores** (todo inline + CSD en cada request — el que implementamos) y **por referencias** (pre-crear persona empleadora con CSD + subrecursos `persons.employer.create` / `persons.employee.create`; la factura lleva sólo ids). Los ejemplos oficiales de ambos modos están en el repo del SDK.

---

## 3. LO QUE YA FUNCIONA

### Archivos clave
| Archivo | Qué hace |
|---|---|
| `lib/services/fiscal-service.ts` | `timbrarNomina()` con contrato v4 real + `construirPayloadNomina()` (mapeo nómina→CFDI). Idempotencia intacta |
| `tests/timbrado-idempotente.spec.ts` | Spec actualizado al contrato nuevo (intercepta `/api/v4/invoices`, respuestas `ApiResponse {succeeded,data}`). 10/10 |
| `lib/fiscal/sat-test-data.ts` | (existente) catálogo personas/CSD de prueba del SAT |
| `lib/fiscal/fiscalapi.ts` | (existente) cliente SDK, `DEFAULT_TEST_ISSUER` = EKU9003173C9 |
| `scripts/__diag-nomina.ts` | Diag: `npx tsx scripts/__diag-nomina.ts [--servicio] [--empleado <rfc>]` |

### Diseño del mapeo (`construirPayloadNomina`)
- **Emisor**: siempre `DEFAULT_TEST_ISSUER` (EKU9003173C9 · Kemper Urgate) con SU CSD + `employerData.employerRegistration` (default `'B5510768108'`, override env `FISCALAPI_EMPLEADOR_REGISTRO`).
- **Receptor**: el RFC del empleado se resuelve contra el catálogo de físicas del SAT; si no matchea entra `FUNK671228PH6` (fallback, igual que el emisor de respaldo en invoicing).
- **Datos laborales sintéticos deterministas** por RFC: número de empleado `PLS-<últimos6>`, NSS derivado, contratación fija `2020-01-15`, antigüedad `P<n>W`, contrato `01`, régimen `02`, riesgo `1`, periodicidad `04`, estado `JAL` (override `FISCALAPI_NOMINA_ESTADO`), salario diario = percepciones/días.
- **Período**: acepta `"AAAA-MM-DD - AAAA-MM-DD"` (lo que manda `payroll-service`) o `"AAAA-MM"`; inválido cae al mes en curso.
- **CURP**: la del input si viene; si no, la genérica del catálogo SAT `XEXX010101MNEXXXA8`.
- **OtroPago**: SIEMPRE `{tipo '002', code '5050', subsidio en 0}` — requerido por el PAC (ver fix #2).
- **Respuesta**: evidencia del timbre = `data.uuid` (folio asignado por el SAT). Rechazo de negocio = HTTP 200 con `succeeded:false` → se guarda RECHAZADO sin lanzar. Dedup → reintento variando serie.

### Corridas live verificadas (2026-08-25)
| UUID | Modo | Total | Nota |
|---|---|---|---|
| `053c5c62-deed-4485-8659-aa2d58262440` | PAC directo | $13,000 ✓ | vía `client.invoices.create` |
| `01da501f-3d6f-429a-9c5c-6fc6d667082f` | servicio completo | $13,000 ✓ | XML/sello/QR en `raw_response.responses[]` |
| `6857d478-f922-448a-a53a-814e784cbbc8` | servicio completo | $13,000 ✓ | fila TIMBRADO en BD con FKs correctas (luego limpiada) |

Emisor EKU9003173C9 · receptor FUNK671228PH6 · cert SAT `30001000000500003456` · serie NOM · folio interno `EKU9003173C9-4`.

### Fixes técnicos descubiertos en live (críticos, ya en código)
1. **CURP con formato válido obligatoria** (error `NOM111`): sin CURP real que valga, usar la genérica `XEXX010101MNEXXXA8`.
2. **OtroPago clave "002" siempre presente** (error `NOM105`): ni omitir `otherPayments` ni mandarlo vacío pasa; el ejemplo oficial confirma el patrón (subsidio en cero).
3. **Dedup puede venir sólo en `details`**: `respuestaEsDuplicado()` revisa `message` Y `details` ("Sorry, it's not you, it's me." + "same unique values"). Reintento variando serie.
4. **FKs en `cfdi_nomina_timbrados`**: `company_id` y `timbrado_por` son UUIDs reales (empresa y usuario); un diag con strings arbitrarios truena el INSERT.
5. Un intento rechazado deja registro: el reintento posterior choca con dedup aunque se corrija el contenido → serie variada resuelve.

### Verificación contra los ejemplos oficiales
Comparación campo por campo hecha: estructura idéntica al modo por valores (`typeCode N`, `employerData`, `employeeData`, `complement.payroll` con las mismas llaves). Diferencias conscientes: `date` Date−2h vs su string ingenuo (gotcha tzdata ya validado), series libre, datos sintéticos deterministas en lugar de hardcodeados. El modo por referencias NO se implementó (deliberado: consistencia con `fiscal-invoicing-service`, sin estado pre-creado).

---

## 4. Lo que AÚN es simulación (límites actuales)

1. **Desglose fiscal falso**: todo colapsa a 1 percepción "Sueldo nominal" (gravado) + 1 deducción "ISR retenido". Las propinas van dentro del sueldo. Legalmente el CFDI debe reflejar el desglose real (exentos, vales, IMSS, etc.).
2. **Datos del empleado inventados**: CURP genérica, NSS sintético, fecha de contratación fija 2020, SBC/SDI = percepciones/días.
3. **Emisor genérico**: siempre EKU (persona de prueba). En producción cada empresa necesita SU CSD + registro patronal real.
4. **Sólo nómina ordinaria** (`payrollTypeCode 'O'`): aguinaldo/extraordinaria, horas extra, incapacidades, separación, asimilados no mapeados.

## 5. PRÓXIMOS PASOS (ordenados)

1. **Commitear**: `feat(fiscal): timbrado de nómina con contrato v4 real de FiscalAPI` (los 2 archivos modificados; diag script queda fuera).
2. **Desglose real de percepciones/deducciones**: extender `NominaTimbradoInput` con arrays opcionales `{ earningTypeCode, code, concept, taxedAmount, exemptAmount }` / `{ deductionTypeCode, code, concept, amount }`; fallback al agregado actual. Fuente: `calculateEmployeePayroll` (payroll-service) ya calcula base+propinas — clasificar propinas como exentas/grabadas y extraer ISR/IMSS reales cuando existan.
3. **Datos reales del empleado**: CURP/NSS reales desde `employeeProfiles` (ya existen columnas rfc/curp), fecha de contratación y SBC/SDI desde `employeeContracts`; registro patronal por empresa (candidato: `tenant-config-service`, patrón M15 fiscal).
4. **Flujo E2E con datos demo**: correr `executePayrollRun` contra seed de empleados con RFCs de prueba del catálogo y verificar payslips con `cfdiUuid`.
5. **Variantes de nómina** (ejemplos listos en el SDK clonado): extraordinaria/aguinaldo (`payrollTypeCode 'E'`), horas extra (`overtime[]` dentro de la percepción), incapacidades (`disabilities[]`), separación/indemnización (`severance`), asimilados (régimen `09`). Cada una probablemente revela validaciones nuevas tipo NOM105 — repetir el ciclo diag→fix.
6. **Modo por referencias** (opcional): pre-crear `persons.employer`/`persons.employee` por empresa-empleado para no mandar el CSD en cada timbrado; ver `ejemplo-datos-empleado-empleador.ts`.
7. **Extras del PAC ya incluidos gratis**: PDF y envío por email del recibo (`invoices.pdf` / `invoices.send`) — conectar al payslip del dashboard.
8. **Cancelación de nómina** (correcciones de pago): recurso invoices cancel — no tocado todavía.

### Ideas posteriores (no iniciadas)
- Conciliación nómina timbrada ↔ contabilidad (el total del CFDI como gasto deducible).
- Cron Inngest para timbrar automáticamente al cerrar el período (patrón cron existente).
- Descargar los XML timbrados desde el propio buzón (ya funciona el lado receptor).

## 6. Estado del tenant FiscalAPI (test.fiscalapi.com)

- ~22 facturas acumuladas (OCs/gastos + 3 de nómina serie NOM).
- Personas: `whatsa` · URE180429TM6 (FIEL) · IXS7607092R5 (CSD) · EKU9003173C9 con CSD usado por valores en nómina e invoicing.
- Regla de descarga buzón operativa (ver handoff anterior `fiscalapi-facturacion-cfdi-y-buzon-recibidos.md`).

## 7. Gotchas rápidos

- `POST /api/v4/invoices` con headers `X-API-KEY` + `X-TENANT-KEY` + `X-TIME-ZONE` (NO Bearer).
- Fecha del comprobante: `Date −2h` (nodos del sandbox desplazan +1h; rango PAC [−72h, +5min]).
- Errores NOMxxx llegan en `message` con detalle en `details`; errores HTTP como texto axios — leer `response.details`.
- `getMetadataItems(requestId)` — UN argumento (contrato buzón).
- Espec nómina: `pnpm exec playwright test --no-deps --project=chromium tests/timbrado-idempotente.spec.ts` (10/10).
- Repro timbrado live: `npx tsx scripts/__diag-nomina.ts --servicio` (usa COMPANY_ID/USER de `tests/support/constants`; limpia la fila diag después).
