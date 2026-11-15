# Checklist — implementación de faltantes, revisión 2

Plan: [implementación revisada](../plans/2026-11-11-plan-implementacion-faltantes.md). Base: [investigación](../docs/2026-11-11-investigacion-plan-faltantes.md).

86 entradas base del plan, incluyendo padres P que deben descomponerse. Los hijos ejecutables se añaden al abrirlos y se materializan en el mapa. Los criterios, archivos orientativos, dependencias y verificación por ID están en el plan; este archivo registra ejecución sin duplicar criterios.

Ninguna casilla se marca por código localizado o por las 157 unitarias de base. Para aceptar: evidencia por ID, entorno/HEAD, V1/V2/V3 aplicables y filas actualizadas. Los checkpoints se ejecutan después de 2–3 hijos terminados, en orden de dependencias aunque pertenezcan a frentes distintos.

Continuación 2026-11-11: [mapa ejecutable de 239 filas](mapa-implementacion-faltantes.json), [matriz actualizada](../docs/matriz-cumplimiento-sistema-2026-11-11.csv) y [proyecto Neon nuevo solicitado por el propietario](evidencia/2026-11-11/NEON-NEW/README.md). Los hijos heredan los criterios del padre; fijar archivos/casos antes de abrirlos y subdividir si exceden el límite. Validar con `pnpm.cmd exec tsx scripts/validate-faltantes.ts`.

## 0. Base, trazabilidad y aislamiento

- [x] **P0-01** [R/S] Fijar la base de ejecución
- [x] **P0-02** [R/S] Actualizar la matriz de 239 filas
- [x] **P0-03** [R/M] Construir el mapa fila → tarea → evidencia
- [x] **Checkpoint 0.1** — revisar los últimos 2–3 hijos ejecutados: pruebas del recorrido, tipos/lint, evidencia y regresión aplicable. [Evidencia](evidencia/2026-11-11/CHECKPOINT-0/README.md).
- [x] **P0-04** [R/M] Inventariar migraciones por entorno
- [x] **SEC-00** [A/M] Comprobar el arnés de aislamiento
- [x] **P0-05** [R/S] Coordinar los frentes bancario y contable
- [x] **Checkpoint 0.2** — revisar los últimos 2–3 hijos ejecutados: pruebas del recorrido, tipos/lint, evidencia y regresión aplicable. [Evidencia](evidencia/2026-11-11/CHECKPOINT-0/README.md).
- [x] **Puerta 0** — hijos requeridos aceptados, build del hito de código, V2/V3 aplicables y matriz enlazada. [Cierre](evidencia/2026-11-11/CHECKPOINT-0/README.md). Preparación aceptada; ninguna fila funcional se acepta por este cierre.

## 1. Corrección y recuperación del consumo de ventas

