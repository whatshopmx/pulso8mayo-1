# Historia de vacaciones — contrato de reconstrucción

Base: `b132eade8c2bcf3145ae53859752bdd51ac32864` más árbol local compartido; código/especificación final en `bc225f37adf7bfbb2bbd3e284c78776dff81bdd5`. `NOM-02.c1.history.contract` llega a V1; no se acepta el historial ni NOM-02.c1. El módulo no está seleccionado por el lector de nómina y no modifica saldos o solicitudes.

## Problema y contrato

El lector actual suma `days_balance` y usa `leave_balances.balance` como fallback. Aunque filtra anualidades futuras, esas columnas mutables no conservan cuánto quedaba antes de consumos o correcciones posteriores. Las rutas de permisos también modifican balances, y `leave/balances` permite enviar importes del propio usuario sin una capacidad administrativa explícita; `withTenantAuth` solo exige sesión/empresa. Estas rutas no constituyen por sí mismas una fuente histórica verificada.

El [contrato y desglose](../../../../plans/2026-11-23-vacation-history.md) fija la fuente que habrá que persistir y conectar. `vacation-history.ts` implementa su reconstrucción pura:

- Cobertura temporal y referencia obligatorias. Su ausencia o insuficiencia devuelve `MISSING` sin campos numéricos; créditos vacíos dentro de cobertura explícita sí son cero conocido.
- Vigencia explícita por crédito y consumo por día civil, primero el que vence antes. No usa créditos futuros para días anteriores ni remanentes vencidos por inferencia. La apertura ya incorpora consumos anteriores a su fecha; introducir un crédito anterior sin esa reconciliación es conflicto.
- Consumos previos reconstruyen el saldo inicial del período. Los del período producen asignaciones por solicitud/día/crédito y días financiados, sin descontarlos dos veces de un saldo neto.
- Corte de conocimiento explícito: aprobaciones, cancelaciones, revocaciones o créditos registrados después no cambian el resultado anterior. Fechas económicas y fecha de registro son ejes diferentes.
- Empresa/empleado mezclados, fuentes vacías, duplicación de IDs y solicitudes distintas para un mismo día son conflictos explícitos. Repetir un día dentro de la misma solicitud no duplica consumo.
- La entrada no se modifica; el resultado no depende del orden de los registros. Se exponen días previos no financiados, sin cobrarlos automáticamente a derechos posteriores.

`sourceReference` es parte del contrato de entrada, no una validación de documentos externos. El escritor posterior deberá verificar autoridad, referencias, origen y cobertura. El contrato no elige vigencia legal, crea derechos, migra datos ni convierte balances legacy en historia confiable.

## Verificación ejecutada

1. RED del contrato nuevo: ocho casos fallaron contra la implementación inicial que solo devolvía `MISSING`; `.tmp/vacation-history-contract-red.log`. No se presenta ese stub como una reproducción de un defecto del recorrido actual.
2. Primer GREEN: **8/8**, exit 0.
3. Extensión y regresión: `pnpm.cmd exec vitest run --configLoader bundle --maxWorkers=1 --pool=threads tests/unit/payroll/vacation-history.test.ts tests/unit/payroll/vacation-civil-days.test.ts tests/unit/payroll/vacation-period-balance-db.test.ts lib/services/__tests__/payroll-nom02c1-vacations.test.ts lib/services/__tests__/payroll-nom02c1-balance-status.test.ts`: **60/60, cinco archivos, exit 0**, 37.98 s; **21** casos del contrato y 39 regresiones. Log `.tmp/vacation-history-contract-unit.log` y exit.txt.
4. `pnpm.cmd exec eslint lib/services/vacation-history.ts tests/unit/payroll/vacation-history.test.ts`: exit 0, sin avisos.
5. Revisión: un caso adicional falló por ordenar IDs con colación regional (`a` antes de `A`). Se sustituyó por orden binario estable. La proyección exige `approvalRecordedAt`, `cancellationRecordedAt` y `revocationRecordedAt`, evitando confundir registro histórico con fechas editables de la fila legacy.
6. GREEN final del mismo comando de cinco archivos: **61/61**, exit 0, 43.32 s; **22** del contrato y 39 regresiones. `.tmp/vacation-history-contract-verified-unit.log` y exit.txt. Lint final de ambos archivos: exit 0, sin avisos.
7. Tipos del contrato final con mayor rigor que el proyecto: `pnpm.cmd exec tsc --noEmit --target ES2022 --module ESNext --moduleResolution bundler --skipLibCheck --strict --types node lib/services/vacation-history.ts lib/services/vacation-dates.ts`: exit 0, sin diagnósticos.
8. Build de aplicación: `pnpm.cmd run build` con `NODE_OPTIONS=--max-old-space-size=4096 --use-system-ca`, exit 0, compilación 3.8 min, TypeScript y **455/455** páginas; `BUILD_ID: EZ7zhNSdjTKDThjBcodgc`, `.tmp/vacation-history-contract-build.log` y exit.txt. El módulo continúa sin importarse desde la aplicación; la versión final del contrato se acredita por las unitarias y tipos estrictos focales anteriores.
9. Trazabilidad: primer intento detectó un padre P usado como ejecutable y dependencias heredadas ausentes. Se enlazaron los siete hijos en filas/módulos y se heredaron las dependencias, sin cambiar el validador. `pnpm.cmd exec tsx scripts/validate-faltantes.ts`, exit 0 fuera del sandbox: **239 filas, 86 base, 127 adicionales, 80 aceptados, cero errores**. `tests/unit/faltantes-traceability.test.ts`: **11/11**, exit 0. Diff sin errores de whitespace.

Las regresiones incluyen los cinco casos SQL/PGlite previos del lector mutable; no son pruebas SQL del historial nuevo. No se afirma V2/V3 del contrato ni se repite el navegador de vacaciones sin cambios de producto integrado.

## Trabajo que sigue abierto

Persistencia append-only con RLS/privilegios mínimos; apertura y créditos administrados/auditados; decisiones atómicas; cierre de asignación sin capacidad administrativa en balances; puente VACATION/permisos sin duplicación; lectura real al corte sin fallback mutable; invalidación de borradores y aceptación PostgreSQL/Next. Esos hitos quedan materializados como hijos de `NOM-02.c1.history` y dependencia explícita de NOM-02.c1.

Sin DDL/DML externo, cambios de `.env` ni migración operativa. Las filas 09.11 y 10.05 permanecen parciales y se conservan los 80 registros aceptados del checkpoint anterior. No se tocaron el payroll-service ni los cambios preexistentes de UI laboral.
