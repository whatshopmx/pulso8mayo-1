# Captura manual: HTTP, sesión real y writer runtime

Base: `565521f2b322874a940ea27524eb4fc32907a76d`, árbol limpio al comenzar.
Continuación de `INV-01.b4.manual`; no acepta el padre ni la fila 11.11.

El nuevo `tests/integration/sales-entry-session-db.test.ts` une transporte
HTTP loopback, handler POST, login Better Auth/cookie firmada, ingestión,
writer, SQL y RLS reales. El arnés suministra únicamente los almacenes
request-local de Next y la frontera de transacción para conservar el fixture
completo dentro de rollback SERIALIZABLE. No simula sesión, recetas, stock,
errores del writer ni respuestas HTTP.

Auth y la comprobación inicial de sucursal usan la conexión dueña. Al abrir
la transacción SERIALIZABLE del writer, el arnés cambia a `pulso_app` y
comprueba NOSUPERUSER/NOBYPASSRLS y ausencia de privilegios generales de
DELETE en lotes/ventas y UPDATE en recetas. No equivale a iniciar sesión de
Postgres con una conexión runtime independiente ni a ejecutar Next completo.

Se reconstruyen los grants declarados en 0137/0138/0139/0141 dentro del
rollback para que permisos amplios de otras suites no oculten una consulta
incorrecta. No se crean roles, se cambian contraseñas/membresías ni se
instalan migraciones persistentemente. Dos empresas, tres sucursales,
cinco actores sintéticos y tres recetas/ingredientes/lotes. Host distinto
al operativo comprobado antes de insertar; las empresas y sesiones deben
estar ausentes tras cada caso, también si falla una aserción.

Casos fijados:

- Alta 10, corrección a 12, reducción a 8, repetición, completar ingreso y
  anulación cero. Oráculo: 1 kg/porción con lote inicial 20 → saldos
  10/8/12/12/12/20. Repetir no crea revisión/movimientos; completar ingreso
  80 pesos conserva stock y proyecta 8000 centavos; cinco revisiones para
  seis solicitudes y namespace `manual:recipe` estable.
- Lote con primera receta válida y segunda sin stock (409) o ajena (400):
  revierte ambas, sin identidades/revisiones/ventas/movimientos parciales.
  GERENTE no escribe otra sucursal (403) y puede recuperar con captura propia.
- Anónimo 401, EMPLEADO/GERENTE sin asignación 403, ADMIN de otra empresa o
  sucursal ajena 400: cero transacciones de writer y stock sin cambios.
- Venta histórica sin revisión demostrable: 409/PENDING_RECOVERY, sin
  adopción ni segundo consumo.
- JSON inválido: 400, sin lectura de inventario ni writer. Unitaria adicional
  verifica también cuerpo vacío y mensaje accionable.

RED: primera integración **2/5 aprobados, exit 1, 56.95 s**. Un fallo real
reprodujo JSON inválido → 500; dos fallos eran del arnés, que copiaba el
Content-Length anterior al volver a enviar un body de otro tamaño. Se
reutiliza solo la cookie, dejando que fetch calcule los headers de transporte.
Segunda integración **3/5, exit 1, 71.70 s**: JSON sigue en 500; el otro
fallo era una lectura dueña de revisiones sin filtro del fixture (el rol
dueño no acredita aislamiento RLS). La lectura del oráculo se acota a los
UUID sintéticos y ordena revisiones; no se cambian políticas para ese ajuste.
La nueva unitaria reprodujo el mismo 500: **6/7, exit 1, 3.53 s**.

Corrección de aplicación: solo el parseo del cuerpo se traduce a
`ApiError.badRequest('El cuerpo debe contener JSON válido.')`, después de
verificar sesión/capacidad y antes del schema, sucursal y writer. No captura
errores internos de sintaxis del servicio ni cambia códigos de negocio.

Regresión unitaria manual/bulk/smartlink/ingestión/normalización:
**51/51, cinco archivos, exit 0, 8.34 s**. ESLint de los tres archivos de
código/pruebas: **exit 0, sin advertencias**. Los gates finales constan a
continuación.

GREEN de integración: **5/5, exit 0, 80.00 s** (76.00 s de casos).
Verificó los seis envíos del recorrido de corrección bajo rol runtime,
incluida la repetición, con denegación de privilegios generales en cada
transacción. No quedaron empresas ni sesiones del fixture, y no hubo
datos/DDL persistentes. Los errores de negocio se ejercitan por HTTP real,
sin sustituir el writer por un doble.

`pnpm.cmd exec tsc --noEmit` con heap 4 GB: **exit 0**. Validador:
**239 filas, 86 tareas base, 102 hijos, 24 aceptaciones, 0 errores**, exit 0.
`git diff --check`: exit 0. Build final **exit 0**: compilación en 2.8 min,
TypeScript completo, **455/455 páginas** (generación 4.1 s) y optimización.
Conserva los avisos previos de `fetchConnectionCache` deprecado y
`DYNAMIC_SERVER_USAGE` por `headers` en documentos laborales; la ruta queda
dinámica. No se omitió ninguna comprobación ni se modificó la configuración.

Comandos reproducibles (PowerShell, raíz del proyecto):

```powershell
$env:NODE_OPTIONS='--use-system-ca --max-old-space-size=4096'
pnpm.cmd exec vitest run --configLoader bundle --config vitest.integration.config.ts tests/integration/sales-entry-session-db.test.ts --maxWorkers=1 --pool=threads
pnpm.cmd exec vitest run --configLoader bundle --maxWorkers=1 --pool=threads tests/unit/inventory/sales-entry-access.test.ts tests/unit/inventory/sales-entry-bulk.test.ts tests/unit/inventory/sales-entry-smart-link.test.ts lib/services/__tests__/sales-ingest-service.test.ts lib/services/__tests__/sales-ingest-revisions.test.ts
pnpm.cmd exec tsc --noEmit
pnpm.cmd exec eslint app/api/inventory/sales-entry/route.ts tests/unit/inventory/sales-entry-access.test.ts tests/integration/sales-entry-session-db.test.ts
pnpm.cmd run build
pnpm.cmd exec tsx scripts/validate-faltantes.ts
git diff --check
```

Avisos del arnés: cargador CommonJS de Vitest y base URL de Better Auth no
configurada globalmente. El arnés fija el origen loopback conocido y prueba
login/getSession/POST; no ejecuta callbacks ni redirects de auth. No se
desactiva TLS. No hay navegador/servidor Next completo, carreras entre
conexiones ni rol de conexión runtime independiente para auth/lookup.
`INV-01.b4b` y el recorrido `INV-01.d` siguen pendientes: este incremento
no acepta el hijo manual, sus padres ni la fila 11.11, y no despliega.
