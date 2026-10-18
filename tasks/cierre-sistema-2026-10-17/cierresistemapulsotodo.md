# Checklist — cierre del sistema Pulso

Plan: [plan.md](plan.md). Investigación: [INFORME.md](../../audits/2026-10-17-sistema/INFORME.md).

Estado inicial: todas las tareas pendientes; guardar este plan no acredita implementación.



## Fase 1 — P0: accesos y recepción

- [x] SEC-01 — Autorizar equipo/sucursal y corregir fecha de mantenimiento. **Verificada** (`tests/unit/maintenance-create-access.test.ts`, 5/5).
- [x] SEC-02 — Restringir consulta/descarga de evidencia por actor y alcance. **Verificada** (`tests/unit/workflow-evidence-access.test.ts`, 4/4).
- [x] SEC-03 — Autorizar ventas legacy y validar receta/sucursal/empresa. **Verificada** (`tests/unit/inventory/sales-entry-access.test.ts`, 4/4).
- [x] REC-01 — Recibir 10 deja 10; fracciones, conversión y cuarentena correctas. **Verificada** (`tests/unit/inventory/receiving-batch-ownership.test.ts`, 2/2).
- [x] REC-02a — Idempotencia: clave única (empresa, clave) + replay en API y extractor. **Verificada unitaria** (`receiving-idempotency.test.ts`, 3/3). Migración `drizzle/0100_green_excalibur.sql`.
- [x] REC-02b — Núcleo atómico en una transacción; efectos externos post-commit. **Verificada unitaria** (`receiving-atomicity.test.ts`, 1/1) **y contra base Postgres real** (`tests/integration/receiving-db-atomicity.test.ts`, 4/4: rollback total, replay y carrera 23505).
- [~] REC-03 — Diagnóstico hecho sobre la base configurada: 4 lotes con saldo ≠ ledger (2 ATTRIBUTABLE, 2 AMBIGUOUS). Ajuste **no aplicado** (dry-run); requiere aprobación y conteo físico para los AMBIGUOUS. Evidencia: `evidencia/FASE-1/rec03-diagnostico-dryrun.txt`.
- [x] Puerta 1 (técnica) — Prueba DB real de rollback/concurrencia (4/4), `tsc --noEmit` (exit 0) y `build` (exit 0) aprobados; unit 1652/0 fallos. Evidencia: `evidencia/PUERTA-1/*`.
- [ ] Puerta 1 (operativa) — Aplicar migración `0100` al entorno objetivo y decidir los ajustes REC-03 (2 ATTRIBUTABLE) + conteo de los 2 AMBIGUOUS.

## Fase 2 — Evidencia, auditoría y aislamiento DB

- [x] EVI-01 — Evidencia común durable y aislada; primer recorrido con workflow. **Hecho (2a):** tabla `evidence` (empresa/sucursal/entidad/autor/tipo/key) + migración `0101` aplicada en base aislada; `EvidenceStore` persiste y exige `companyId` (store/lectura/borrado lógico). **Hecho (2b):** `syncStepEvidence` refleja la evidencia del paso de workflow en la tabla canónica con reemplazo (sin duplicar) y alcance por empresa; enganchado en `WorkflowExecutionService.updateStep`. **Verificado** contra DB real (`tests/integration/evidence-store-db.test.ts`, 5/5; `tests/unit/workflows/step-evidence.test.ts`, 4/4). Pendiente: recorrido API/navegador del PATCH de paso con dos empresas.
- [x] AUD-01 — Auditoría durable/atómica en mutaciones sensibles del dominio piloto (recepción) y acceso a datos clasificados. **Verificada**: `AuditService.logInventoryAction(..., tx)` es parte de la transacción y la recepción no se confirma sin su bitácora (`tests/integration/audit-atomicity-db.test.ts` 2/2; `receiving-db-atomicity.test.ts` caso AUD-01); `logDataAccess` registra lectura/exportación sensible sin copiar el adjunto. Evidencia: `evidencia/FASE-2/integration-aud01.log`, `tsc-aud01.txt`.
- [x] SEC-04 — Contexto transaccional y RLS piloto en `evidence` con rol runtime sin bypass. **Verificada**: `lib/db/tenant-context.ts` + migración `0103`; `tests/integration/tenant-rls-db.test.ts` 5/5 (sin fuga entre empresas reutilizando el pool max=1, rechazo por defecto sin contexto, job con alcance explícito, filtro cruzado vacío). Evidencia: `evidencia/FASE-2/integration-sec04.log`.
- [ ] SEC-05.<dominio> — Crear y cerrar lotes S/M por dominio, incluidas tablas hijas.
- [ ] Puerta 2 — Reinicio conserva evidencia y ningún contexto de tenant se filtra.

