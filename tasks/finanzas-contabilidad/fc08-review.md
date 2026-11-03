# FC-08 · Apertura y reglas vigentes

Actualización 2026-11-03: la experiencia de configuración descrita aquí queda sustituida por [Preparación contable guiada](preparacion-guiada.md). Se conserva esta nota como evidencia histórica de FC-08; sus formularios de códigos, roles y versión anterior ya no son el recorrido de usuario propuesto.

Extensión de **Cierre y control**, en modo Operate, para fijar la apertura de la empresa y administrar las reglas que traducen cada hecho en cuentas. Conserva la identidad de Pulso: mando operativo, lenguaje directo y una siguiente acción reconocible. Esta nota documenta la pantalla y su contrato local; `PRODUCT.md`, `DESIGN.md` y `.impeccable/design.json` conservan su autoridad global.

## Diseño heredado

- Geist, títulos semibold, cuerpo de 14 px y metadatos de 12 px; importes alineados a la derecha y cifras tabulares. Moneda MXN con formato `es-MX`.
- Superficies `background` y `muted`, texto `foreground` y `muted-foreground`, divisores `border` e inputs `input`; los errores usan `destructive` y el foco usa `ring`. Los controles propios reutilizan la clase de campo compartida y el foco visible.
- Operational Red queda reservado a la acción principal; el resto se apoya en texto y superficies tonales. Sin nuevas paletas, sombras decorativas ni tipografías.
- Contenedor de hasta `max-w-6xl`, ritmo vertical de 32 px y márgenes laterales de 16 px, ampliados desde `sm`. No se duplica el landmark principal del dashboard.

## Composición y adaptación

La entrada regresa a Cierre y control y presenta título «Contabilidad» con una explicación de dos frases: la apertura se fija una vez y una regla publicada no se edita, se revisa. La página se divide en dos secciones con divisor superior: **Apertura** y **Reglas de reconocimiento**. No usa métricas decorativas.

- **Apertura:** mientras no existe, un formulario con fecha contable, motivo de publicación, nota opcional, renglones (cuenta, cargo/abono, importe, nota) y documentos de respaldo (documento, referencia, importe opcional). Inicia con dos renglones y uno de cada lado no se puede quitar; los documentos exigen al menos uno. El resumen vivo muestra cargos, abonos y diferencia. Una vez publicada se sustituye por un resumen: fecha, póliza, motivo, tabla de documentos y totales, con el aviso de que la corrección se registra con una reversa.
- **Reglas:** barra de vista previa por hecho y fecha, seguida del filtro por hecho y paginación. La tabla muestra hecho, regla, versión, vigencia, estado y «Ver cuentas». El detalle lista el mapeo por rol con la cuenta, marcando inactiva o acumulativa. «Nueva regla» abre una captura con código, nombre, hecho, vigencia, versión anterior opcional, estado activo y una entrada por rol.
- Desde `sm` los formularios usan dos o cuatro columnas; en móvil se apilan. Las tablas grandes viven en un contenedor con desbordamiento horizontal y conservan su `caption` para lectores de pantalla.

## Interacción, foco y estados

- Toda etiqueta visible está asociada a su control; las etiquetas de renglones repetidos usan `sr-only` más identificadores estables. Los campos obligatorios usan validación nativa; el servicio repite la validación.
- Vista previa: al enviar se consulta el servidor y se muestra la versión resuelta con sus bloqueos en `role=status` y lista `destructive`. Sin regla vigente lo dice explícitamente en lugar de dejar el espacio vacío.
- Carga de apertura y reglas: mensaje de estado; error: `role=alert` con «Volver a consultar» en la lista de reglas. Confirmaciones de éxito: `role=status` en la cabecera de la página.
- El estado de carga de la lista se deriva de la clave de la consulta (página, hecho y refresco) en vez de asignarse dentro del efecto; así una respuesta vieja no deja la pantalla en carga y se evita el render en cascada señalado por `react-hooks`.
- Durante publicar o registrar se deshabilita el botón y cambia su texto. Un conflicto del servicio (regla ausente, versión retirada, cuenta no usable, apertura ya existente) aparece con el motivo tal cual, sin reinterpretarlo en el cliente.

## Capacidades y trazabilidad

| Actor | Contrato |
| --- | --- |
| OWNER / SUPER_ADMIN | Configura reglas y publica la apertura dentro de la empresa. |
| ADMIN | Configura reglas y publica la apertura si tiene publicación contable y alcance de empresa. |
| Roles con alcance de sucursal | No operan apertura ni reglas: ambas son de empresa. |

Configurar reglas o apertura exige `settings:update` y alcance COMPANY; publicar la apertura exige además `accounting:publish`. El servicio vuelve a resolver empresa, actor activo y rol en base de datos; la interfaz solo ofrece lo que la API devuelve. No se crea un rol CONTADOR.

## Reglas, versión y apertura

- Una regla es una fila inmutable por versión. Revisar es insertar una fila nueva con `supersedesId`, `version` = anterior + 1 y `effectiveFrom` posterior, sin `effectiveTo`. Se resuelve la versión más reciente con `effectiveFrom <= fecha` del hecho.
- La póliza congela `ruleId`/`ruleVersion`; la versión se resuelve siempre en servidor. Al publicar un hecho sin regla se resuelve y congela la última vigente; falta de regla, versión retirada, regla vacía o cuenta requerida inactiva, acumulativa o fuera de vigencia bloquean con el motivo explícito.
- La apertura es única por empresa, inmutable, con póliza `source_type='OPENING'`, hecho nulo y al menos un documento de respaldo. No puede solaparse con pólizas publicadas en o antes de su fecha y ninguna póliza puede fecharse en o antes de la apertura.
- No se siembran reglas, cuentas ni aperturas: cada empresa configura las suyas. La falta se reporta como bloqueo, nunca se rellena por omisión.

## Evidencia y habilitación

- Integración `tests/integration/accounting/opening-mapping.test.ts` **9/9, exit 0**, sobre esquema aleatorio en base aislada con rol `NOBYPASSRLS` y migraciones 0124–0130.
- Checkpoint global en `todo.md`: suite **2405 aprobadas**, lint **0 errores / 2438 advertencias**, TypeScript **exit 0** y **build exit 0 con 439 páginas**.
- La funcionalidad permanece **deshabilitada**. La API solo se habilita con `ACCOUNTING_REVIEW_ENABLED=1`; cualquier otro valor conserva la respuesta 503. No se han aplicado migraciones operativas ni se ha activado contabilidad.
- Límite: la revisión funcional de las reglas con el responsable contable y el piloto real siguen pendientes. Activar la bandera sin esa revisión publicaría pólizas con un mapeo no aprobado.

Fuentes del contrato: `components/finance/accounting-settings.tsx`, `app/dashboard/finance/settings/accounting/page.tsx`, `lib/services/accounting/mapping-service.ts`, `lib/services/accounting/opening-service.ts`, `lib/services/accounting/journal-service.ts` y `drizzle/0130_fc08_rules.sql`.
