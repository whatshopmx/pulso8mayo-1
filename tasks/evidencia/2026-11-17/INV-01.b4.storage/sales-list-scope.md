# Cortes de ventas: alcance del listado por sucursal

Incremento sobre `9bf4089`, conservando los cambios locales de otros frentes.

## Brecha reproducida

`GET /api/sales/cuts` filtraba por empresa de sesión y por el `branchId`
opcional del query. Un gerente sin filtro recibía cortes de otras sucursales
de su empresa; también podía solicitarlos explícitamente. La guardia del
archivo POS no protegía los importes y metadatos expuestos por este listado.

La prueba con Next de producción y Better Auth real reprodujo el caso con
dos sucursales sintéticas: un gerente de la segunda recibió el corte de la
primera, incluido su importe. Se esperaba un listado vacío en ese fixture y
la prueba falló. Las unitarias reprodujeron siete fallos antes del cambio.

## Cambio

- La ruta resuelve el alcance con el rol y la sucursal de la sesión antes de consultar.
- GERENTE/SUPERVISOR sin filtro consultan solo su sucursal; sin asignación reciben 403.
- Una petición explícita a otra sucursal recibe 403 antes de consultar cortes.
- ADMIN/SUPER_ADMIN conservan el alcance de empresa y el filtro opcional.
- Filas, conteo y `scope.branchId` comparten la misma sucursal efectiva.
- Un identificador de sucursal mal formado devuelve 400 antes de llegar a PostgreSQL.

## Verificación

| Control | Resultado |
|---|---|
| Unitarias de alcance, lectura POS, vínculo y storage | 52/52, cuatro archivos, exit 0 |
| ESLint de ruta y pruebas modificadas | exit 0 |

La integración ampliada incluye dos cortes en dos sucursales de la misma
empresa y sesiones independientes: ADMIN propio debe ver ambos; GERENTE solo
el propio, con conteo 1; ADMIN ajeno debe ver cero; EMPLEADO recibe 403.
También comprueba el filtro explícito propio y el rechazo de sucursal ajena.
La limpieza elimina únicamente los UUID sintéticos de ambos cortes y las
sesiones, cuentas, usuarios, logs y empresas del fixture.

## Límites

El cambio protege el listado HTTP en su frontera de aplicación. No habilita
RLS para sus consultas completas ni amplía los grants de la candidata 0155.
La conexión Next sigue siendo la dueña del entorno aislado; las pruebas RLS
con `pulso_app` están separadas en `rls-candidate.md`.

No se aplican migraciones ni se acepta `INV-01.b4.storage` o sus padres.
La ruta de upload directo de cortes, que usa el namespace legacy
`sales-cuts`, continúa como un productor pendiente de adaptar al contrato POS.