- [x] **INV-01.a** [I/P] Definir identidad y revisión de venta consumida — dos hijos aceptados V1/V2; [evidencia](evidencia/2026-11-11/INV-01.a/README.md).
- [x] **INV-01.a1** [I/M] Contrato y caracterización previa al backfill — V1.
- [x] **INV-01.a2** [I/M] Persistencia append-only, cadena y aislamiento — V1/V2 aisladas, 0137 pendiente en main.
- [x] **Checkpoint INV-01.a** — 51 unitarias, 11 de integración, tipos/lint y build exit 0; [resultados](evidencia/2026-11-11/INV-01.a/results.json). Lint conserva tres advertencias de imports previos del schema.
- [ ] **INV-01.b** [I/P] Aplicar venta y diferencial de consumo atómicamente — descompuesto en ocho hijos. [Evidencia](evidencia/2026-11-11/INV-01.b/README.md).
- [x] **INV-01.b1** [I/M] Planificador exacto del diferencial — V1; [evidencia](evidencia/2026-11-11/INV-01.b1/README.md).
- [x] **INV-01.b2a** [I/M] RLS de lectura y privilegios mínimos del catálogo para runtime — V1/V2 aisladas; 0138 pendiente en main. [Evidencia](evidencia/2026-11-11/INV-01.b2a/README.md).
- [x] **INV-01.b2** [I/M] Snapshot del servidor, demanda exacta y lector acotado — V1/V2 runtime aisladas. [Evidencia](evidencia/2026-11-11/INV-01.b2/README.md).
- [x] **Checkpoint INV-01.b preparación** — b1/b2a/b2: 85 unitarias, 17 SQL, tipos/lint/build exit 0. [Resultados](evidencia/2026-11-11/INV-01.b2a/results.json). No acepta el writer ni la fila funcional.
- [x] **INV-01.b3a** [I/M] Ingreso por revisión y RLS/privilegios mínimos de aplicación — 0139 y V1/V2 aisladas aceptadas; checkpoint INV-B3 y build corregido exit 0. [Evidencia](evidencia/2026-11-11/INV-01.b3a/README.md).
- [x] **INV-01.b3** [I/M] Aplicación transaccional de venta, stock y revisión — aceptado V1/V2: guardia de movimientos huérfanos, 34 SQL con regresión y build del checkpoint exit 0. [Evidencia](evidencia/2026-11-11/INV-01.b3/README.md).
- [x] **INV-01.b4a** [I/M] Normalización y agrupación exacta de importación — aceptado V1: 103 unitarias focales con trazabilidad, tipos/lint/build exit 0 y dependencia b3 aceptada. [Evidencia](evidencia/2026-11-11/INV-01.b4a/README.md).
- [x] **Checkpoint INV-B3** — b3a/b3/b4a: revisión y corrección de movimientos huérfanos, 34 SQL, 103 unitarias focales, tipos/lint/build exit 0. Aceptación aislada de esos hijos; padre b y recorrido operativo pendientes. [Evidencia](evidencia/2026-11-11/CHECKPOINT-INV-B3/README.md).
- [ ] **INV-01.b4b.rls** [I/M] Lectura mínima del nombre de receta bajo runtime — 0141 generada; verificación SQL aislada, sin aplicación a main. [Evidencia](evidencia/2026-11-11/INV-01.b4b/README.md).
- [ ] **INV-01.b4b** [I/M] Conectar ingestión al writer, conservando ingreso no reportado — código implementado; aceptación/checkpoint global pendientes. [Evidencia](evidencia/2026-11-11/INV-01.b4b/README.md).
- [ ] **INV-01.b4** [I/M] Conectar captura manual y fronteras bulk/smart-link al writer único.
- [ ] **INV-01.b4.manual** [I/M] Captura manual con writer y rollback del lote completo — código y SQL aisladas comprobados. [Evidencia](evidencia/2026-11-11/INV-01.b4/README.md).
- [ ] **INV-01.b4.bulk** [I/M] Frontera bulk: permiso, identidad y cobertura de ingreso — pruebas de ruta, aceptación HTTP real pendiente. [Evidencia](evidencia/2026-11-11/INV-01.b4/README.md).
- [ ] **INV-01.b4.smartlink** [I/M] Frontera POS del cierre: alcance y vinculación por día — pruebas de ruta, aceptación real pendiente. [Evidencia](evidencia/2026-11-11/INV-01.b4/README.md).
- [ ] **INV-01.b4.ui** [I/M] UI de importación: corrección, repetición, cobertura y recuperación — 9 pruebas Chromium y build exit 0; aceptación integrada pendiente. [Evidencia](evidencia/2026-11-11/INV-01.b4.ui/README.md).
- [ ] **INV-01.c** [I/P] Recuperar fallos y carreras — separado en concurrencia y reparación histórica auditada.
- [ ] **INV-01.c.races** [A/M] Carreras con commits runtime y bloqueo histórico — 5 casos nuevos, 21 SQL con regresión; aceptación dependiente de INV-01.b. [Evidencia](evidencia/2026-11-11/INV-01.c.races/README.md).
- [ ] **INV-01.c.recovery** [I/M] Implementar recuperación histórica con evidencia, aprobación e idempotencia — en curso: contrato, fuentes verificadas y preparación/registro del expediente desde servidor implementados; decisión independiente y aplicación auditada pendientes. [Contrato](evidencia/2026-11-11/INV-01.c.races/recovery-contract.md).
- [ ] **INV-01.c.recovery.contract** [I/M] Preparar expediente y verificar coherencia de revisión — código puro implementado; persistencia y reparación pendientes. [Evidencia](evidencia/2026-11-11/INV-01.c.recovery.contract/README.md).
- [ ] **INV-01.c.recovery.objects** [I/M] Verificar contenido de evidencias privadas con hash, tamaño y timeout — código implementado, 62 pruebas; V2 real pendiente. [Evidencia](evidencia/2026-11-11/INV-01.c.recovery.objects/README.md).
- [ ] **INV-01.c.recovery.persistence** [I/M] Persistir expediente y decisión con aislamiento e inmutabilidad — código implementado, 7 SQL nuevas y 18 con regresión; 0143 solo en rollback aislado. [Evidencia](evidencia/2026-11-11/INV-01.c.recovery.persistence/README.md).
- [ ] **INV-01.c.recovery.subject.schema** [I/M] Añadir SALE_RECOVERY al catálogo canónico — código implementado, dos SQL runtime; 0144 solo en rama aislada, acceso por entidad y carga pendientes. [Evidencia](evidencia/2026-11-11/INV-01.c.recovery.subject.schema/README.md).
- [ ] **INV-01.c.recovery.subject.access** [I/M] Cargar, leer y retirar evidencia de recuperación con sesión/alcance — código implementado: 46 unitarias y 13 SQL con regresión; build exit 0; sesión/R2 integrados pendientes. [Evidencia](evidencia/2026-11-11/INV-01.c.recovery.subject.access/README.md).
- [ ] **INV-01.c.recovery.attestation.schema** [I/M] Persistir atestaciones inmutables de documentos verificados — código implementado; 5 casos SQL propios; DDL solo rollback. Gate global y aceptación pendientes. [Evidencia](evidencia/2026-11-11/INV-01.c.recovery.attestation.schema/README.md).
- [ ] **INV-01.c.recovery.attestation.service** [I/M] Verificar contenido y atestiguar desde sesión administrativa — código implementado; 23 SQL de regresión, 53 unitarias + 8 finales (con solapamiento). TypeScript global falla en Tesorería concurrente; V2 real y aceptación pendientes. [Evidencia](evidencia/2026-11-11/INV-01.c.recovery.attestation.service/README.md).
- [ ] **INV-01.c.recovery.historical** [I/M] Reconstruir receta histórica desde documento atestiguado — código implementado; 60 unitarias de regresión y 5 SQL propios finales; seguimiento con null/ausencia y TypeScript corregido en recovery.provenance; V2 integrada/aceptación pendientes. [Evidencia](evidencia/2026-11-11/INV-01.c.recovery.historical/README.md).
- [ ] **INV-01.c.recovery.provenance** [I/M] Vincular expediente con atestación exacta y precisión nativa — código implementado; 65 unitarias de regresión + 21 finales con solapamiento, 15 SQL, tipos/lint correctos; build en curso y aceptación pendiente. [Evidencia](evidencia/2026-11-11/INV-01.c.recovery.provenance/README.md).
- [ ] **INV-01.c.recovery.sources** [I/M] Leer fuentes SALE/NO_PRIOR_CONSUMPTION desde documentos atestiguados — código implementado; 9 unitarias nuevas, 10 SQL con regresión, tipos/lint y trazabilidad correctos; build exit 0; suite global con timeout del seed (reintento aislado exit 1). Expediente/aprobación/aplicación pendientes. [Evidencia](evidencia/2026-11-11/INV-01.c.recovery.sources/README.md).
- [ ] **INV-01.c.recovery.proposal.service** [I/M] Preparar y registrar expediente desde las tres fuentes del servidor — código implementado; 47 unitarias focales, 8 SQL propias finales + 17 regresiones, tipos/lint correctos y build exit 0. Suite global exit 1; decisión independiente y aplicación pendientes. [Evidencia](evidencia/2026-11-11/INV-01.c.recovery.proposal.service/README.md).
- [ ] **INV-01.c.recovery.decision.service** [I/M] Decisión administrativa independiente ligada a propuesta y estado verificado — código implementado (A2); V1 (14/14 + 17 regresión) y V2 en Neon aislado `pulso_app` (5/5), tipos/lint exit 0; dependencia `INV-01.b` y aplicación auditada (`A3`) pendientes. [Evidencia](evidencia/2026-11-11/INV-01.c.recovery.decision.service/README.md).
- [ ] **Checkpoint 1.1** — revisar los últimos 2–3 hijos ejecutados: pruebas del recorrido, tipos/lint, evidencia y regresión aplicable.
- [ ] **INV-01.d** [A/M] Aceptar corrección y anulación por API/UI
- [ ] **INV-02** [I/M] Definir quién consume cada receta
- [ ] **Puerta 1** — hijos requeridos aceptados, build del hito de código, V2/V3 aplicables y matriz enlazada.

