# INV-02.snapshot — lector publicado y demanda congelada

Base: `d05eae09d67ed0b190b6785da168a8fb8b564fd0` + árbol compartido. Código implementado; sin aceptación dependiente ni V2 PostgreSQL independiente. No se cambió el escritor de ventas, no se activó consumo elaborado y no se aplicaron migraciones externas.

El lector `publishedSaleRecipeReader` recibe la transacción de venta y el día civil. Exige SERIALIZABLE y comparte el bloqueo empresa/receta del publicador. Resuelve la política vigente con alcance explícito/RLS, exige su bitácora y lee exclusivamente la versión archivada correspondiente. Nunca combina su ID con `recipes`/`recipe_items` editables. Los ingredientes archivados se validan y sólo se copian campos físicos: costos, nombres y otros metadatos no forman parte de la demanda. Una línea archivada sin rendimiento demostrado se rechaza para evitar asumir un 100% histórico.

El snapshot conserva política, versión, número, vigencia y día de venta de cada receta visitada. Una subreceta elaborada consume la unidad de su SKU y detiene la expansión; su rendimiento de fabricación no divide de nuevo el consumo de venta. Las conversiones y cantidades racionales quedan congeladas. Los snapshots anteriores sin metadatos conservan su huella y siguen calculando sus propias compensaciones.

Verificación local:

- RED: seis casos SQL existentes fallan por `publishedSaleRecipeReader is not a function`; 32 casos restantes pasan.
- GREEN inicial: 56/56 entre servicio/publicación SQL, snapshot publicado y regresión histórica.
- GREEN ampliado: **106/106**, siete archivos, exit 0, 29.59 s. Incluye 30 SQL de publicación/lectura, 6 SQL de acceso, 14 SQL de persistencia, 12 casos de snapshot publicado, 18 de snapshot histórico, 20 de contrato y 6 de reintentos.
- Casos añadidos: padre con subreceta sin política falla; con publicación elaborada detiene expansión aunque la ficha editable tenga otro rendimiento. JSON archivado nulo/incompleto y artículo ajeno fallan. Todas estas lecturas dejan cero movimientos.
- PGlite ejecuta las migraciones reales 0137/0138/0139/0159/0160 y `SET LOCAL ROLE pulso_app` NOBYPASSRLS con grants de columna. Las tablas anteriores materializan tipos/columnas, no todas sus restricciones históricas. No acredita LOGIN independiente ni carreras entre conexiones.
- Los casos iniciales prueban selección por día, aislamiento RLS entre dos empresas, rechazo de política huérfana, rechazo de READ COMMITTED, cambio de ficha editable y round trip JSONB conservando demanda.

Comando de regresión:

```powershell
pnpm.cmd exec vitest run --configLoader bundle --maxWorkers=1 --pool=threads tests/unit/inventory/recipe-policy-publication-service-db.test.ts tests/unit/inventory/recipe-policy-publication-access-db.test.ts tests/unit/inventory/recipe-consumption-policy-db.test.ts lib/services/__tests__/published-sale-snapshot.test.ts lib/services/__tests__/sale-consumption-snapshot.test.ts lib/services/__tests__/recipe-consumption-policy.test.ts lib/services/__tests__/recipe-consumption-publication-retry.test.ts
```

Pendiente: integración del escritor en INV-02.apply, rechazo de venta elaborada hasta disponer del recorrido PROD-01, compensaciones históricas end-to-end y concurrencia publicación↔venta en PostgreSQL independiente. El bloqueo del lector por sí solo no acredita coordinación de todos los escritores existentes. El lector mutable continúa como contrato legacy hasta caracterizar y conectar la selección en apply; no hay adopción silenciosa de históricos.

Tipos globales posteriores: `NODE_OPTIONS=--max-old-space-size=4096 pnpm.cmd exec tsc --noEmit`, **exit 0** (sesión 20090). Se corrigieron la inferencia opcional de `yieldPercent` en el lector y la inferencia `unknown` del mapa de sucursales del diff de nómina ya existente; este último cambio sólo añade el tipo genérico al Map. Regresión posterior del lector/SQL y validación de nómina: **46/46 en tres archivos**, exit 0.

ESLint focal: **exit 0, sin errores**; lector/snapshot/pruebas sin advertencias. `payroll-service.ts` conserva 19 advertencias de `any` previas. `git diff --check`: exit 0. `validate-faltantes.ts`: 239 filas, 86 bases, 114 hijos y 25 aceptaciones; cero errores. Se registra snapshot como código implementado, sin nuevas aceptaciones.

Build posterior: `NODE_OPTIONS='--use-system-ca --max-old-space-size=4096' pnpm.cmd run build --webpack`, sesión **46907 terminada, exit 0**. Webpack compiló en 8.5 min, TypeScript aprobado, 455/455 páginas y trazas completas. Conserva avisos previos de fetchConnectionCache/documentos laborales. Mientras trabajaba se modificó el writer de apply; no se atribuye a este build la compilación final de ese escritor. El nuevo build de apply está registrado en [su evidencia](apply.md). El handle histórico 64135 no estaba disponible; no se infiere su resultado.

Checkpoint posterior: build final del escritor **10116 exit 0** y [ocho pruebas nativas de políticas](runtime.md), incluidas lectura archivada con ficha mutable 99, vigencias/demanda previas y venta del padre con subreceta congelada. Los pendientes de integración al writer de esta nota inicial se resolvieron bajo activación explícita; la aceptación dependiente, recovery y aplicación operativa siguen pendientes.
