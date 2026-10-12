# C13 — Conservar valores y errores de configuración

Fecha: 12 de octubre de 2026. Seguimiento: [C13](../../tasks/plan-conexion-frontend-backend.md#c13).

## Investigación y alcance

El seguimiento registra C00–C12 completados; C13 abre la Fase 3 (configuración que produce efectos) con H05. Ya había cambios locales sin registrar en el formulario, la página, la ruta y las secciones: se continuaron y verificaron aquí.

El defecto central era la inicialización con `||`: un umbral guardado en cero se recargaba como el default del módulo ($1,000 de autonomía, $5,000 de caja chica) y el siguiente guardado persistía ese default sobre la fila real. Dos defectos acompañaban al primero:

- Un `GET` fallido dejaba `config` en `null` y el formulario se montaba igual, con defaults aparentes: guardar tras un fallo escribía valores que nadie eligió.
- Un campo de monto vacío se enviaba como `NaN` → `null` en el JSON, que el PUT rechazaba como "expected number", cuando el contrato dice que `null` significa "sin tope".

## Comportamiento implementado

- El mapeo ida y vuelta vive en `lib/company/operating-config-values.ts`, sin React ni Drizzle, para poder comprobarlo en V1. `centavosAPesos`/`pesosACentavos` distinguen vacío (`null`, sin tope) de cero guardado.
- `valoresIniciales` sólo aplica defaults cuando el campo no tiene fila; un cero, un `"0.00"` y un `null` guardados sobreviven al viaje.
- La página tiene tres estados —cargando, cargada, fallida— y sólo monta el formulario en los dos últimos. El estado fallido ofrece reintento, ignora respuestas fuera de orden y explica por qué no se muestran valores de ejemplo.
- El PUT valida unidades (centavos enteros, no decimales), rangos (0..2147483647, porcentajes 0..100) y dimensiones con mensajes por campo; un umbral parcial se contrasta contra el objetivo guardado antes de cualquier escritura. La respuesta devuelve lo que quedó guardado —incluido el tope de cortesías, que vive en `companies`—, no lo que pidió el formulario.
- Los errores del servidor (`fieldErrors`) se traducen al input que los causó, con `aria-invalid`, `aria-describedby` y `role="alert"`; guardar queda deshabilitado con mensaje visible mientras haya un campo no numérico.
- Un porcentaje vacío ya no se guarda como cero: `NaN` bloquea el guardado y nombra el campo.

## Evidencia y límites

| Verificación | Resultado |
| --- | --- |
| `pnpm run test:unit` | 69 archivos; 924 pruebas aprobadas, 1 omitida y 1 TODO. Incluye los 21 casos de `tests/unit/company/config-roundtrip.test.ts`. |
| `pnpm exec playwright test --config tests/playwright-shifts.config.ts operating-config.spec.ts` | 11/11 aprobadas en Chromium: cero visible y persistente, sin tope como `null`, carga fallida sin formulario y con reintento, error por campo con aria, objetivo vacío bloqueado, descartar a valores guardados. |
| `pnpm run lint` | 0 errores, 2386 warnings (los dos warnings de los archivos de C13 —`_c` en la ruta y `cn` en la sección de costos— son preexistentes, verificados contra `HEAD`). |
| `pnpm run build` | Aprobado, incluido TypeScript. |

El navegador ejecuta la página, el formulario, las secciones y el mapeo reales; el servidor de pruebas sustituye el `GET`/`PUT` por respuestas controladas. No ejecuta Next, autenticación ni consultas de Postgres: la autorización (sesión, `requireTenant`, permiso de configuración) queda cubierta por los casos de la propia suite unitaria sobre la ruta real, con `db` y contexto simulados.

Límites:

- El formulario sigue confiando en que el servidor autoriza; V2 no reproduce un usuario de otra empresa porque el aislamiento ya está probado en las rutas de C01–C07 y aquí se cubre con los casos de 403/sesión unitarios.
- La vigencia de los parámetros y el tratamiento de periodos cerrados no se tocan: es la decisión pendiente de C14, previa a habilitar efectos históricos.
- Los defaults de módulo para una empresa sin fila se conservan tal cual; cambiarlos es decisión de negocio, no de este defecto.

## Continuidad

C14 expone los cuatro parámetros que faltan (IVA, carga laboral, impuesto estatal, umbral de merma) sobre este contrato; C15 define el catálogo de las siete dimensiones y caja chica. Ambas dependen de que guardar y recargar conserven lo escrito, que es lo que cierra esta tarea.
