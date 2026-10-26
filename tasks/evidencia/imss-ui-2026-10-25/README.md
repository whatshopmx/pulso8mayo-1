# IMSS — pantallas y cierre del circuito (2026-10-25)

Continuación de `tasks/plan-imss.md`, T11–T18. La implementación de las pantallas y sus APIs ya estaba preparada al retomar; esta continuación la revisa, completa y verifica.

## Comportamiento cubierto

- Altas y bajas muestran el movimiento persistido, motivos de bloqueo y días hábiles; un vencido con datos completos sigue siendo seleccionable.
- Adopción histórica explícita por sucursal, nota y vista previa firmada de 15 minutos. Cambiar selección, fecha o nota invalida la vista previa. Solo ADMIN/SUPER_ADMIN pueden confirmar.
- Una confirmación anterior al reingreso no sustituye el alta vigente. La fecha de adopción debe ser igual o posterior al ingreso y no puede ser futura. Dos pruebas nuevas reprodujeron los fallos antes de corregirlos.
- SUA consulta candidatos específicos, muestra salario contractual y SDI; bloquea falta de contrato y fechas fuera del bimestre. La cifra visible coincide con los bytes generados.
- Historial paginado sobre `imss_files`, descarga guardada, acuse con folio/motivo y permisos. Sin copia privada disponible se declara el contenido no disponible.
- Resumen y pestaña IMSS comparten endpoint y denominador; sin movimientos requeridos se muestra `—`.
- Leyenda de layout no validado en altas, bajas, SUA e historial. Sin promesa de importabilidad ni cálculo de cuotas.

## Verificación

- `unit.log` / `unit.json`: **2129 passed**, 1 skipped, 1 todo (172 archivos).
- `focused.log` / `focused.json`: **44 passed** (servicio PostgreSQL embebido + rutas reales contra Neon aislado).
- `browser.log` / `browser.json`: **8/8**, exit 0, después del banner. Componentes reales con APIs simuladas, sin sesión ni datos operativos. Incluye teclado, descargas, SDI, adopción, acuses y anchos 320/768/1024/1440. Una corrida simultánea con compiladores pesados pasó los ocho casos pero no cerró su worker; se repitió y terminó limpia en un minuto.
- `tests/integration/imss-flow.test.ts`: alta y baja pendiente → archivo → descarga con hash coincidente → acuse → confirmada, más rechazo → seleccionable; rutas y base reales. Solo el transporte R2 y la sesión están sustituidos.
- Los fixtures y el contador independiente de Phase 0 usan fecha civil de México: el día UTC cambia seis horas antes y provocaba falsas diferencias de días hábiles.
- `lint.log` / `lint.json`: comprobación focal sobre las rutas, pantallas, componentes y pruebas de IMSS, sin errores.
- `lintAll.log` / `lintAll.json`: lint general, **0 errores**, 2454 advertencias del repositorio.
- `integration.log` / `integration.json`: integración general, **89/89**, 13 archivos, contra base aislada.

## Verificación global completada

La primera compilación llegó a TypeScript y detectó un error previo en `app/api/inventory/batches/route.ts`: `companyId` opcional se pasaba a un contrato obligatorio pese al guard de sesión. Se hacen explícitos los campos ya validados en GET/PATCH, sin cambiar alcance ni permisos. **45/45 pruebas de acceso a lotes pasaron** tras la corrección.

`build.log` / `build.json`: **build final aprobado, exit 0**, incluida compilación, TypeScript y generación de páginas. Empezó a las 00:44 UTC y terminó a las 00:56 UTC del 26 (25 en México). Se comprobó que los chunks compilados contienen el texto del nuevo banner. `types-before-inventory-fix.log` conserva los dos errores del chequeo iniciado antes de la corrección de Inventario; el build posterior incluye su propio control TypeScript. La corrida general anterior arrancó antes de corregir los fixtures y dio 85 passed / 4 failed; los cuatro fallos quedaron resueltos en la corrida focal de 44/44 y en la repetición general de 89/89.

**T11–T18 y checkpoint final cerrados.** Revisión final: escrituras centralizadas y auditadas, alcance por empresa/sucursal, permisos de acuse/adopción, descargas condicionadas al almacenamiento disponible y ausencia de los hardcodes señalados en el plan. No hay hallazgos bloqueantes pendientes en este alcance.

No se aplicaron migraciones ni se modificó la base operativa. El layout sigue pendiente de validación externa ante IMSS. El conteo hábil existente excluye sábados y domingos; no incorpora un calendario de festivos.
