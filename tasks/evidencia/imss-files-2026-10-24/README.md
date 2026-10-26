# IMSS — aplicación operativa de 0121 y T8–T10

## Resultado

El GO explícito del 2026-10-24 autorizó aplicar `0121_imss_movimientos.sql`. Se verificó el destino configurado en `.env` y su journal en `0120`, incluido el hash de la migración anterior. Se aplicó únicamente `0121` en una transacción con límites de espera y validación posterior. `0122_aguinaldo_snapshot.sql` no se aplicó.

Evidencia operativa: `../imss-foundation-2026-10-24/migration-applied.json` registra el hash `594bea70b9fadd396567fae4517c39272197b228a69f23e12292e55f88a9e660`, journal id 138, tablas, columnas, índices y RLS desactivado conforme al plan. Sin DROP ni modificación de datos laborales existentes.

El circuito de archivos ya persiste el archivo y sus movimientos en una transacción. Generar deja movimientos `EN_ARCHIVO`; solo el acuse aceptado los vuelve `CONFIRMADO`. Rechazar conserva el motivo y devuelve el movimiento a seleccionable. Los GET de altas/bajas consultan el ledger y actualizan sus contadores.

## Contrato implementado

- `POST /api/imss/files`: `{ movementType: 'ALTA'|'BAJA'|'MOD_SALARIO', employeeIds, fechaMovimiento: 'YYYY-MM-DD', layout?: 'IDSE'|'SUA' }`. SUA solo admite modificaciones salariales. Salario diario capturado opcional en `newSalaries`, en pesos y únicamente con contrato vigente.
- Responde texto con `Content-Disposition`, `X-File-Id`, `X-Content-SHA256`, versión de layout y excluidos en cabeceras `X-Imss-Excluded-*` / `X-Imss-Excluded` (JSON codificado con `encodeURIComponent`). Idéntico contenido o movimiento ya confirmado/en archivo: 409.
- `GET /api/imss/files?page=1&pageSize=25`: historial paginado de la empresa, sin claves internas de almacenamiento. Incluye estado, versión, hash, folio y `downloadAvailable`.
- `GET /api/imss/files/[id]`: descarga privada, con verificación de hash. Sin R2, contenido ausente o vencido: 410; otro tenant/sucursal: 404.
- `PATCH /api/imss/files/[id]`: `{ accepted, acuseFolio?, reason? }`. Folio obligatorio al aceptar y motivo al rechazar. Solo `SUPER_ADMIN`/`ADMIN`.
- Generación/historial/descarga: administración de empresa; `GERENTE`/`SUPERVISOR` quedan limitados a su sucursal asignada. El cliente no puede ampliar ese alcance por JSON.
- Los endpoints anteriores IDSE/SUA son adaptadores al mismo circuito; mantienen los códigos 08/02/07 y la descarga binaria. Ya no construyen líneas por su cuenta.

## Formato y almacenamiento

`imss-parser.ts` contiene los únicos formateadores. `buildIdseFile` / `buildSuaFile` validan fechas civiles y SDI positivo en centavos; usan Web Crypto para que los validadores compartidos sigan siendo importables por las pantallas. Mismo input y versión producen los mismos bytes y hash. Las versiones de trabajo son `IDSE_2025_v1` / `SUA_AFIL_v1`: **la importabilidad contra el portal IMSS sigue sin validarse**.

Con R2 se conserva el `.txt` bajo `companies/{companyId}/imss/...`, con descarga protegida. Sin R2 solo quedan metadatos/hash y `contentUnavailable=true`. Un fallo de auditoría revierte las escrituras y elimina el objeto subido. Se conservan hashes y metadatos al vencer el contenido.

La retención se ejecuta en un step propio del cron diario existente de vencimiento documental. Procesa hasta 100 archivos vencidos por ejecución, con borrado idempotente y aislamiento por empresa. La descarga se bloquea desde el vencimiento, aunque el cron aún no haya borrado los bytes. No se ejecutó el cron contra datos operativos durante esta entrega.

## Verificación

- `unit.json` / `unit.log`: 2078 pasadas, una omitida y una pendiente, 170 archivos.
- `integration.json` / `integration.log`: 77 pasadas en 12 archivos. Incluye el ciclo de alta/baja con las rutas reales contra Neon aislado y casos de persistencia, permisos, rechazo, rollback y retención con PostgreSQL embebido.
- `focused.json` / `focused.log`: 20 casos locales pasados, incluida la verificación adicional del alcance de gerentes por sucursal y el intento de ampliarlo por JSON.
- `lint.json` / `lint.log`: cero errores en los archivos de esta etapa.
- `build.json` / `build.log`: build completo aprobado (exit 0), incluidas compilación, TypeScript y generación de páginas. Usa `--use-system-ca` y heap de 4 GB; no omite TypeScript. El primer intento restringido falló al descargar Geist; se conserva en `build-restricted-failed.*`.

## Trabajo siguiente

T11–T15: pantallas sobre historial/estado real, registro visual de acuses, adopción histórica con preview, candidatos SUA y KPIs unificados. T16–T18: revisión final de plazos, leyendas y documentación de producto. No se declara cerrado el módulo completo ni se desplegó el código de esta etapa.
