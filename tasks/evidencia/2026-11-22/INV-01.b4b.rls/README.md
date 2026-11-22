# INV-01.b4b.rls — aceptación de lectura mínima del nombre

Estado: **aceptado V1/V2 en copia aislada**, 2026-11-22.
Base `07dafd2`; prueba en `9137b9be135f3bb8c9fb05f150465e07609facc8`.
Dependencias `INV-01.a` e `INV-01.b2a` aceptadas en el mapa vigente.
No acepta ingestión completa, storage, lectores financieros, padres ni despliegue.

Se reutiliza `0141_inv01b_import_recipe_name.sql`, sin modificar SQL, journal,
snapshot ni servicios. El nuevo archivo de integración usa copia efímera de
la base aislada, dos empresas, tres sucursales y un LOGIN nuevo sin membresías,
NOSUPERUSER/NOBYPASSRLS. El host operativo se rechaza antes de provisionar.
No se usa SET ROLE ni el rol compartido `pulso_app`.

| Criterio | Evidencia actual |
| --- | --- |
| Añadir solo SELECT(name) | Se revoca name al rol fresco y la lectura devuelve 42501. Se ejecuta el SQL real de 0141 para ese rol; name pasa a legible, sin SELECT general ni INSERT/UPDATE/DELETE. Repetir conserva los privilegios. |
| RLS sin contexto | SELECT id,name sin filtros de tenant devuelve cero filas, incluso después de reutilizar la conexión tras transacciones y errores. |
| Catálogo propio compartido | Las dos sucursales de empresa A leen los mismos tres registros propios mediante consulta sin filtros de empresa; B solo ve su registro. |
| UUID/nombre ajenos y ambigüedad | El resolver real selecciona UUID y nombre propios, devuelve null para UUID ajeno y nombres ambiguos, y no cruza el contexto de B aunque reciba empresa A. |
| Escrituras denegadas | UPDATE, DELETE, INSERT y TRUNCATE reales con contexto válido reciben 42501. Cada intento termina en rollback. |
| Journal/snapshot | Una entrada idx 141, tag esperado, prevId enlazado a 0140 y contenido declarativo estructuralmente idéntico tras excluir id/prevId. Comprobado también con isDeepStrictEqual de Node; diferencias de orden de propiedades no son deriva. |
| Retiro | Base y rol ausentes comprobados por SQL en close; manifest final false/false/true. No se termina ningún cliente del origen. |

SQL SHA-256 del archivo de trabajo:
`8f1a13f2765bd5b1d66ebf3e3c014f63d740910eb955b94792bb9de0a059a8b0`.

Resultados:

- **3/3 integración real, exit 0**, 45.28 s totales, 42.31 s en pruebas.
  Reporte `.tmp/pos-catalog-verify-report.json`; wrapper exige los tres nombres
  esperados aprobados, no solo exit cero. Resultado final 2026-11-22T17:07:59Z.
- **20/20 unitarias, exit 0**, manifiesto (clasificador con datos sintéticos)
  y trazabilidad. El journal/snapshot real se auditó aparte; estas unitarias
  no se presentan como prueba de aplicación de migraciones.
- Lint del archivo nuevo: **exit 0**, sin advertencias. Diff sin errores.
- Se reutiliza el build final anterior con TypeScript y 455 páginas, exit 0:
  [verificación del cierre](../../2026-11-21/INV-01.b4.smartlink.ui/alternate-executor.md).
  Después solo se añadió prueba de integración; no se alteró aplicación/DDL.

Base retirada: `inv_sales_next_b4555ade296b4ec1bc538716ac51b377`.
Rol retirado: `inv_sales_role_9f27b2044ece4aff9c7019f55f3a3af9`.
La candidata se ejerce únicamente en esa copia y para ese rol. No se modifica
el rol compartido ni se afirma aplicación en main o en un entorno operativo.

Comandos ejecutados:

```powershell
node .tmp/pos-next-verify.cjs catalog
pnpm.cmd exec vitest run --configLoader bundle tests/unit/migration-manifest.test.ts tests/unit/faltantes-traceability.test.ts --maxWorkers=1 --pool=threads
pnpm.cmd exec eslint tests/integration/sales-import-catalog-runtime-db.test.ts
node .tmp/catalog-manifest-audit.cjs
```

Para reproducir el caso desde checkout sin el wrapper local:

```powershell
$env:NODE_OPTIONS='--use-system-ca --max-old-space-size=4096'
$env:RUN_SALES_RUNTIME_NEXT_BROWSER='1'
pnpm.cmd exec vitest run --configLoader bundle --config vitest.integration.config.ts tests/integration/sales-import-catalog-runtime-db.test.ts --maxWorkers=1 --pool=threads
```

El paquete de aceptación actual sustituye al preliminar, que incluía intentos
fallidos de build y solo V2. Ese historial permanece en
[la evidencia de ingestión](../../2026-11-11/INV-01.b4b/README.md) y en el
registro no aceptado de `INV-01.b4b`; no se convierten fallos históricos en éxitos.
La matriz 11.11 continúa Parcial y los padres siguen pendientes.
