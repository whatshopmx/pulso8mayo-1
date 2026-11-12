# P0-04 — Inventario por entorno

Estado: aceptado para el nuevo entorno elegido por el propietario. Verificaciones D,V2. HEAD `ba88018d2cbd7d879549cfe6476d39e4addfd5d2` y cambios locales de P0-01/esta continuación.

| Entorno | Evidencia real | Resultado/límite |
|---|---|---|
| Cuenta anterior de `.env` | Captura local en identity.json; endpoint no localizado en Neon conectado y primer intento CLI sin conexión | Historial anterior no verificado. El propietario indicó otra cuenta y solicitó crear proyecto nuevo. No se afirma migración de datos ni despliegue allí. |
| Aislado anterior, `young-morning-64801087` | [Catálogo de lectura](test-catalog.json), [manifiesto local contrastado](migration-manifest.json) | 183 tablas, 6 políticas, dueño con bypass y pulso_app sin bypass. 119 APPLIED, un HISTORY_GAP, un HASH_MISMATCH, 15 PENDING y una entrada ajena; requiere revisión. No se corrigió ni escribió en ese entorno. |
| Nuevo main, `soft-cloud-50478212` / `br-steep-frog-bet3a8l6` | [Catálogo completo](new-main-catalog.json), [baseline](../NEON-NEW/baseline.json) | 195 tablas, 22 políticas, 136 fuentes BASELINED con hashes concordantes; cero columnas/índices faltantes respecto al snapshot local. Aplicación en propietario; pulso_app no está provisionado en main. |
| Nueva rama aislada, `br-round-voice-belheola` | [Catálogo completo](new-test-catalog.json), [SEC-00](../SEC-00/README.md) | Mismo baseline, 195 tablas, 22 políticas, sin diferencias de columnas/índices. Rol pulso_app NOBYPASSRLS/NOSUPERUSER separado del dueño. Cuatro pruebas de aislamiento/rollback aprobadas. |

Cada catálogo nuevo contiene tabla, propietario, ENABLE/FORCE RLS, políticas con USING/WITH CHECK/roles, privilegios de tabla/columna y roles. El manifiesto local conserva las 136 fuentes del journal vigente y sus cláusulas SQL de seguridad, incluyendo 0101, 0103–0108, 0123 y todos los lotes contables hasta 0136. La presencia local se separa de su aplicación/baseline por entorno.

Comandos reproducibles (con NODE_OPTIONS incluyendo `--use-system-ca` en esta máquina):

```powershell
pnpm.cmd exec tsx scripts/migration-manifest.ts --env-file .env --url-key MIGRATION_DATABASE_URL
pnpm.cmd exec tsx scripts/migration-manifest.ts --env-file .env.test --url-key TEST_DATABASE_URL
```

Ambos exit 0, transacción `BEGIN READ ONLY`, rollback al terminar, `operationalChanges: false`. El diagnóstico ahora reconoce baselines explícitos y consulta políticas/privilegios; sus nueve pruebas incluyen hashes alterados, fuentes ausentes, ancla inválida y migraciones posteriores. El script no aplica DDL ni migra al diagnosticar.

El cambio de entorno y la instalación inicial son una operación distinta, solicitada por el propietario y documentada en [NEON-NEW](../NEON-NEW/README.md). Las 136 fuentes BASELINED no son 136 migraciones ejecutadas individualmente. Las comprobaciones de existencia no certifican cada tipo/default/FK/enum ni equivalen a aceptar seguridad o comportamiento de todos los dominios.
