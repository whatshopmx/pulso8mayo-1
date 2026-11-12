# Checkpoints 0.1 y 0.2

HEAD: `ba88018d2cbd7d879549cfe6476d39e4addfd5d2` más diff local. Se conserva el diff previo FC-12 y el cambio ajeno del documento histórico; sin commit automático.

0.1 revisa P0-01/02/03: 239 IDs únicos, datos históricos conservados, tres deltas bancarios explicados, tareas de aceptación explícitas y validador con casos de corrupción/cierre indebido. 0.2 revisa P0-04/SEC-00/P0-05: inventario por entorno, baseline explícito, aislamiento real y contratos financieros coordinados.

Verificación final del alcance:

- Unitarias focalizadas de trazabilidad/manifiesto: 20/20, exit 0; incluye las seis pruebas anteriores del diagnóstico y las nuevas protecciones de baseline.
- Integración SEC-00 en la rama nueva: 4/4, exit 0; rol NOBYPASSRLS, dos empresas/cuatro sucursales, rechazo ajeno y rollback.
- `pnpm.cmd exec tsc --noEmit`: exit 0.
- ESLint de scripts y pruebas afectados: exit 0, sin errores ni advertencias en el alcance.
- Validador documental sobre CSV, plan y mapa: exit 0; 239 filas, 86 tickets del plan, 62 hijos, sin huérfanas/ciclos/referencias inválidas. Los seis cierres P0/SEC-00 exigen evidencia enlazada.
- Catálogos main/pruebas: lectura verificada, 195 tablas y 22 políticas por rama, 136 fuentes BASELINED, cero columnas/índices faltantes y sin historial inconsistente respecto a su baseline.

Build final del hito: **exit 0**, compilación, TypeScript, generación **443/443** y optimización completadas. [Log](build.log), [exit nativo](build-exit.txt), [resumen estructurado](results.json). Comando: `pnpm.cmd run build`, con NODE_OPTIONS `--use-system-ca --max-old-space-size=4096`. Conserva el aviso de render dinámico de `/dashboard/labor/documents`; Next completó la generación. No se omiten tipos ni se cambia bundler/configuración para obtener el resultado.

Intentos anteriores: el primero solo acreditó compilación (6.6 min), sin exit final verificable; otro terminó con exit 134 al agotar el heap de 2 GB en el worker de TypeScript. No cuentan como build aprobado. La repetición con 4 GB es el resultado final citado. No se amplía la aceptación a las suites completas de la aplicación, datos reales, banco/PAC/canales ni FC-12.

Puerta 0 cerrada: los seis tickets de preparación tienen aceptación y evidencia, los checkpoints aplicables están completos y el build del hito pasó. No es cierre de la implementación funcional ni aceptación de las 239 filas.

Las 239 filas conservan su aceptación funcional pendiente. Siguiente trabajo ejecutable: INV-01.a; renovar HEAD/diff y caracterizar los datos del entorno elegido antes de cualquier backfill.

Revisión de preservación y enlaces: [review.json](review.json). De 21 archivos iniciales ajenos al checklist de esta continuación, 19 conservaron su hash y dos cambiaron concurrentemente (`tasks/finanzas-contabilidad/todo.md` y `lib/services/accounting/settlement-adapter.ts`). Este frente no los editó ni atribuye su aceptación. También apareció `.claude/settings.local.json`, no creado ni editado aquí. Cero enlaces locales rotos en el checklist y las fichas de evidencia.
