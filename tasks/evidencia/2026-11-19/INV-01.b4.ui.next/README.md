# CSV desde Next hasta el writer runtime

Base `e415a66`, árbol limpio al comenzar. Código probado en `3f8b002`.
Hijo `INV-01.b4.ui.next`, A/M, V2/V3; depende de a, b3, b4b,
runtime.config y b4.ui. Scope: `csv-runtime-scenario.ts` y suite
`sales-runtime-next-browser.test.ts`. Helpers de base desechable/servidor
reutilizados sin alterar sus contratos. No cambió código de producto.

## Recorrido probado

Next de producción, Chromium, Better Auth y login PostgreSQL independiente
con grants mínimos, sin mocks. Tenant/actor/recetas/ingredientes/lotes propios,
distintos del caso manual. Dos recetas de 1 kg por porción, lotes de 20.
CSV con encabezado y recetas con coma entrecomillados; SKU distinto de receta.
Carga por input real, mapping elegido en UI y conservado entre archivos,
día civil explícito y sucursal fijada por cookie autorizada. Se comparan los
bytes enviados y el feedback visible con ventas/movimientos/revisiones SQL.

- Alta de 10 sin ingreso, misma importación con otro nombre sin duplicar,
  corrección a 12 y reducción a 8: saldos 10/8/12. Una identidad
  `pos:import`/`POS-01`/2026-11-19.
- Ingreso NULL→$80.25: 8025 centavos, cuatro revisiones, ningún movimiento
  adicional. Cerrar sesión produce 401 sin efectos; login y reintento omiten
  el total idéntico, sin duplicar.
- Archivo mixto: POS-01 idéntico se omite; POS-02 tiene una línea inválida y
  se bloquea completo, sin subtotal válido; POS-03 exige 21 con saldo 20 y no
  deja identidad/venta/revisión; POS-04 válido se aplica. Errores visibles de
  filas 3/4/5, cobertura incompleta. Solo dos identidades, cinco revisiones,
  venta agregada 9/9025 y saldos 11/20.
- Anular ambos SKU con cantidad e ingreso explícitos 0 devuelve saldos 20/20,
  mantiene dos identidades, siete revisiones y proyección 0/0.
- Móvil 390×844 sin overflow del documento; preview enfocable y desplazable
  con flechas. Captura local inspeccionada:
  `.tmp/csv-sales-runtime-next-mobile.png`. Sin errores de página.

## Verificación

```powershell
$env:NODE_OPTIONS='--use-system-ca --max-old-space-size=4096'
$env:RUN_SALES_RUNTIME_NEXT_BROWSER='1'
pnpm.cmd exec vitest run --configLoader bundle --config vitest.integration.config.ts tests/integration/sales-runtime-next-browser.test.ts --maxWorkers=1 --pool=threads
pnpm.cmd exec eslint tests/integration/helpers/csv-runtime-scenario.ts tests/integration/sales-runtime-next-browser.test.ts
pnpm.cmd exec tsx scripts/validate-faltantes.ts
pnpm.cmd exec vitest run --configLoader bundle tests/unit/faltantes-traceability.test.ts --maxWorkers=1 --pool=threads
```

Corrida final **4/4**, exit 0, duración 169.36 s: tres casos existentes
(catálogo/permisos, servidor y manual) más CSV. Lint exit 0. Trazabilidad
11/11 y validador 239 filas/86 bases/106 hijos/24 aceptaciones/0 errores.
Revisión de corrección, legibilidad, arquitectura, seguridad y costo sin
hallazgos pendientes en este alcance. Se reutilizó el build final de producto
acreditado en manual.next (tipos y 455 páginas): solo cambiaron pruebas
excluidas de tsconfig y documentos.

Primera corrida ampliada: 3/4, exit 1, 181.69 s. La aserción nueva consultaba
`row` en lugar del contrato `rowNumber`; ya había alcanzado sesión/reintento
y archivo mixto. Se corrigió la prueba y se repitió la suite completa.
No fue un fallo de producto ni se alteró el contrato. Un intento básico
anterior terminó pero no se conservó su salida terminal en contexto; no se
usa como evidencia de éxito.

El helper verifica por SQL la desaparición de base/rol generados; el servidor
comprueba salida y puerto cerrado. La corrida final pasó esos checks.
Manifest diagnóstico adicional: `databaseCreated:false`, `roleCreated:false`,
`closed:true`. Copia de la base aislada: sin insertar hechos append-only ni
terminar clientes en el origen. La ejecución autorizada fuera del sandbox
permite retirar los Next propios. Sin URI/contraseña en la evidencia.

## Límites

Código implementado y V2/V3 del recorrido CSV acreditados; no se acepta el
padre ni la fila 11.11. Siguen pendientes dependencias b4b/otros hijos,
cierre POS/smart-link con runtime independiente, almacenamiento/concurrencia
y lectores financieros según sus criterios. Auth/lookup mantienen la
conexión dueña; solo el writer usa el login mínimo. Sin activación de
secretos, migración operativa, modificación de rol compartido o despliegue.
