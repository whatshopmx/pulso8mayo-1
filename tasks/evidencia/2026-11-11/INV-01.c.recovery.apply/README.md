# Evidencia de Implementación: INV-01.c.recovery.apply (Ola 3 — Milestone M-A3)

**Frente**: M-A3 (`INV-01.c.recovery` — Aplicación auditada de recuperación histórica)  
**Fecha**: 2026-11-15  
**Estado**: Completado y verificado (V1 unitario y V2 en Postgres Neon aislado bajo `pulso_app`)  

---

## 1. Objetivo y Contexto

En el marco de la Ola 3, el objetivo de **M-A3** es implementar la **aplicación auditada de propuestas de recuperación histórica** de ventas (`INV-01.c.recovery`), conectando la propuesta preparada en A1 (`sale_recovery_proposals`) y la decisión administrativa independiente tomada en A2 (`sale_recovery_decisions`) con la deducción real de inventario y la creación de la revisión 1 en el subsistema de consumo de ventas (`sales_consumption_revisions`), todo bajo el contrato estricto de auditoría crítica **AUD-02** en una transacción serializable con bloqueos consultivos.

### Invariantes del Sistema Resueltos
1. **Transaccionalidad Atómica y Serialización**: La aplicación ejecuta en transacción serializable de PostgreSQL con advisory locks basados en el día civil y sucursal (`pg_advisory_xact_lock(hashtextextended([companyId, branchId, saleDay], 0))`).
2. **Revalidación y Segregación**: Revalida frescura de venta legada (`sales_entries.updatedAt`), integridad documental (`evidence.deletedAt IS NULL`, `evidence.updatedAt`), coincidencia de hashes (`stateHash`, `proposalHash`), aprobación administrativa previa (`sale_recovery_decisions.decision = 'APPROVED'`) y estricta segregación de funciones (`decision.decidedBy <> proposal.requestedBy`).
3. **Compatibilidad con el Writer Ordinario de Consumo**:
   - Genera movimientos físicos en `inventory_movements` con `type = 'USAGE'`, `reference_id = 'salecons:' + identityId`, `reason = 'Venta revisión 1'`. Esto garantiza que `checkAllocations()` en `sale-consumption-service.ts` reconozca las asignaciones y no bloquee el sistema con `PENDING_RECOVERY`.
   - Crea la revisión en `sales_consumption_revisions` con `revision: 1`, `previousRevision: null`, `previousQuantitySold: '0.00'`, `quantitySold`, `totalRevenue`, `recipeSnapshot`, `allocations` y `movementRefs`.
4. **Idempotencia Determinista**: Si la propuesta ya fue aplicada (existe revisión 1 para la identidad de consumo), el servicio retorna `{ applied: false, alreadyApplied: true, revisionId, identityId }` sin volver a descontar stock ni generar movimientos o revisiones duplicadas.
5. **Auditoría Crítica AUD-02 con Cero Migraciones**:
   - Se utiliza la entidad canónica existente `entityType: 'ADJUSTMENT'` con `action: 'CREATE'`, `isCritical: true`, `reason` obligatorio (mínimo 4 caracteres) y metadatos estructurados `{ subtype: 'SALE_RECOVERY_APPLY', proposalId, proposalHash, stateHash, decisionId, legacySaleId, identityId, revisionId, movementsCount }`.
   - Esto evita alterar el enum `inventory_audit_entity` de PostgreSQL, previniendo errores de concurrencia (`55P04: unsafe use of new value`) y eliminando conflictos de migración con otros frentes de trabajo (B3 y C3).
6. **Seguridad bajo `pulso_app` (`NOBYPASSRLS`)**:
   - Las consultas a tablas inmutables (`sale_recovery_proposals`, `sale_recovery_decisions`) no utilizan `.for('share')` ni `.for('update')`, evitando el error de privilegios insuficientes `PG 42501`.

---

## 2. Asignación Disjunta de Archivos (Frente A3)

| # | Archivo | Rol |
|---|---|---|
| 1 | `lib/services/sale-recovery-apply.ts` | **NUEVO**: Servicio de aplicación de recuperación histórica atómica con locks consultivos, deducción FEFO (`allocateScopedBatches`), generación de movimientos, revisión 1 y auditoría AUD-02. |
| 2 | `app/api/inventory/sales-entry/recovery-apply/route.ts` | **NUEVO**: Endpoint HTTP POST (`/api/inventory/sales-entry/recovery-apply`) con autenticación de sesión (`withTenantAuth`), autorización administrativa (`ADMIN`, `OWNER`, `SUPER_ADMIN`), resolución de branch scope y validación de payload `{ branchId, proposalId, reason }`. |
| 3 | `lib/services/__tests__/sale-recovery-apply.test.ts` | **NUEVO**: Suite completa de pruebas unitarias V1 con mocks detallados (éxito, idempotencia, 404, 409 por decisión rechazada o ausente, 400 por motivo AUD-02 corto, 403 por segregación, 409 por venta/evidencia alterada, 409 por stock insuficiente). |
| 4 | `tests/integration/sale-recovery-apply-db.test.ts` | **NUEVO**: Suite de pruebas de integración V2 contra base de datos Neon Postgres aislada (`.env.test`) bajo rol `pulso_app` (`NOBYPASSRLS`). |
| 5 | `tasks/evidencia/2026-11-11/INV-01.c.recovery.apply/README.md` | **NUEVO**: Este documento de evidencia técnica. |

