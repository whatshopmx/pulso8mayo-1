# Bulk: sesión HTTP real e identidad POS

Base `07b2a69bd6ee48c6159cd8c41a3b8c8445220408`, árbol con el incremento
manual UI pendiente al comenzar. No se acepta el hijo ni la fila 11.11.

Scope: ruta bulk, su prueba unitaria y extensión del arnés HTTP manual
existente. El arnés ahora despacha el handler bulk real y permite importar CSV
con Better Auth, ingestión, writer y PostgreSQL reales. Conserva transacción
SERIALIZABLE con rollback, reconstrucción de grants declarados, writer
`pulso_app` NOSUPERUSER/NOBYPASSRLS y verificación de limpieza de empresas y
sesiones. Auth/lookup siguen usando la conexión dueña; no acredita conexión
runtime autenticada independiente ni un servidor Next completo.

Se reprodujo JSON inválido → 500: unitaria **5/6, exit 1**, 4.00 s.
Se captura exclusivamente el error de lectura JSON antes de validar el schema
y se devuelve **400** con mensaje accionable. No se transforma un error
interno del writer en error de cliente. GREEN **6/6, exit 0**, 2.31 s,
incluye cuerpo vacío y no invocación de la ingestión.

Integración manual + bulk **7/7, exit 0**, 117.96 s (109.08 s de casos).
Cinco regresiones manuales y dos recorridos nuevos:

- Importar diez porciones sin ingreso: stock 20→10 y cobertura incompleta.
  Corregir a ocho: stock 12; repetir no cambia ninguna fila ni movimiento.
  Completar ingreso con 80.25 pesos: proyección 8025 centavos y movimientos
  idénticos. Anular con cantidad/ingreso cero: stock 20. Identidad única
  `pos:import`/`POS-01`/día estable; cinco transacciones runtime.
- Anónimo 401; empleado, gerente sin asignación, gerente en otra sucursal y
  sucursal ajena 403. JSON inválido/vacío 400; estado de stock, ventas,
  identidades y revisiones idéntico al inicial. No hay fixtures persistentes.

Regresión manual/bulk/smartlink/ingestión/trazabilidad: **63/63, exit 0**,
seis archivos, 14.73 s. Lint de ocho archivos del incremento combinado pasó
antes del ajuste posterior de espera inicial del navegador.

Comandos (PowerShell):

```powershell
$env:NODE_OPTIONS='--use-system-ca --max-old-space-size=4096'
pnpm.cmd exec vitest run --configLoader bundle --config vitest.integration.config.ts tests/integration/sales-entry-session-db.test.ts --maxWorkers=1 --pool=threads
pnpm.cmd exec vitest run --configLoader bundle --maxWorkers=1 --pool=threads tests/unit/inventory/sales-entry-access.test.ts tests/unit/inventory/sales-entry-bulk.test.ts tests/unit/inventory/sales-entry-smart-link.test.ts lib/services/__tests__/sales-ingest-service.test.ts lib/services/__tests__/sales-ingest-revisions.test.ts tests/unit/faltantes-traceability.test.ts
```

Build final **exit 0**, compilación 3.7 min, TypeScript global completo y
455/455 páginas (generación 11.9 s). Avisos previos de `fetchConnectionCache`
deprecado y `DYNAMIC_SERVER_USAGE` por `headers` en documentos laborales;
la ruta queda dinámica. El `tsc --noEmit` paralelo previo se interrumpió
para liberar recursos y no cuenta como gate; el build sí ejecutó y pasó
su comprobación global de tipos. Lint final de los cuatro archivos bulk/HTTP
y arnés Next: exit 0. Validador: 239 filas, 103 hijos, 24 aceptaciones,
cero errores. No hay migración, backfill ni
despliegue. Dependencia b4b, recorrido integrado Next→runtime independiente,
concurrencia y aceptación permanecen pendientes.

Código guardado en `5c4a849`. Regresión final Next de producción del
incremento manual/reportes: **4/4, exit 0, 94.26 s**, con cierre de servidor
y limpieza de empresas/sesiones comprobados. Esas pruebas no incluyen un
guardado bulk exitoso desde Next; el alcance HTTP/rollback anterior se
mantiene explícito.