## Fase 3 — Excepciones

- [ ] EXC-01 — Migración de `exceptions` probada.
- [ ] EXC-02 — Sync, comparación legacy/canónico y activación reversible del feed.
- [ ] EXC-03 — Lifecycle concurrente, verificación segregada y escalamiento por SLA.
- [ ] EXC-04.merma — Fuente/umbral, owner, SLA y resolución consistentes.
- [ ] EXC-04.presupuesto — Fuente/umbral, owner, SLA y resolución consistentes.
- [ ] EXC-04.ausencia — Fuente/umbral, owner, SLA y resolución consistentes.
- [ ] EXC-04.banco — Pago/depósito no conciliado con owner, SLA y resolución.
- [ ] Puerta 3 — Siete casos del requisito recorren detección→cierre/reapertura.

## Fase 4 — Workforce y nómina

- [ ] NOM-01 — Unidad salarial, vigencias y reglas aplicables sin ambigüedad.
- [ ] NOM-02 — Pre-nómina desde asistencia/incidencias, bonos y deducciones.
- [ ] NOM-03 — Aprobación y snapshot con invalidación ante cambios.
- [ ] NOM-04 — Exportación/corrida/payslips/timbrado consumen el mismo cálculo.
- [ ] NOM-05 — Nómina neta autorizada entra a tesorería sin duplicarse.
- [ ] Puerta 4 — Período con faltas, festivo, vacaciones y overtime cuadra de extremo a extremo.

## Fase 5 — Inventario y producción

- [ ] INV-01 — Corrección/reintento de venta ajusta consumo transaccionalmente.
- [ ] INV-02 — Política de consumo por producción/venta y versión histórica.
- [ ] PROD-01 — Lote de terminado con genealogía, costo y saldo correctos.
- [ ] PROD-02 — Hold time y entradas de producción usan el mismo modelo.
- [ ] INV-03 — Conteo físico, aprobación y ajuste idempotente.
- [ ] INV-04 — Costo/snapshots/varianza reproducibles al cerrar período.
- [ ] Puerta 5 — Venta/producción/recepción no duplican consumo ni saldo; cierre conserva costo.

## Fase 6 — Banca y finanzas

- [ ] BAN-01 — Cuentas bancarias propias, alcance y vínculo de origen de corrida.
- [ ] BAN-02 — Importación idempotente del banco piloto y sus errores visibles.
- [ ] BAN-03 — Matching de egresos con ambigüedad explícita.
- [ ] BAN-04 — Confirmación/reversa de conciliación y soporte o bloqueo explícito de parcial/múltiple.
- [ ] BAN-05 — Ingreso esperado desde corte/terminal/agregador.
- [ ] BAN-06 — Liquidación/depósito conciliados con diferencias trazables.
- [ ] FIN-01 — Saldo bancario conciliado separado de caja proyectada.
- [ ] FIN-02 — P&L por sucursal/grupo congelado por período.
- [ ] Puerta 6 — Factura pagada e ingreso por canal conciliados; reversas conservan deuda/historia.

## Fase 7 — Cobertura operativa

- [ ] OPE-01 — Recurrencias de mantenimiento generan/cerran órdenes sin duplicados.
- [ ] OPE-02 — Downtime e historial/costo comparativo de equipo.
- [ ] OPE-03.aceite — Medición/evidencia, política y excepción verificable.
- [ ] OPE-03.cocina — Rutina asignada, ejecutada y verificada.
- [ ] OPE-03.salon — Rutina salón/counter asignada, ejecutada y verificada.
- [ ] OPE-03.gerente — Checklist gerente con evidencia/acciones.
- [ ] OPE-03.handoff — Entrega de turno con pendientes y recepción del responsable.
- [ ] COM-01.compra — Requisición→OC→recepción→CFDI→obligación.
- [ ] COM-01.servicio — OS→cotizaciones→conformidad→factura→obligación.
- [ ] APR-01.<documento> — Contrato de aprobación coherente por documento.
- [ ] PER-01.<perfil> — Ocho perfiles con capacidades/alcance comprobados en API y UI.
- [ ] AUT-01.<job> — Runtime y recuperación observables por empresa.
- [ ] CTL-01 — KPIs, comparación, twin y daily brief persistidos y trazables.
- [ ] INT-01.<fuente> — POS/canal: archivo→corte/mix→liquidación→banco.
- [ ] Puerta 7 — Rutinas y proyecciones acreditadas por ejecución, no sólo templates/seeds.

## Fase 8 — Validación