## 2. Nómina calculada y explicable

- [x] **NOM-01** [I/M] Fijar unidad salarial y vigencias — aceptado V1/V2 (`B1+B2`, `eba576d`); [evidencia](evidencia/2026-11-11/NOM-01/README.md).
- [x] **NOM-02.a** [I/M] Calcular base desde asistencia aprobada — aceptado V1/V2 (`B2`, `eba576d`); [evidencia](evidencia/2026-11-11/NOM-01/README.md).
- [ ] **NOM-02.b** [I/M] Incorporar horas extra aprobadas
- [ ] **Checkpoint 2.1** — revisar los últimos 2–3 hijos ejecutados: pruebas del recorrido, tipos/lint, evidencia y regresión aplicable.
- [ ] **NOM-02.c1** [I/M] Incorporar vacaciones y permisos
- [ ] **NOM-02.c2** [I/M] Incorporar bonos e incidencias
- [ ] **NOM-02.d1** [I/M] Calcular ISR ordinario
- [ ] **Checkpoint 2.2** — revisar los últimos 2–3 hijos ejecutados: pruebas del recorrido, tipos/lint, evidencia y regresión aplicable.
- [ ] **NOM-02.d2** [I/M] Calcular deducción obrera de seguridad social
- [ ] **NOM-02.d3** [I/M] Aplicar préstamos y descuentos autorizados
- [ ] **NOM-02.e** [I/M] Sustituir la carga patronal fija del 35%
- [ ] **Checkpoint 2.3** — revisar los últimos 2–3 hijos ejecutados: pruebas del recorrido, tipos/lint, evidencia y regresión aplicable.
- [ ] **NOM-06** [I/M] Bloquear resultados incompletos
- [ ] **NOM-03** [I/M] Aprobar un snapshot inmutable
- [ ] **NOM-04.a** [I/M] Unificar recibos y exportación
- [ ] **Checkpoint 2.4** — revisar los últimos 2–3 hijos ejecutados: pruebas del recorrido, tipos/lint, evidencia y regresión aplicable.
- [ ] **NOM-04.b** [A/M] Aceptar timbrado con FiscalAPI existente
- [ ] **NOM-05** [I/M] Enlazar obligación neta con tesorería
- [ ] **Puerta 2** — hijos requeridos aceptados, build del hito de código, V2/V3 aplicables y matriz enlazada.

