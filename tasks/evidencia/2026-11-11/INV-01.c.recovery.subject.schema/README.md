# INV-01.c.recovery.subject.schema — Catálogo canónico

2026-11-13, HEAD inicial `5a05fb992c813031cacf4209a1bc37e525e56931` más diff compartido. Scope de cinco archivos: `lib/db/schema/evidence.ts`, migración `0144_inv01c_recovery_evidence_subject.sql`, snapshot/journal y `tests/integration/sale-recovery-evidence-catalog-db.test.ts`.

Añade `SALE_RECOVERY` al final del enum canónico `evidence_entity_type`, conservando sin cambios los ocho sujetos anteriores. SQL generado con `pnpm.cmd exec drizzle-kit generate --name inv01c_recovery_evidence_subject`, luego hecho idempotente con `IF NOT EXISTS`. Es una sola sentencia ALTER TYPE, sin grants, políticas, DML ni reescritura de datos. No habilita carga, lectura de objetos privados, aprobación ni aplicación de stock. No se usa GENERAL como evidencia de recuperación.

## Verificación y entorno

RED: la suite falló antes de cualquier consulta/DDL por faltar SALE_RECOVERY en el schema. El test valida schema, contenido exacto de la migración, host aislado y rol NOBYPASSRLS/NOSUPERUSER antes de ejecutar DDL. PostgreSQL requiere confirmar ADD VALUE antes de usar el valor: **solo ese ALTER TYPE se aplica con commit a la rama aislada existente**, con manifiesto `isolated-ddl.json`. No ejecuta db:migrate ni escribe un journal Drizzle ficticio para 0140–0143 pendientes. Main no cambia; 0144 sigue pendiente en main.

Objetivo de V2: repetir DDL sin duplicar ni reordenar etiquetas, insertar y consultar bajo `SET LOCAL ROLE pulso_app` los ocho tipos anteriores y SALE_RECOVERY en la misma tabla real, y revertir todos los fixtures verificando ausencia posterior de evidencia y empresa. Las claves de storage son sintéticas: esta prueba no sube/descarga objetos ni verifica hashes/documentos. No demuestra guardia del sujeto, sucursal del actor ni permiso HTTP.

## Pendiente

El siguiente incremento debe conectar la fachada y una guardia contra venta/empresa/sucursal cargadas del servidor, antes de storage. El tipo público de EvidenceStore aún no incluye el nuevo sujeto: ningún caller nuevo queda habilitado por este cambio. Después faltan sesión/rol, atestaciones de evidencia, carga del snapshot histórico demostrado, registro del expediente/decisión, writer auditado idempotente y aceptación HTTP/UI. EVI-02.a (INVOICE/PAYMENT/EXCEPTION), INV-01.c y 11.11 siguen abiertos. No se acepta ninguna fila funcional por el catálogo.


## Resultados comprobados

2/2 SQL, exit 0 (8.76 s): enum repetible y nueve sujetos guardados/consultados por runtime; todas las filas de prueba revertidas. El manifiesto confirma el cambio de ocho a nueve etiquetas en el host aislado, sin journal Drizzle ni aplicación de otras migraciones. 20/20 unitarias de manifiesto/trazabilidad en dos archivos, lint focal y diff check exit 0. Validador: 239 filas, 83 hijos, 15 aceptaciones, cero errores. TypeScript global terminado exit 0, resultado terminal de sesión 30281, log typecheck.txt. Este hijo no se marca aceptado y no se reutiliza el build del writer para acreditar el nuevo catálogo.


## Continuación de acceso

La [fachada autenticada específica](../INV-01.c.recovery.subject.access/README.md) ya implementa carga, URL privada y baja lógica con controles de venta/empresa/sucursal antes de storage. No amplía el store legacy. Pendientes HTTP con sesión/objetos reales, UI, atestaciones y aplicación auditada. El build conjunto de catálogo/acceso está en esa evidencia.
