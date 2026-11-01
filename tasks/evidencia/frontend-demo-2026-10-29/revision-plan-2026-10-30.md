# Revisión del plan de auditoría frontend — 2026-10-30

Código revisado: `e2e8e9acf07955edb19ebbe2db1707008df69993`, con cambios previos ajenos en el árbol y el índice. No se modificaron esos cambios.

## Resultado

Los 16 hallazgos cuentan con implementación o resolución documentada en local. El plan de partida seguía con sus casillas originales abiertas, mientras que `tasks/todo-auditoria-frontend.md` y `verificacion-local-2026-10-29.md` ya registraban su cierre. Se añadió al plan una tabla con el estado por hallazgo, commits y pendientes reales, distinguiendo el código de la validación del despliegue.

Se contrastaron el historial de correcciones, los componentes de schedules, el GET de schedules, el contexto y selector de sucursal, el gating y fechas de nómina, las métricas de labor/live, los filtros y totales de evidencia, el proxy de acceso y la guarda de fechas del seed. Las traducciones y el recorrido por rol cuentan además con la evidencia local anterior.

NAV-01 requiere una precisión: `router.refresh()` en `BranchScopeControl` proviene de `6d32866`, anterior al baseline de la auditoría. No es una implementación nueva del lote. La evidencia previa sí documenta el cambio de sucursal funcionando en local.

## Verificación repetida

Comando:

```powershell
pnpm.cmd run test:unit tests/unit/workflows/execution-access.test.ts tests/unit/business-date.test.ts tests/unit/workflow-evidence-access.test.ts tests/unit/evidence-confidence.test.ts tests/unit/labor/session-scope.test.ts tests/unit/seed-safety.test.ts
```

Resultado: **6 archivos y 57 pruebas aprobadas**, exit 0. La primera invocación incluyó un separador `--` y lanzó la suite completa; se interrumpió y se volvió a ejecutar el comando anterior con los filtros correctos. No se atribuye un resultado a aquella suite interrumpida.

`git diff --check` sobre los documentos modificados: sin errores. Se inició también `pnpm.cmd run lint`, pero se interrumpió después de varios minutos sin resultado final; **no se declara lint aprobado hoy**. El log parcial está en `.tmp/frontend-audit-20261030-lint.log`. No se repitió build porque los cambios de esta revisión son exclusivamente de documentación.

## Pendiente

- Revisión humana de checkpoints A/C y selección del lote, considerando los cambios ajenos que hay en el árbol.
- Preparar/verificar preview y obtener la autorización explícita para producción requerida en el plan.
- Publicar el lote autorizado y repetir el recorrido de tres roles y dos sucursales sobre el despliegue, guardando evidencia de UI/API y consola/red.

No se hizo un nuevo recorrido en navegador, no se comprobó el SHA actual de producción, no se resiembró y no se ejecutó timbrado ni dispersión. La verificación local de build y navegador del 29 de octubre se conserva como evidencia previa, no como una ejecución de hoy.