---

## 3. Resultados de Pruebas Unitarias (V1)

Comando ejecutado:
```bash
pnpm exec vitest run --configLoader bundle lib/services/__tests__/sale-recovery-apply.test.ts
```

Salida:
```text
 RUN  v4.1.11 C:/Users/david/pulso29

 ✓ lib/services/__tests__/sale-recovery-apply.test.ts (10 tests) 180ms
   ✓ sale-recovery-apply (unit tests) > aplica exitosamente un expediente aprobado con asignación de stock, revisión 1 y auditoría AUD-02
   ✓ sale-recovery-apply (unit tests) > reintento idempotente devuelve alreadyApplied: true sin duplicar movimientos ni revisión
   ✓ sale-recovery-apply (unit tests) > rechaza con 404 si el expediente no existe
   ✓ sale-recovery-apply (unit tests) > rechaza con 409 si la decisión administrativa no existe
   ✓ sale-recovery-apply (unit tests) > rechaza con 409 si la decisión administrativa fue REJECTED
   ✓ sale-recovery-apply (unit tests) > rechaza con 400 si el motivo de auditoría tiene menos de 4 caracteres (regla AUD-02)
   ✓ sale-recovery-apply (unit tests) > rechaza con 403 si la decisión no cumple segregación de funciones (decidedBy === requestedBy)
   ✓ sale-recovery-apply (unit tests) > rechaza con 409 si la venta legada fue modificada posteriormente (frescura documental)
   ✓ sale-recovery-apply (unit tests) > rechaza con 409 si una de las evidencias fue retirada (deletedAt no nulo)
   ✓ sale-recovery-apply (unit tests) > revierte y arroja 409 si el stock disponible es insuficiente

 Test Files  1 passed (1)
      Tests  10 passed (10)
```

---

## 4. Resultados de Pruebas de Integración en Postgres Aislado (V2)

Comando ejecutado (contra Neon Postgres bajo rol de runtime `pulso_app` con `rolsuper: false` y `rolbypassrls: false`):
```bash
pnpm exec vitest run --configLoader bundle --config vitest.integration.config.ts tests/integration/sale-recovery-apply-db.test.ts
```

Salida:
```text
 RUN  v4.1.11 C:/Users/david/pulso29

 ✓ tests/integration/sale-recovery-apply-db.test.ts (6 tests) 14352ms
   ✓ INV-01.c.recovery.apply — Aplicación auditada runtime en Neon Postgres aislado (pulso_app NOBYPASSRLS) > aplica exitosamente propuesta aprobada: genera revisión 1, movimientos USAGE (salecons), descuenta lote y registra bitácora AUD-02
   ✓ INV-01.c.recovery.apply — Aplicación auditada runtime en Neon Postgres aislado (pulso_app NOBYPASSRLS) > reintento idempotente devuelve alreadyApplied: true sin duplicar revisión ni movimientos ni descontar stock adicional
   ✓ INV-01.c.recovery.apply — Aplicación auditada runtime en Neon Postgres aislado (pulso_app NOBYPASSRLS) > reversión atómica y rollback ante stock insuficiente
   ✓ INV-01.c.recovery.apply — Aplicación auditada runtime en Neon Postgres aislado (pulso_app NOBYPASSRLS) > rechaza con 409 si la decisión administrativa fue REJECTED
   ✓ INV-01.c.recovery.apply — Aplicación auditada runtime en Neon Postgres aislado (pulso_app NOBYPASSRLS) > rechaza con 400 si el motivo de auditoría tiene menos de 4 caracteres (regla AUD-02)
   ✓ INV-01.c.recovery.apply — Aplicación auditada runtime en Neon Postgres aislado (pulso_app NOBYPASSRLS) > rechaza con 409 si la venta legada fue alterada posteriormente (frescura documental)

 Test Files  1 passed (1)
      Tests  6 passed (6)
   Duration  16.48s
```

---

## 5. Verificación de Linter y Calidad

Comando ejecutado:
```bash
pnpm exec eslint lib/services/sale-recovery-apply.ts app/api/inventory/sales-entry/recovery-apply/route.ts lib/services/__tests__/sale-recovery-apply.test.ts tests/integration/sale-recovery-apply-db.test.ts
```

Resultado:
- **0 errores, 0 advertencias**.
- Cumplimiento 100% de tipos TypeScript estrictos, validación exhaustiva de parámetros y segregación de responsabilidades.