## 3. Banca, comisiones y coordinación con FC-12

- [ ] **SEC-05.tesoreria** [A/M] Aceptar RLS y privilegios de tesorería
- [ ] **BAN-01** [A/M] Aceptar cuentas e importación bancaria
- [ ] **BAN-04** [A/M] Aceptar matching de egresos
- [ ] **Checkpoint 3.1** — revisar los últimos 2–3 hijos ejecutados: pruebas del recorrido, tipos/lint, evidencia y regresión aplicable.
- [ ] **BAN-05** [I/M] Completar identidad de ingresos esperados
- [ ] **BAN-06.a** [A/M] Aceptar conciliación de depósitos existente
- [ ] **BAN-06.b** [I/M] Resolver corrección auditada de un depósito contabilizado
- [ ] **Checkpoint 3.2** — revisar los últimos 2–3 hijos ejecutados: pruebas del recorrido, tipos/lint, evidencia y regresión aplicable.
- [ ] **FIN-06.a** [I/M] Separar importe reportado y conciliado
- [ ] **FIN-06.b** [A/M] Aceptar comisiones e ingresos por canal
- [ ] **FIN-01** [I/M] Distinguir saldo conciliado de caja proyectada
- [ ] **Checkpoint 3.3** — revisar los últimos 2–3 hijos ejecutados: pruebas del recorrido, tipos/lint, evidencia y regresión aplicable.
- [ ] **Puerta 3** — hijos requeridos aceptados, build del hito de código, V2/V3 aplicables y matriz enlazada.

## 4. Evidencia, excepciones y aprobaciones

- [x] **AUD-02** [I/M] Hacer obligatoria la auditoría crítica — aceptado V1/V2 (`C1+C2`, `eba576d`); [evidencia](evidencia/2026-11-11/AUD-02/README.md) y [cierre V2](evidencia/2026-11-11/EVI-02.a/README.md).
- [x] **EVI-02.a** [I/M] Añadir sujetos de evidencia — aceptado V1/V2 (`C2`, `eba576d`); [evidencia](evidencia/2026-11-11/EVI-02.a/README.md).
- [ ] **EVI-02.b** [I/M] Conectar evidencia al recorrido visible
- [ ] **Checkpoint 4.1** — revisar los últimos 2–3 hijos ejecutados: pruebas del recorrido, tipos/lint, evidencia y regresión aplicable.
- [ ] **EXC-01** [A/M] Aceptar persistencia canónica de excepciones
- [ ] **EXC-02** [A/M] Aceptar sync legacy → canónico
- [ ] **EXC-03.a** [A/M] Probar lifecycle concurrente
- [ ] **Checkpoint 4.2** — revisar los últimos 2–3 hijos ejecutados: pruebas del recorrido, tipos/lint, evidencia y regresión aplicable.
- [ ] **EXC-03.b** [A/M] Probar job recuperable de SLA
- [ ] **EXC-05** [I/M] Conectar acciones canónicas en la UI
- [ ] **EXC-04.merma** [I/M] Completar excepción de merma
- [ ] **Checkpoint 4.3** — revisar los últimos 2–3 hijos ejecutados: pruebas del recorrido, tipos/lint, evidencia y regresión aplicable.
- [ ] **EXC-04.presupuesto** [I/M] Completar excepción de presupuesto
- [ ] **EXC-04.ausencia** [I/M] Completar excepción de ausencia
- [ ] **EXC-04.banco** [I/M] Completar excepción bancaria
- [ ] **Checkpoint 4.4** — revisar los últimos 2–3 hijos ejecutados: pruebas del recorrido, tipos/lint, evidencia y regresión aplicable.
- [ ] **APR-01** [I/P] Alinear aprobación de documentos
- [ ] **Puerta 4** — hijos requeridos aceptados, build del hito de código, V2/V3 aplicables y matriz enlazada.

## 5. Producción, conteos y costos de inventario

- [ ] **PROD-00** [R/S] Rastrear modelos y consumidores de producción
- [ ] **PROD-01.a** [I/M] Crear lote de producto terminado
- [ ] **PROD-01.b** [I/M] Consumir elaborado sin descontar dos veces
- [ ] **Checkpoint 5.1** — revisar los últimos 2–3 hijos ejecutados: pruebas del recorrido, tipos/lint, evidencia y regresión aplicable.
- [ ] **PROD-02** [I/M] Unificar planificación y ejecución visible
- [ ] **REC-03A** [R/M] Revalidar lotes con anomalía histórica
- [ ] **REC-03B** [A/M] Aceptar protocolo de corrección histórica
- [ ] **Checkpoint 5.2** — revisar los últimos 2–3 hijos ejecutados: pruebas del recorrido, tipos/lint, evidencia y regresión aplicable.
- [ ] **INV-03** [I/M] Completar conteo → revisión → ajuste
- [ ] **INV-04** [I/M] Congelar costo y varianza del período
- [ ] **INV-05** [A/M] Aceptar PAR/min-max y snapshots
- [ ] **Checkpoint 5.3** — revisar los últimos 2–3 hijos ejecutados: pruebas del recorrido, tipos/lint, evidencia y regresión aplicable.
- [ ] **Puerta 5** — hijos requeridos aceptados, build del hito de código, V2/V3 aplicables y matriz enlazada.