- [ ] VAL-01.M01 — Organización y configuración.
- [ ] VAL-01.M02 — Centro de control.
- [ ] VAL-01.M03 — Workflows y ejecución.
- [ ] VAL-01.M04 — Evidencia y verificación.
- [ ] VAL-01.M05 — Excepciones, incidentes y acciones.
- [ ] VAL-01.M06 — Operación diaria.
- [ ] VAL-01.M07 — Food safety, calidad y compliance.
- [ ] VAL-01.M08 — Equipos y mantenimiento.
- [ ] VAL-01.M09 — Workforce, documentos, training y performance.
- [ ] VAL-01.M10 — Nómina.
- [ ] VAL-01.M11 — Recetas y food cost.
- [ ] VAL-01.M12 — Producción.
- [ ] VAL-01.M13 — Inventarios, conteos, PAR, alto valor y transferencias.
- [ ] VAL-01.M14 — Compras y proveedores.
- [ ] VAL-01.M15 — Recepción.
- [ ] VAL-01.M16 — Administración, CxP, gastos y petty cash.
- [ ] VAL-01.M17 — Finanzas, tesorería y conciliación.
- [ ] VAL-01.transversal — Ventas/canales y ocho perfiles; resolver las 217 filas.
- [ ] VAL-02 — Piloto funcional, carga 3/8/15 sucursales y recuperación/restauración.
- [ ] Puerta final — Sin P0 abierto; tests, TypeScript, build y E2E aprobados; pendientes explícitos.

## Registro de ejecución

Crear una fila al trabajar cada tarea; subdividir IDs con marcador de dominio antes de marcar el padre.

| ID | Estado | Revisión/commit | Entorno | Evidencia de aceptación | Pendiente/riesgo |
|---|---|---|---|---|---|
| BASE-01 | Verificada | `e95291c` (HEAD) + cambios locales | local | `evidencia/BASE-01/*`; `evidencia/PUERTA-1/*`: unit 1652/0 fallos, `tsc` exit 0, `build` exit 0; base aislada `.env.test` (174 tablas) | fallo de seed `clave_prod_serv` descartado (unit 0 fallos) |
| SEC-01 | Verificada | `e95291c` + cambios locales | local (unit) | `evidencia/FASE-1/unit-fase1.log` (5/5) | falta navegador con 2 empresas |
| SEC-02 | Verificada | idem | local (unit) | `unit-fase1.log` (4/4) | falta navegador/descarga real |
| SEC-03 | Verificada | idem | local (unit) | `unit-fase1.log` (4/4) | — |
| REC-01 | Verificada | idem | local (unit) | `unit-fase1.log` (2/2) | — |
| REC-02a | Verificada (unitaria) | idem | local (unit) | `unit-fase1.log` (3/3); migración `0100` | migración no aplicada a ninguna base |
| REC-02b | Verificada | idem | local (unit) + DB real `.env.test` | `evidencia/PUERTA-1/integration-2026-10-17.log` (4/4) | — |
| REC-03 | En curso | idem | base configurada (sólo lectura) | `rec03-diagnostico-dryrun.txt` | ajuste no aplicado; 2 lotes ambiguos a conteo |
| PUERTA-1 | Verificada (técnica) | idem | local + DB aislada | `evidencia/PUERTA-1/`: `tsc-2026-10-17-real.txt` (exit 0), `build-2026-10-17-real.log` (exit 0), `integration-2026-10-17.log` (4/4), `unit-2026-10-17-real.log` (1652/0) | operativo: aplicar `0100` al entorno objetivo; REC-03 |
| EVI-01 | Verificada (persistencia) | `c9c3192` + cambios locales | local + DB aislada | `evidencia/FASE-2/`: `unit-evi01b.log` (1699/0), `tsc-evi01b.txt` (exit 0), `integration-evi01b.log` (5/5) | falta recorrido API/navegador del PATCH de paso; migración `0101` no aplicada al entorno objetivo |
| AUD-01 | Verificada | `c9c3192` + cambios locales | local + DB aislada | `evidencia/FASE-2/`: `integration-aud01.log` (2/2 `audit-atomicity-db`), caso AUD-01 en `receiving-db-atomicity` (rollback total), `tsc-aud01.txt` (exit 0); ejecución vigente: `unit-sec04.log` 1730/0 | — |
| SEC-04 | Verificada | cambios locales | local + DB aislada (`.env.test`) | `evidencia/FASE-2/`: `integration-sec04.log` (5/5), `unit-sec04.log` (1730/0), `tsc-sec04.txt` (exit 0), `build-sec04.log` (exit 0); migración `0103` aplicada en base aislada | operativo: provisionar rol `pulso_app` (NOBYPASSRLS) y aplicar `0103` al entorno objetivo; RLS por dominio = SEC-05 |

Estados: pendiente, en curso, verificada, bloqueada por dato externo. Una tarea «verificada» enlaza comandos/resultados y prueba de sus criterios. Un bloqueo de integración no impide continuar una tarea independiente.
