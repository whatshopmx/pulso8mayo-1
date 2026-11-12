# INV-01.a2 — Persistencia, cadena y aislamiento

Verificación V1,V2. HEAD `ba88018d2cbd7d879549cfe6476d39e4addfd5d2` más diff local. Depende de P0-03, SEC-00 e INV-01.a1.

Cinco archivos de implementación: schema principal, `0137_inv01a_sale_consumption_identity.sql`, journal, snapshot 0137 y `tests/integration/sale-consumption-identity-db.test.ts`. Migración generada, revisada y aplicada exclusivamente a `br-round-voice-belheola`. El SQL definitivo se conserva en drizzle y su hash/aplicación en [results.json](../INV-01.a/results.json). Main pendiente, sin db:push ni reescritura de migraciones previas.

La reproducción inicial falló con 42P01 porque las tablas no existían. Tras aplicar 0137, siete casos SQL pasaron: FORCE RLS/rol limitado; identidad repetida y cinco dimensiones; empresa/sucursal/contexto ausente; reconstrucción con asignaciones; rechazo de saltos/cantidad previa falsa/duplicados/negativos/snapshot ausente; identidad/receta de otra empresa; snapshot y cadena inmutables incluso para el dueño. Cada caso revierte sus empresas/sucursales/recetas/hechos y comprueba que no quedan fixtures.

Las concesiones SELECT/INSERT y lectura de columnas para políticas proceden de la migración; la prueba no añade UPDATE/DELETE a estas tablas. Se conserva el provisionador del rol sintético y la membresía inversa solo para que el dueño de fixtures pueda asumir el rol limitado, sin elevar al runtime.

Los snapshots usan UUID/asignaciones sintéticos y un oráculo manual coherente. No acreditan que la ingesta ya escriba movimientos reales. La atomicidad, insuficiencia y devoluciones de stock son INV-01.b, carreras/recuperación son INV-01.c y HTTP/UI es INV-01.d.

La suite no fija un endpoint privado: compara el servidor de TEST_DATABASE_URL contra el operativo de `.env` cuando este está disponible, normalizando pooler y omitiendo credenciales. Rechaza compartir servidor, incluso con otra base, porque el provisionamiento de roles es global. En CI sin `.env`, TEST_DATABASE_URL es la designación explícita del entorno aislado del arnés existente.