## 6. Operación, mantenimiento, delivery y cumplimiento

- [ ] **OPE-00** [R/S] Rastrear writers y recorridos operativos
- [ ] **OPE-01.a** [I/M] Completar configuración de recurrencias
- [ ] **OPE-01.b** [I/M] Generar órdenes de forma durable
- [ ] **Checkpoint 6.1** — revisar los últimos 2–3 hijos ejecutados: pruebas del recorrido, tipos/lint, evidencia y regresión aplicable.
- [ ] **OPE-02** [I/M] Completar historial de mantenimiento
- [ ] **OPE-03.aceite** [I/M] Completar medición de aceite
- [ ] **OPE-03.cocina** [A/M] Aceptar rutina de cocina
- [ ] **Checkpoint 6.2** — revisar los últimos 2–3 hijos ejecutados: pruebas del recorrido, tipos/lint, evidencia y regresión aplicable.
- [ ] **OPE-03.salon** [A/M] Aceptar rutina de salón/counter
- [ ] **OPE-03.gerente** [A/M] Aceptar checklist del gerente
- [ ] **OPE-03.handoff** [I/M] Completar entrega de turno
- [ ] **Checkpoint 6.3** — revisar los últimos 2–3 hijos ejecutados: pruebas del recorrido, tipos/lint, evidencia y regresión aplicable.
- [ ] **OPE-04** [I/M] Capturar disponibilidad delivery
- [ ] **CMP-01** [I/M] Cerrar planes correctivos con historial
- [ ] **Puerta 6** — hijos requeridos aceptados, build del hito de código, V2/V3 aplicables y matriz enlazada.

## 7. Finanzas históricas, centros de costo y canales

- [ ] **FIN-02.a** [I/M] Fijar contrato de cierre financiero
- [ ] **FIN-03.a** [I/M] Completar imputación a centro de costo
- [ ] **FIN-03.b** [I/M] Reportar P&L por centro de costo
- [ ] **Checkpoint 7.1** — revisar los últimos 2–3 hijos ejecutados: pruebas del recorrido, tipos/lint, evidencia y regresión aplicable.
- [ ] **FIN-04** [I/M] Completar solicitud de pago trazable
- [ ] **FIN-05** [A/M] Aceptar presupuestos y períodos
- [ ] **FIN-02.b** [I/M] Leer P&L congelado
- [ ] **Checkpoint 7.2** — revisar los últimos 2–3 hijos ejecutados: pruebas del recorrido, tipos/lint, evidencia y regresión aplicable.
- [ ] **FIN-07** [I/P] Definir indicadores económicos
- [ ] **INT-01** [I/M] Versionar mapeo de canal a receta/SKU
- [ ] **INT-02** [I/P] Completar importación por fuente disponible
- [ ] **Checkpoint 7.3** — revisar los últimos 2–3 hijos ejecutados: pruebas del recorrido, tipos/lint, evidencia y regresión aplicable.
- [ ] **INT-03** [A/M] Aceptar corte → mix → settlement → depósito
- [ ] **Puerta 7** — hijos requeridos aceptados, build del hito de código, V2/V3 aplicables y matriz enlazada.

## 8. Seguridad restante, aceptación y despliegue

- [ ] **SEC-05.nomina** [A/M] Aceptar aislamiento de nómina
- [ ] **SEC-05.inventario** [I/M] Completar aislamiento de inventario
- [ ] **SEC-05.resto** [I/P] Completar aislamiento por dominio
- [ ] **Checkpoint 8.1** — revisar los últimos 2–3 hijos ejecutados: pruebas del recorrido, tipos/lint, evidencia y regresión aplicable.
- [ ] **PER-01** [A/P] Demostrar ocho perfiles
- [ ] **VAL-01.M01-M17** [A/P] Aceptar cada módulo y sus filas
- [ ] **VAL-01.transversal** [A/P] Aceptar recorridos transversales
- [ ] **Checkpoint 8.2** — revisar los últimos 2–3 hijos ejecutados: pruebas del recorrido, tipos/lint, evidencia y regresión aplicable.
- [ ] **OPS-03** [A/P] Aplicar lotes revisados al entorno identificado
- [ ] **VAL-02** [A/P] Ejecutar piloto, carga y restauración
- [ ] **VAL-03** [A/S] Cerrar trazabilidad de las 239 filas
- [ ] **Checkpoint 8.3** — revisar los últimos 2–3 hijos ejecutados: pruebas del recorrido, tipos/lint, evidencia y regresión aplicable.
- [ ] **Puerta 8** — hijos requeridos aceptados, build del hito de código, V2/V3 aplicables y matriz enlazada.

## Registro de ejecución

