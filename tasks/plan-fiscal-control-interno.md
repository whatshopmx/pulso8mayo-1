# Implementation Plan: Fases 11-14 — Configuración del Tenant, Fiscal M15, Control Interno M17, Packaging

> **Continuación de** `tasks/plan-grupo-restaurantero-unificado.md` (Fases 1-10, T1-T40) y `tasks/plan-ventas-gastos.md`.
> **Fuente:** `docs/pulso-diseno-grupo-restaurantero.md` v2 — Secciones 2 (dimensiones del tenant), 3 (Rol 7), 4 (M15, M17), 16 (tiers).
> **Baseline del gap analysis:** 2026-08-04 (verificado contra código el 2026-08-02).
> **Numeración:** este plan usa directamente la numeración unificada **T41-T58** para evitar la colisión de numeración que ocurrió con T24/T26 en el plan de ventas-gastos. El tracker operativo es `tasks/todo-fiscal-control-interno.md`.

## Overview

Implementar las piezas del diseño v2 que **no están cubiertas por ningún plan previo**:

- **Fase 11 — Dimensiones de configuración del tenant (§2 del diseño):** las 7 dimensiones del modelo operativo del grupo (compras, producción, tesorería, pago a proveedores, autonomía del gerente, nómina, tipo de tenant) como configuración estructural que condiciona flujos de autorización, visibilidad y consolidación. Es lo que convierte el discovery en "configuración, no consultoría".
- **Fase 12 — M15 Fiscal (CFDI vía FiscalAPI):** timbrado de CFDI de nómina (conecta con M4/payroll-calculator), descarga masiva de CFDI recibidos del SAT que alimenta la conciliación 3 vías existente, complemento de pago al ejecutar pagos (conecta con M16), validación de proveedores contra listas negras del SAT.
- **Fase 13 — M17 Contabilidad y Control Interno:** generación automática de pólizas de diario desde eventos financieros, export para despacho contable, segregación de funciones / doble autorización anti-fraude, reporte de excepciones.
- **Fase 14 — Packaging:** tiers Starter/Growth/Scale con feature gating declarativo, y el Rol 7 Chef Corporativo.

**Fuera de scope (plan futuro):** M14 (conciliación de comisiones de agregadores), workflow de Apertura de Sucursal + Digital Twin (§5), resiliencia offline y notas de voz (§9), adopción/comportamiento — reconocimiento, recencia EXIF, medición de fricción (§10), buzón de correo CC para cortes (M13), emisión de facturas de venta a clientes (el propio diseño lo marca "no MVP"). **Candidato adicional para el siguiente plan:** indicador de exposición IMSS en el motor de predicciones — costo laboral declarado como % de venta vs. rango típico del sector (la misma señal que el IMSS usa para seleccionar auditorías); informa al negocio de su propia exposición legal, ver AD-19.

**Dependencia del plan anterior:** Fases 11, 12 (excepto T50) y 14 pueden iniciar ya. T50 (complemento de pago) requiere M16 (T34-T40) o un stub de registro de pago. La Fase 13 se enriquece con M13/M16 pero arranca con los eventos fiscales de la Fase 12.

## Architecture Decisions

*(Continúan la numeración AD del plan unificado, que llegó a AD-10)*

