# FEFO-02 — Contrato operativo aceptado

Documento revisable: `docs/lotes-fefo-contrato.md`. Contiene identidad y existencia local sin reescritura general, compatibilidad con timestamps existentes, fecha civil/instante, fechas nulas, faltantes físicos/teóricos, reservas, estados, permisos, excepciones y compensaciones; incluye doce ejemplos verificables.

El usuario revisó la propuesta y respondió «Aceptar las reglas propuestas» el 2026-10-24. FEFO-02 se cierra. Los cambios de elegibilidad/consumo pueden avanzar al cumplir sus otras dependencias. FEFO-03A de aislamiento depende sólo de FEFO-01.

Verificación: contraste con `lib/branch-scope.ts`, `lib/permissions.ts`, `lib/db/schema.ts` y `lib/db/schema/core.ts`; `branches.timezone` ya existe. No se cambiaron tablas ni datos. Es documentación; no requiere ejecutar de nuevo suites sin cambios de código.