| ID/hijo | Estado | HEAD/diff | Entorno | Comando / exit | Evidencia | Filas | Pendiente |
|---|---|---|---|---|---|---|---|
| P0-01 | aceptado D | ba88018 + diff inicial | local | git HEAD/status/diff, exit 0 | [Base](evidencia/2026-11-11/P0-01/README.md) | todas, sin aceptación funcional | Captura inmutable; entorno nuevo registrado aparte |
| P0-02 | aceptado D | ba88018 + CSV nuevo | local | validador, exit 0 | [Matriz](evidencia/2026-11-11/P0-02/README.md) | 239; delta 17.12–17.14 | Aceptación funcional de cada fila pendiente |
| P0-03 | aceptado D | ba88018 + mapa/validador/pruebas | local | 11 unitarias de trazabilidad y validador, exit 0 | [Mapa](evidencia/2026-11-11/P0-03/README.md) | 239 | Ejecutar los hijos y conservar evidencia por recorrido |
| P0-04 | aceptado D,V2 en entorno nuevo | ba88018 + diagnóstico/baseline | Neon nuevo main + rama aislada | dos manifiestos de solo lectura, exit 0; 9 unitarias | [Inventario](evidencia/2026-11-11/P0-04/README.md) | transversal | Cuenta anterior no verificada; 136 fuentes BASELINED, no replay histórico |
| SEC-00 | aceptado V2 | ba88018 + arnés focal | rama br-round-voice-belheola | 4/4, exit 0 | [Aislamiento](evidencia/2026-11-11/SEC-00/README.md) | transversal | SEC-05 por dominio y V3 no sustituidos por este arnés |
| P0-05 | aceptado D | ba88018 + coordinación documental | local | revisión de contratos + validador, exit 0 | [Coordinación](evidencia/2026-11-11/P0-05/README.md) | 17.12–17.16; 18.R5–R8 | Conservar propiedad de FC-12; no marcarlo terminado |
| NEON-NEW | instalación verificada | baseline de esquema local hasta 0136 | soft-cloud-50478212 | transacción aditiva + catálogos, correctos | [Instalación](evidencia/2026-11-11/NEON-NEW/README.md) | ninguna aceptada por instalar | Base vacía; sin datos de otra cuenta ni aplicación desplegada |
| INV-01.a1 | aceptado V1 | ba88018 + contrato/pruebas | local + caracterización Neon | 27 unitarias nuevas, tipos/lint, exit 0 | [Contrato](evidencia/2026-11-11/INV-01.a1/README.md) | 11.11 parcial | No convierte head desconocido en cero; sin backfill |
| INV-01.a2 | aceptado V1,V2 | ba88018 + schema/0137/journal/snapshot/prueba | br-round-voice-belheola | 7 SQL nuevas + 4 del arnés, exit 0 | [Persistencia](evidencia/2026-11-11/INV-01.a2/README.md) | 11.11 parcial | 0137 pendiente en main; sin aplicación real de stock |
| INV-01.a | aceptado V1,V2 | dos hijos + incremento documental | local/aislado | 51 unitarias, 11 SQL, tipos/lint/build exit 0 | [Checkpoint](evidencia/2026-11-11/INV-01.a/results.json) | 11.11 sigue parcial | INV-01.b/c/d e INV-02 pendientes |
| INV-01.b | en curso, b1/b2a/b2 aceptados | ba88018 + incrementos separados | local + rama aislada | checkpoint 85 unitarias/17 SQL, tipos/lint/build exit 0 | [Preparación](evidencia/2026-11-11/INV-01.b/README.md) | 11.11 sigue parcial | b3/b4: ingreso por revisión, writer/proyección atómicos e integración pendientes |
| INV-01.b1 | aceptado V1 | ba88018 + delta/prueba | local | 20 nuevas, 150 secuencias, tipos/lint/build exit 0 | [Planificador](evidencia/2026-11-11/INV-01.b1/README.md) | 11.11 sigue parcial | No acredita aplicación física |
| INV-01.b2a | aceptado V1,V2 | ba88018 + schema/0138/journal/snapshot/prueba | br-round-voice-belheola | 5 SQL nuevas, catálogo y grants; checkpoint 85 unitarias/17 SQL, tipos/lint/build exit 0 | [Catálogo](evidencia/2026-11-11/INV-01.b2a/README.md) | 11.11 sigue parcial | 0138 pendiente main; owner/writers en SEC-05 |
| INV-01.b2 | aceptado V1,V2 | ba88018 + snapshot/reader/pruebas | local + rama aislada | snapshot runtime y JSONB, dentro de 17 SQL; checkpoint 85 unitarias y build exit 0 | [Snapshot](evidencia/2026-11-11/INV-01.b2/README.md) | 11.11 sigue parcial | b3/b4 y recuperación/aceptación pendientes |
| INV-01.b3a | aceptado V1,V2 (CHECKPOINT-INV-B3) | ba88018 + schema/0139/journal/snapshot/prueba; revisado en 5a05fb9 + diff | br-round-voice-belheola | 34 SQL conjuntas, 83+20 unitarias, tsc/lint/build exit 0 | [Ingreso/permisos](evidencia/2026-11-11/INV-01.b3a/README.md) | 11.11 sigue parcial | 0139 pendiente en main; padre b y recorrido operativo pendientes |
| INV-01.b3 | aceptado V1,V2 (CHECKPOINT-INV-B3) | ba88018 + servicio/prueba real; fix huérfanos en 5a05fb9 + diff | br-round-voice-belheola | 34 SQL conjuntas, 83+20 unitarias, tsc/lint/build exit 0 | [Aplicación](evidencia/2026-11-11/CHECKPOINT-INV-B3/README.md) | 11.11 sigue parcial | Conectar b4 y aceptar c/d; sin activación operativa |
| INV-01.b4a | aceptado V1 (CHECKPOINT-INV-B3) | ba88018 + parser/plan/pruebas; validado en 5a05fb9 + diff | local, fase pura | 103 unitarias/6 archivos, tsc/lint/validador/build exit 0 | [Normalización/agrupación](evidencia/2026-11-11/INV-01.b4a/README.md) | 11.11 sigue parcial | Conectar writer en b4b/b4; sin aceptación operativa |
| INV-01.b4b.rls | código implementado; V2 comprobada | 2be55da + 0141/journal/snapshot/prueba SQL | rama aislada, GRANT dentro de rollback | 15 SQL conjuntas exit 0; DML/aislamiento comprobados | [Permiso mínimo](evidencia/2026-11-11/INV-01.b4b/README.md) | 11.11 sigue parcial | 0141 pendiente de aplicación; dependencias y checkpoint global sin aceptar |
| INV-01.b4b | código implementado; V1/V2 focales y build comprobados | 2be55da + adaptador/writer/pruebas | local + rama aislada | 109 unitarias, 15 SQL, tsc global/lint/validador y build exit 0; heap 4 GB para build | [Ingestión atómica](evidencia/2026-11-11/INV-01.b4b/README.md) | 11.11 sigue parcial | Dependencias/checkpoint; cobertura en lectores y fronteras API/UI en b4/d; sin despliegue |
| INV-01.b4.manual | código implementado; V1/V2 focales comprobadas | 2be55da inicial → e6a93ff concurrente + diff del incremento | local + rama aislada | 124 unitarias/10 archivos, 16 SQL, tsc global exit 0; lint exit 0 con warning previo; build del hito UI exit 0 | [Captura atómica](evidencia/2026-11-11/INV-01.b4/README.md) | 11.11 sigue parcial | Checkpoint, aceptación real API/UI y cobertura de lectores pendientes |
| INV-01.b4.bulk | código implementado; pruebas de frontera comprobadas | mismo diff | local; persistencia común V2 en b4b | 5 pruebas nuevas incluidas en 124, tsc/lint exit 0 | [Bulk](evidencia/2026-11-11/INV-01.b4/README.md) | 11.11 sigue parcial | HTTP real y UI no aceptados; sin despliegue |
| INV-01.b4.smartlink | código implementado; pruebas de frontera comprobadas | mismo diff | local; persistencia común V2 en b4b | 4 pruebas nuevas incluidas en 124, tsc/lint exit 0 | [Archivo POS del cierre](evidencia/2026-11-11/INV-01.b4/README.md) | 11.11 sigue parcial | HTTP/SQL real de vinculación, storage durable y workflow completo pendientes |
| INV-01.b4.ui | código implementado; navegador aislado y build comprobados | b91355b + cliente/harness/spec/config | Chromium aislado; HTTP sintético; sin DB operativa | 9/9 navegador, lint, tsc y build exit 0; escritorio/móvil sin errores de consola | [UI y capturas](evidencia/2026-11-11/INV-01.b4.ui/README.md) | 11.11 sigue parcial | Sesión/API/DB reales, recovery/carreras y lectores financieros pendientes |
| INV-01.c.races | V2 comprobada; aceptación dependiente pendiente | fddc05d inicial → a816208 concurrente + test nuevo | br-round-voice-belheola, conexiones reales pulso_app | 5 carreras nuevas + 16 regresiones SQL: 21/21 exit 0; tipado focal ES2017/lint exit 0 | [Concurrencia y manifiestos](evidencia/2026-11-11/INV-01.c.races/README.md) | 11.11 sigue parcial | INV-01.b sin aceptar; reparación auditada en c.recovery pendiente; fixtures sintéticas append-only retenidas |
| INV-01.c.recovery.contract | Código implementado; V1 comprobada, dependencias sin aceptar | 3a5d60c + diff compartido | Windows local; contrato puro, sin DB | 54/54 unitarias; tipos globales, lint y build exit 0 | [Contrato y resultados](evidencia/2026-11-11/INV-01.c.recovery.contract/README.md) | 11.11 sigue parcial | Persistencia, lectura de pruebas verificadas y aplicación auditada pendientes |
| INV-01.c.recovery.* (10 hijos: objects, persistence, subject.schema/access, attestation.schema/service, historical, provenance, sources, proposal.service) | código implementado (en mapa; ver filas 49–58) | árbol local + 0143–0145 | local + br-round-voice-belheola | unitarias/SQL focales en evidencias propias; build en proposal.service exit 0 (suite global con timeout seed) | [Propuestas](evidencia/2026-11-11/INV-01.c.recovery.proposal.service/README.md) | 11.11 sigue parcial | Decisión administrativa independiente, aplicación auditada/idempotente, rutas/UI y aceptación con sesión/R2 reales |
| NOM-01 | aceptado V1,V2 | eba576d + diff B2 | local + br-round-voice-belheola (pulso_app) | 17/17 + 7/7 unitarias y 6/6 SQL Neon (con NOM-02.a), tsc/lint exit 0 | [NOM-01](evidencia/2026-11-11/NOM-01/README.md) | 12.x parcial | NOM-02.b..e y NOM-03..06 pendientes |
| NOM-02.a | aceptado V1,V2 | eba576d + diff B2 | local + br-round-voice-belheola (pulso_app) | 14/14 NOM-02.a (38/38 nómina) y 6/6 SQL Neon, tsc/lint exit 0 | [NOM-01](evidencia/2026-11-11/NOM-01/README.md) | 12.x parcial | Siguiente: NOM-02.b (horas extra) |
| AUD-02 | aceptado V1,V2 | eba576d + diff C1/S/C2 | PGlite + br-round-voice-belheola (pulso_app) | 19/19 PGlite + 10/10 SQL Neon atomicidad, tsc/lint exit 0 | [AUD-02](evidencia/2026-11-11/AUD-02/README.md) | 01.06 parcial | Enum `SALE_RECOVERY_APPLY`/`SALE_VOID` diferido a migración A3/INV-01.d |
| EVI-02.a | aceptado V1,V2 | eba576d + diff C2 | local + br-round-voice-belheola (pulso_app) | 18/18 unitarias + 7/7 SQL Neon, tsc/lint exit 0 | [EVI-02.a](evidencia/2026-11-11/EVI-02.a/README.md) | 01.07 parcial | Siguiente: EVI-02.b (recorrido visible/UI) |
| INV-01.c.recovery.decision.service | código implementado; V1/V2 comprobadas | eba576d + diff A2 | local + br-round-voice-belheola (pulso_app) | 14/14 + 17 regresión y 5/5 SQL Neon, tsc/lint exit 0 | [Decisión recovery](evidencia/2026-11-11/INV-01.c.recovery.decision.service/README.md) | 11.11 sigue parcial | Dependencia INV-01.b y aplicación auditada (A3) pendientes |

