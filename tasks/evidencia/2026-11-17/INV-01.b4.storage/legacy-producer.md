# Productor directo del corte POS (`/api/sales/cuts/upload`)

Continuación 2026-11-18 sobre HEAD `1c44f8d` más el árbol local. Cierra la brecha que `sales-list-scope.md` dejó abierta: la ruta de carga directa seguía escribiendo evidencia con el namespace legacy `sales-cuts`. Sin aceptación de `INV-01.b4.storage` ni de sus padres.

## Brecha reproducida

`POST /api/sales/cuts/upload` es el productor que usan la pantalla `/dashboard/sales/upload` y el diálogo «Registrar Corte de Ventas». Antes de este incremento:

1. Subía los bytes con `generateFileKey(companyId, userId, "sales-cuts", name)`, es decir `companies/{companyId}/users/{userId}/sales-cuts/…`: sin sucursal, sin día y fuera de `/pos/`.
2. Persistía esa clave en `daily_sales_cuts.raw_file_url`. El contrato POS (`lib/storage/pos-upload.ts`) exige `companies/{companyId}/branches/{branchId}/pos/{businessDate}/{ts}_{nombre}`, así que `resolvePosUploadUrl` la rechazaba.
3. Consecuencia: todo corte cargado por esa ruta quedaba sin archivo legible. La ruta de lectura devolvía 404 «El archivo POS no está disponible» y el operador no tenía forma de recuperarlo desde la aplicación.
4. No validaba tamaño/MIME del export ni el alcance de sucursal del rol: un gerente podía dejar el corte y su evidencia en una sucursal ajena.
5. Subía antes de parsear: no conocía el día efectivo del corte, que es parte de la key canónica.

## Cambio

- **Key canónica antes de escribir.** La ruta resuelve el día efectivo con `previewSalesCut` (fecha del archivo > fecha del formulario, mismas reglas de validación) y reutiliza ese `BuildResult` en `ingestSalesCut` mediante el nuevo parámetro opcional `precomputed`. La key y la fila comparten fecha por construcción y el archivo no se parsea dos veces.
- **Persistencia de la KEY.** R2 configurado → `storePosUpload` escribe los bytes con `companies/{companyId}/branches/{branchId}/pos/{businessDate}/…` y devuelve la clave. Sin R2 → marcador `local://…` explícito que **no** afirma durabilidad, igual que el cierre por smart link. Si R2 está configurado y la subida falla, el corte no se persiste: no se acepta evidencia perdida en silencio.
- **Sin bytes huérfanos por validación.** Si `previewSalesCut` devuelve errores (fecha futura, sin total, etc.), no se escribe el objeto; `ingestSalesCut` devuelve el mismo rechazo como 400.
- **Alcance y roles.** Mismos roles que la captura y la lectura de ventas (`SUPER_ADMIN`, `ADMIN`, `GERENTE`, `SUPERVISOR`) vía `withRoleAuth`; `resolveBranchScope` acota a la sucursal de la sesión y `assertBranchOfCompany` comprueba que la sucursal sea de la empresa. `EMPLEADO`/`READONLY` quedan fuera, como en `/api/sales/cuts` y `pos-file`.
- **Validación del archivo.** `assertPosUploadValid` aplica el límite de 10 MiB y la lista MIME del contrato POS antes de tocar storage.

`ingestSalesCut` conserva su comportamiento previo cuando no recibe `precomputed`: sigue parseando y construyendo el corte por su cuenta.

## Verificación

| Comando | Resultado |
|---|---|
| `pnpm.cmd test:unit tests/unit/sales/sales-cut-upload-pos.test.ts --maxWorkers=1 --pool=threads` | 10/10, exit 0 |
| `pnpm.cmd test:unit lib/services/__tests__/sales-ingestion-precomputed.test.ts --maxWorkers=1 --pool=threads` | 2/2, exit 0 |
| `pnpm.cmd test:unit` (pos-upload, pos-file-read, productor directo, smart-link, `sales-ingest-service`, `sales-ingest-revisions`, precomputed) | **80/80, 7 archivos**, exit 0 |
| `NODE_OPTIONS=--use-system-ca pnpm.cmd exec vitest run --configLoader bundle --config vitest.integration.config.ts tests/integration/pos-storage-r2-db.test.ts` | **4/4**, 44,7 s, exit 0 (R2 real + Neon aislado + sesión Better Auth real) |
| `node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc --noEmit --incremental false` | exit 0 |
| `pnpm.cmd exec eslint` (ruta, servicio y las tres pruebas) | exit 0 |
| `NODE_OPTIONS=--max-old-space-size=6144 pnpm.cmd run build` | **exit 0**; Webpack «Compiled successfully in 95s», 455/455 páginas estáticas |
| `pnpm.cmd exec tsx scripts/validate-faltantes.ts` | 239 filas, 86 base, 102 adicionales, 24 aceptados, cero errores |
| `git diff --check` | exit 0; solo avisos LF/CRLF |