- **AD-11 — Cuenta central de FiscalAPI, multi-empresa:** Pulso opera una sola cuenta FiscalAPI; cada razón social del grupo es un *issuer* (persona) con su propio CSD. Multi-RFC y multi-empresa son nativos del proveedor (verificado en docs.fiscalapi.com). Credenciales: `FISCALAPI_API_KEY` + `FISCALAPI_TENANT` por ambiente (test/prod).
- **AD-12 — Pólizas como proyección idempotente de eventos, nunca edición manual:** cada póliza nace de un evento financiero (`sourceType` + `sourceId`, unique compuesto). Regenerar = borrar y recrear desde el evento. La bitácora anti-edición es estructural, no disciplina.
- **AD-13 — Segregación de funciones configurable con degradado a doble autorización:** grupos con headcount suficiente → segregación estricta (quien crea la OC no recibe ni aprueba); grupos chicos → doble autorización (gerente + director). El modo se deriva de la dimensión *autonomía del gerente* (Fase 11) y es overridable por tenant.
- **AD-14 — Tiers como mapa declarativo estático:** `lib/tiers.ts` exporta `TIER_MODULES: Record<Tier, ModuleKey[]>`; enforcement en dos puntos: sidebar (oculta entradas) y `assertModuleEnabled(companyId, module)` en APIs (403 con mensaje de upgrade). Sin lógica dinámica por cliente.
- **AD-15 — Nuevas tablas en el monolito `lib/db/schema.ts`:** `drizzle.config.ts` apunta exclusivamente a ese archivo (los módulos en `lib/db/schema/` solo se indexan vía import del monolito). Convención confirmada con T24/T26.
- **AD-16 — XML/PDF de CFDI emitidos en R2, metadata en DB:** `cfdi_emitted` guarda uuid, montos, estatus y URLs; los binarios fiscales viven en R2 (reusa `lib/r2-client.ts` con fallback local), no inflan la DB.
- **AD-17 — Crons en Inngest** (dirección actual del proyecto): descarga masiva semanal, re-chequeo SAT mensual, detector de excepciones diario.
- **AD-18 — Dinero en centavos (integer)** en todas las tablas nuevas (convención AD-5, se mantiene).
- **AD-19 — Un solo salario de registro; no existe nómina paralela:** el sistema mantiene un único salario contractual por empleado, que es el que fluye a IMSS (SUA/IDSE), CFDI de nómina (T47) y cálculos LFT. **No se construye ningún ledger "declarado vs real":** una base de datos centralizada de esquemas mixtos sería evidencia documental de fraude sistemático de los clientes (riesgo legal directo para Pulso) y contradice los controles anti-fraude que M17 vende. El canal legítimo de compensación en efectivo del sector restaurantero se diseña vía **propinas documentadas** (LFT Art. 346: las propinas no integran el salario ni el SBC — por eso T21 sube de prioridad, ver nota en plan unificado) y vía la visibilidad de salidas de efectivo que el propio negocio registra en M16 (caja chica / gastos operativos), sin etiquetas de nómina oculta. El "costo laboral total" del P&L puede sumar nómina declarada + propinas + otros pagos registrados por el dueño, sin que el sistema clasifique nada como "no declarado". La reclasificación fiscal de esos gastos es responsabilidad del contador del cliente (el diseño ya lo establece: "Pulso no reemplaza al contador").

## Task List

### Fase 11: Dimensiones de Configuración del Tenant (§2)

- [ ] T41: Schema `tenant_operating_config` (7 dimensiones + umbrales) + migración
- [ ] T42: API + UI del modelo operativo del grupo (admin)
- [ ] T43: Helper `getTenantOperatingConfig()` + primer consumo real (routing de aprobación de OC)

**Checkpoint L** — el modelo operativo se configura desde admin y cambia el comportamiento de aprobaciones sin tocar código.

### Fase 12: M15 — Fiscal y Facturación (FiscalAPI)

- [ ] T44: Spike + cliente FiscalAPI (`lib/fiscal/`) con ambiente de pruebas
- [ ] T45: Schema fiscal (`fiscal_issuers`, `cfdi_emitted`) + migración
- [ ] T46: Alta de emisores (RFC por razón social) + carga de CSD: API + UI
- [ ] T47: CFDI de nómina timbrado desde payroll-calculator + UI

**Checkpoint M** — nómina de un período timbrada end-to-end en sandbox con XML/PDF descargables.

- [ ] T48: Descarga masiva SAT → `invoices` + disparo de conciliación 3 vías existente
- [ ] T49: Validación SAT de proveedores (estatus CFDI + listas negras) + alertas
- [ ] T50: Complemento de pago CFDI al ejecutar pago (hook M16 o stub manual)
- [ ] T51: UI fiscal consolidada: emitidos, recibidos, conciliación, estatus

**Checkpoint N** — ciclo fiscal completo: facturas recibidas concilian solas; emitidas y complementos visibles en un solo lugar.

### Fase 13: M17 — Contabilidad y Control Interno

- [ ] T52: Schema M17 (`chart_of_accounts`, `journal_entries`, `journal_entry_lines`, `internal_control_exceptions`, `segregation_rules`) + migración
- [ ] T53: Motor de pólizas: generación desde eventos financieros (compra conciliada, pago, nómina timbrada, venta del día)
- [ ] T54: Export de pólizas (CSV universal + layout CONTPAQi)

**Checkpoint O** — eventos reales del período generan pólizas exportables que el contador puede importar.

- [ ] T55: Segregación de funciones / doble autorización (enforcement en OC y gastos)
- [ ] T56: Reporte de excepciones: detectors + cron diario + UI