## Reglas para los padres

- [ ] SEC-05.resto subdividido por dominio y tablas (14 hijos ya materializados en mapa; pendiente verificar delimitación y ejecutar).
- [x] PER-01 subdividido por perfil/capacidad y alcance (ocho hijos en el mapa; todos pendientes).
- [x] APR-01 subdividido por documento (compra/factura/gasto/pago/nómina; todos pendientes).
- [ ] INT-02 subdividido por fuente/formato disponible (5 hijos por fuente ya materializados en mapa: pos/uber/rappi/didi/otros; pendiente verificar delimitación y ejecutar).
- [x] FIN-07 subdividido por indicador (ticket, prime cost, contribución y unit economics; todos pendientes).
- [x] VAL-01.M01-M17 subdividido por módulo y filas; dependencias tomadas del mapa P0-03.
- [x] VAL-01.transversal subdividido por recorrido/caso (siete casos y canales; perfiles en PER-01; todos pendientes).
- [ ] OPS-03 instanciado por lote aceptado y entorno identificado.
- [ ] VAL-02 separado en carga, restauración y piloto operativo.

## Puerta final

- [ ] VAL-03 acredita las 239 filas o enumera pendientes explícitos; sin declaración de cierre total indebida.
- [ ] Sin dependencias huérfanas ni ciclos después de añadir hijos.
- [ ] Sin mezcla de cambios de otros frentes; sin migración/despliegue supuesto.

