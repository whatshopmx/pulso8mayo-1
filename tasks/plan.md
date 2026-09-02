# Plan activo: cierre de la auditoría de Finanzas

> **Estado: cerrado el 2026-09-01.** Fases 0–5 completas, más A6.1 y A6.3 de la fase 6.
> Abiertas: A6.2 (🔒 D4), A6.4 (diferida por alcance) y A6.5 (🔒 D5).
>
> **Este archivo es un puntero.** El plan canónico, con decisiones, riesgos y premisas
> descartadas, vive en `tasks/plan-cierre-auditoria-finanzas.md`. El detalle por tarea está en
> `tasks/todo-cierre-auditoria-finanzas.md`. `tasks/plan.md` y `tasks/todo.md` son borradores
> que cada plan sobrescribe; no editar aquí lo que pertenece al canónico.
>
> Reemplaza al plan anterior (Incident Resolution — System Action Gaps), cerrado en `3c003cc`.

## Overview

Auditoría de lectura de código sobre `app/dashboard/finance` (13 pantallas, 38 rutas API, 13
servicios) contra el perfil objetivo: grupo QSR de 3 a 15 sucursales en Monterrey. 15 hallazgos.

El módulo calcula bien y opera mal. La capa de cálculo declara la procedencia de cada cifra y no
inventa constantes — ese es el activo y no se toca. Fallan la capa donde el dinero se mueve
(flujo de efectivo sin entradas proyectadas, layout bancario sin CLABE) y la capa que controla
quién lo mueve (segregación aplicada al aprobar pero no al pagar; doble firma saltable).

Reporte: https://claude.ai/code/artifact/9e752612-227d-471e-994c-2fb46b5478c6

## Fases

- [ ] **Fase 0 — Los dos huecos de control** (F3, F4) · P0 · A0.1–A0.3
- [ ] **Checkpoint:** nadie mueve dinero solo
- [ ] **Fase 1 — Encender el flujo de efectivo** (F1) · P0 · A1.1–A1.3
- [ ] **Checkpoint:** "¿me alcanza?" contesta
- [ ] **Fase 2 — Tesorería que opera** (F2, F10, F13) · P0 · A2.1–A2.6
- [ ] **Checkpoint:** el archivo se puede subir al banco
- [ ] **Fase 3 — La base de los números** (F5, F6) · A3.1–A3.3
- [ ] **Checkpoint:** el semáforo dice la verdad
- [ ] **Fase 4 — Cerrar el circuito del gasto** (F7, F8) · A4.1–A4.3
- [ ] **Checkpoint:** el gasto es auditable
- [ ] **Fase 5 — Control interno que detecta** (F9, F11, F12) · A5.1–A5.6
- [ ] **Checkpoint:** la excepción vale lo que cuesta
- [ ] **Fase 6 — Producto** (F14, F15) · A6.1–A6.5

## Decisiones que bloquean

| # | Pregunta | Bloquea | Recomendación |
|---|---|---|---|
| D1 | ¿Qué se hace cuando el POS no exporta el IVA? | A3.2 | Tasa configurable por tenant, default 16, procedencia `DERIVED`; `null` = base bruta declarada |
| D2 | ¿De dónde sale el factor de carga patronal? | A3.3 | `laborBurdenFactorPercent` nullable en `tenant_operating_config`, con ISN de NL como línea propia |
| D3 | ¿Se sostienen los formatos Banorte y BBVA? | A2.6 | Sin el layout real del banco, dejar sólo el genérico y quitar los otros dos del menú |
| D4 | ¿Cómo entran las promociones de agregador? | A6.2 | Es la captura de liquidación que `plan-finance-module-gaps.md` dejó como opción (c) |
| D5 | ¿Pulso emite REP o sólo lo concilia? | A6.5 | La responde el contador del cliente |

## Riesgo que ordena las fases

Meter la CLABE en claro en la respuesta del layout **sin** cambiar antes su autorización
(`reports:read`, que GERENTE tiene) convierte un archivo inútil en una fuga de datos bancarios de
todos los proveedores del grupo. **A2.2 va antes que A2.3, en el mismo PR.**

El resto de riesgos y las premisas ya descartadas están en el plan canónico.