El build imprime `Error loading document stats: Dynamic server usage: Route /dashboard/labor/documents` durante el prerender; es el aviso preexistente de una ruta dinámica, no un fallo de compilación (exit 0 y 455/455 páginas).

### Casos V1 (unitarias, R2 y DB simulados)

- La key usa el día resuelto por el archivo (`2026-11-12`) y no el del formulario (`2026-11-10`); la misma clave viaja a `ingestSalesCut` junto con `precomputed`.
- Sucursal ajena → 403 antes de `previewSalesCut`/`storePosUpload`; rol acotado sin sucursal → 403; sucursal de otra empresa → 400 de `assertBranchOfCompany`.
- MIME no permitido, archivo vacío y turno inválido → 400 sin storage.
- Corte inválido → sin subida y 400 con el mensaje de validación; sin R2 → `local://` con el día efectivo; fallo de R2 → 500 sin persistir el corte.
- `ingestSalesCut` con `precomputed` no parsea (el archivo de prueba es ilegible), persiste la fecha y la clave del build; sin `precomputed` sigue lanzando `SalesIngestionError` por el archivo ilegible.

### Caso V2/V3 (entorno real)

Nuevo caso en `tests/integration/pos-storage-r2-db.test.ts`, dentro del `probe` que fuerza rollback y borra sus objetos de R2:

- `EMPLEADO` → 403 y cero filas nuevas; `GERENTE` de otra sucursal → 403 y cero filas nuevas.
- `GERENTE` de la sucursal propia → 200; el archivo de resumen de formas de pago se separa en `SALON` + `DELIVERY` en una sola inserción (2 filas, suma 1.000.000 ¢), ambas con la misma `raw_file_url`.
- La key persistida cumple `companies/{companyA}/branches/{branchA1}/pos/{día}/\d+_reporte_caja\.csv`, no empieza por `http` y sus bytes en el bucket coinciden con los subidos.
- `GET /api/sales/cuts/[id]/pos-file` sobre el corte recién creado responde 200 y la URL firmada entrega los mismos bytes: el corte que antes quedaba inaccesible ahora se lee sin tocar la ruta de lectura.
- Sin residuos: rollback de empresas/sucursales/usuarios/sesiones/cortes y borrado verificado de los objetos.

## Límites

- **No hay backfill de claves legacy.** Los cortes ya persistidos con `companies/{companyId}/users/{userId}/sales-cuts/…` siguen sin poder leerse: esta ruta ya no las produce, pero no se renombran objetos en R2 ni se reescriben filas existentes (`local://` tampoco es durable). Recuperarlos exige volver a cargar el archivo desde el diálogo, que es lo que la pantalla de detalle ya indica.
- La corrida V2 sigue con el rol dueño del branch de `TEST_DATABASE_URL`, **no** con `pulso_app` NOBYPASSRLS. Acredita la frontera de aplicación (sesión → `company_id`, alcance de sucursal) y la durabilidad real en R2; RLS y privilegios de runtime del productor siguen en `rls-candidate.md`.
- El recorrido de navegador se ejecutó después y está en [next-browser-v3.md](next-browser-v3.md): pantalla real, subida por el `<input type="file">`, key canónica verificada en base y en R2, y lectura autorizada del corte recién creado (3/3 con Next de producción, sesión, Neon aislado y R2 reales). Ese caso encontró y corrigió una navegación a una ruta inexistente (`/dashboard/sales/cuts`); los avisos `toast` de la pantalla siguen sin superficie porque ningún layout monta `<Toaster />`.
- No se prueba concurrencia de dos cargas simultáneas del mismo día/turno. La unique de la tabla sigue siendo la defensa; el segundo intento puede dejar un objeto en R2 porque los bytes se escriben antes de detectar el duplicado (storage append-only, sin mutación del objeto anterior).
- No se toca el productor de smart link, la ruta de lectura ni `generateFileKey` (sigue en uso para otros documentos). No se aplica DDL ni se despliega.
- Se mantienen **24 registros aceptados**. No se acepta `INV-01.b4.storage`, `INV-01.b4`, `INV-01.b` ni la fila 11.11: faltan V3 navegador, runtime NOBYPASSRLS y el resto de dependencias (`b4b`, cobertura financiera y checkpoint).