## Estado vigente S0 / Integración S (2026-11-15)

- **Baseline y reparto activo:** ver [investigación y reparto](2026-11-15-investigacion-y-sesiones-faltantes.md) y [baseline S0, manifiesto de entornos y turnos A1/B1/C1](2026-11-15-s0-baseline-y-reparto.md).
- **Consolidación S tras A1/B1/C1:** `INV-01.b4*` ([evidencia A1](evidencia/2026-11-11/INV-01.b4/A1-INTEGRACION-EVIDENCIA.md)), `NOM-01` ([evidencia B1](evidencia/2026-11-11/NOM-01/README.md)) y `AUD-02` ([evidencia C1](evidencia/2026-11-11/AUD-02/README.md)) consolidados en estado `código implementado` (no aceptados aún: faltan V2 real de Postgres para `NOM-01`/`AUD-02`, y R2/sesión real/cobertura financiera para `INV-01.b4*`). `audit-service.ts` alineado en S al enum `inventory_audit_entity` de `schema.ts`.
- **Contabilidad FC-15–21:** FC-15–20 completadas técnicamente en local ([checklist contable](finanzas-contabilidad/todo.md)); migraciones `0146`–`0150` locales sin aplicar y FC-21 pendiente de revisión presencial del responsable contable. Reutilizar para `NOM-05` y `FIN-01/02` sin recrear libro mayor ni cierre.
