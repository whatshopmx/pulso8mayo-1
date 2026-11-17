# NEXT-COMPAT — Compatibilidad de rutas/páginas Next (los seis archivos)

Continuación 2026-11-17 sobre HEAD `0dfd139d75a5870d7af3baad5423d218f54a093f` más cambios locales. **Compatibilidad corregida y certificada con los validadores de ruta generados por Next; el build completo sigue limitado por el entorno (fuentes/ENOMEM), no por el código.**

## Contexto

La [consolidación 2026-11-16](../2026-11-16/CONSOLIDACION/README.md) registró que, tras regenerar los validadores de producción, el type-check fallaba con 7 errores en 6 archivos base: exports adicionales no permitidos en rutas (`getSavedSearches`, `MAX_HIGH_VALUE_SKUS`, `WASTE_ERROR_CODES`), `params` síncrono en dos páginas y una prop extra en `profile`. Los seis archivos ya tienen el arreglo aplicado en el árbol (sin commit de esta sesión):

| Archivo | Arreglo |
|---|---|
| `app/api/employees/search/route.ts` | `getSavedSearches` deja de ser export de ruta (`const`). |
| `app/api/inventory/products/route.ts` | `MAX_HIGH_VALUE_SKUS` deja de ser export de ruta (`const`). |
| `app/api/inventory/waste/route.ts` | `WASTE_ERROR_CODES` deja de ser export de ruta (`const`). |
| `app/dashboard/labor/shift-changes/[id]/page.tsx` | `params: Promise<{ id: string }>` + `use(params)`. |
| `app/dashboard/profile/page.tsx` | La página no recibe props; `userPromise` queda en el componente cliente. |
| `app/external/report/[token]/page.tsx` | `params: Promise<{ token: string }>` + `await params`. |

## Certificación

Next 16.1.6 expone `next typegen` («Generate TypeScript definitions for routes, pages, and layouts without running a full build»). Se regeneraron los validadores para TODAS las rutas vigentes —incluida la nueva `app/api/sales/cuts/[id]/pos-file/route.ts`— y el `.next/types/validator.ts` resultante incluye los seis archivos y la ruta nueva. El `tsconfig.json` incluye `.next/types/**/*.ts`, así que el typecheck global los valida.

| Comando | Resultado |
|---|---|
| `pnpm.cmd exec next typegen` | **exit 0**, «Types generated successfully» |
| `node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc --noEmit --incremental false` | **exit 0** (incluye `.next/types/**/*.ts` frescos) |
| `pnpm.cmd exec vitest run …` (suites de los incrementos de la fecha) | **exit 0** |

Comprobación de cobertura del validador: `.next/types/validator.ts` valida `employees/search`, `inventory/products`, `inventory/waste`, `labor/shift-changes/[id]`, `dashboard/profile`, `external/report/[token]` y la nueva `sales/cuts/[id]/pos-file`. Ninguna exporta símbolos fuera del contrato (GET/POST/DELETE/default/config).

## Límites

- **Certificación de tipos de ruta/página**, no del build completo. La compilación de módulos + generación estática (`next build`) sigue condicionada por el entorno: Turbopack falla al descargar Geist/Geist Mono y Webpack exige heap de 4 GB y tarda ~18 min; ninguno es un fallo del código. No se declara `next build` exit 0.
- Los seis archivos no reciben commit en esta sesión; se certifican sobre el árbol compartido.
- La ruta nueva `pos-file` se valida por tipos; su comportamiento V2/V3 se registra en `INV-01.b4.storage`.

No se acepta ninguna casilla del checklist por este incremento: es una certificación transversal, no una funcionalidad. El build del hito sigue pendiente como gate separado.