**Checkpoint P** — un intento de auto-aprobación queda bloqueado y registrado; el reporte de excepciones muestra hallazgos reales.

### Fase 14: Packaging — Tiers + Chef Corporativo

- [ ] T57: Tiers Starter/Growth/Scale: plan en `companies`, mapa de módulos, gating en sidebar + API
- [ ] T58: Rol `CHEF_CORPORATIVO`: enum, permisos, dashboard de calidad cross-sucursal, aprobación de recetas

**Checkpoint Q** — un tenant STARTER no ve módulos SCALE (UI y API); el chef aprueba recetas y revisa muestreos de todas las sucursales.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Costos de FiscalAPI (timbres/suscripción) cambian el modelo comercial | Alto | T44 es spike timeboxeado (2h) con cuenta de pruebas gratuita; el modelo de cobro al cliente se decide antes de T47 |
| Datos fiscales de empleados incompletos (RFC, CURP, NSS, CP fiscal, régimen) bloquean el timbrado de nómina | Alto | T47 incluye reporte de completitud previo al timbrado; `employee_profiles` ya tiene rfc/curp/nss — validar CP y régimen, agregar campos si faltan |
| Descarga masiva SAT requiere e.firma (FIEL) del cliente además del CSD | Medio | Spike dentro de T48 (1h) documenta qué credenciales exige FiscalAPI; fallback: upload manual de XMLs (ya existe `invoices/upload`) |
| Layout de pólizas CONTPAQi es formato posicional propietario y varía por versión | Medio | CSV universal como base (T54); layout CONTPAQi validado con el contador del cliente piloto antes de darse por cerrado |
| Migración de `roleEnum` para CHEF_CORPORATIVO | Bajo | `ALTER TYPE ... ADD VALUE` es aditivo; verificar con `pnpm db:generate` que no hay drops |
| Scope creep hacia M14 / apertura de sucursal / adopción | Medio | Fuera de scope explícito (ver Overview); se capturan en el plan siguiente |
| T50 depende de M16 no implementado | Medio | Si al llegar a T50 no existe M16 T35, se implementa contra endpoint manual mínimo `POST /api/finance/payments` (registrar pago de factura) y el hook se reconecta cuando M16 aterrice |

## Open Questions

- [ ] **Q6:** ¿Cuenta central Pulso en FiscalAPI (recomendado, AD-11) o una cuenta por grupo restaurantero? Central simplifica onboarding; por-grupo traslada el costo de timbres al cliente.
- [ ] **Q7:** ¿Los timbres CFDI se incluyen en la suscripción del tier o se cobran por consumo? Recomendación: incluir bolsa de timbres por tier (Starter: solo nómina; Scale: todo), excedente por consumo.
- [ ] **Q8:** ¿Qué credenciales exige la descarga masiva (¿CSD basta o se requiere FIEL)? Se resuelve en el spike de T48.
- [ ] **Q9:** ¿Catálogo de cuentas contables: seed estándar restaurantero (recomendado: ~25 cuentas) o importar el del contador del cliente? Seed + edición.
- [ ] **Q10:** ¿P&L/pólizas con IVA desglosado (IVA acreditable/trasladado) o neto? Recomendación: pólizas CON IVA desglosado (el contador lo necesita), reportes operativos sin IVA (decisión P4 del plan unificado).
- [ ] **Q11:** Chef Corporativo ¿puede editar recetas directamente o solo aprobar/rechazar cambios propuestos por sucursal? Recomendación MVP: edita libremente + aprueba; el flujo de "propuesta desde sucursal" es fase posterior.

## Parallelization Opportunities

- **Fase 11 (T41-T43) ∥ Fase 12 inicio (T44-T47):** independientes — 2 agentes en paralelo.
- **Fase 14 (T57-T58):** independiente de todo lo demás tras T41 — tercer carril paralelo.
- **T52-T54 (pólizas):** necesitan los eventos de T47/T48 — secuencial tras media Fase 12.
- **T50:** depende de M16 (plan ventas-gastos) o del stub — la única dependencia cross-plan dura.
- **Migraciones (T41, T45, T52, T58-enum):** siempre secuenciales aunque el código sea paralelo.

## Estimated Total

18 tareas (T41-T58): ~3 S, ~13 M, ~2 L. Comparable al plan de ventas-gastos (T24-T38).
