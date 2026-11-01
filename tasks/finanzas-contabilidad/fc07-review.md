# FC-07 · Contrato local de revisión de pólizas

Extensión de **Cierre y control**, en modo Operate, para consultar pólizas, capturar borradores y autorizar ajustes con trazabilidad. Conserva la identidad de Pulso: mando operativo, lenguaje directo y una siguiente acción reconocible. Esta nota documenta la pantalla construida; `PRODUCT.md`, `DESIGN.md` y `.impeccable/design.json` conservan su autoridad global.

## Diseño heredado

- Geist, títulos semibold, cuerpo de 14 px y metadatos de 12 px; importes alineados a la derecha y cifras tabulares. Moneda MXN con formato `es-MX`.
- Superficies `background` y `muted`, texto `foreground` y `muted-foreground`, divisores `border` e inputs `input`; los errores usan `destructive` y el foco usa `ring`. Los componentes compartidos resuelven los valores de los tokens del sistema.
- Operational Red queda reservado a las acciones principales; estados y agrupaciones se apoyan en texto y superficies tonales. Sin nuevas paletas, sombras decorativas ni tipografías.
- Contenedor de hasta `max-w-6xl`, ritmo vertical de 24 px y márgenes laterales de 16 px, ampliados desde `sm`. Botones, inputs y esquinas heredan los componentes compartidos; los controles propios conservan bordes finos y foco visible.

## Composición y adaptación

La entrada ofrece regreso a Cierre y control, título «Pólizas», explicación breve y «Nueva póliza» cuando existe capacidad. Debajo aparecen filtro de estado, ámbito y moneda, listado paginado y detalle en la misma página. El listado distingue borrador/publicada y vínculos de reversa/reemplazo; no usa métricas decorativas.

Desde `sm`, el listado presenta cinco columnas. En móvil, cada registro se reorganiza en una lista de dos columnas: concepto a todo el ancho, fecha y sucursal con etiquetas propias, estado y botón «Revisar». El detalle conserva **Cuenta y nota / Cargo MXN / Abono MXN simultáneamente**, también en móvil, con contenedor de desbordamiento horizontal cuando sea necesario. No convierte cargo y abono en vistas alternas.

El editor sustituye el listado temporalmente. Fecha y sucursal comparten fila desde `sm`; en móvil se apilan. Cada renglón agrupa cuenta, lado e importe, seguido de nota opcional y «Quitar»; las columnas se apilan en móvil. El resumen muestra cargos, abonos y diferencia. La interfaz inicia con dos renglones, permite añadir hasta 200 y evita quitar por debajo de dos.

## Interacción, foco y estados

- «Revisar» carga renglones e historial y lleva el foco al encabezado del detalle. «Cerrar detalle» devuelve el foco al botón visible del registro de origen.
- El contenido reutiliza la región principal que ya proporciona el dashboard, sin crear un segundo landmark `main` anidado. Las etiquetas de cuentas conservadas fuera de la página actual del catálogo se resuelven por identificador al quitar o desplazar renglones.
- Abrir captura, edición o reemplazo lleva el foco al encabezado del editor. «Cancelar» devuelve el foco al botón que lo abrió: nueva póliza, editar borrador o corregir con reemplazo. Este retorno fue corregido durante la revisión de acabado.
- Abrir la confirmación de publicación o reversa enfoca el campo «Motivo». Los controles conservan operación nativa por teclado y anillo visible; encabezados de destino usan `tabIndex=-1`.
- Carga del listado: bloques tonales con `role=status` y pulso condicionado a movimiento permitido. Carga de detalle: mensaje de estado. Lista vacía: explicación contextual. Errores: `role=alert` y acciones para volver a consultar o recargar cuentas. Confirmaciones de éxito: `role=status`; totales del editor: región viva discreta.
- Durante guardar o autorizar se deshabilitan los controles correspondientes y se muestra «Guardando…» o «Registrando…». Un conflicto de versión requiere actualizar la póliza; la solicitud transporta la versión observada.
- Se puede guardar un borrador descuadrado. Publicar exige al menos dos renglones, balance y cuentas activas, de movimiento y vigentes en la fecha contable. El botón anticipa balance y cantidad; el servicio vuelve a validar las reglas.

## Capacidades y trazabilidad

| Actor | Contrato |
| --- | --- |
| ADMIN | Captura y edita borradores; no publica ni revierte. |
| OWNER / SUPER_ADMIN | Captura y edición, publicación, reversa y corrección con reemplazo dentro del ámbito autorizado de empresa. |
| Roles con alcance de sucursal y permiso de lectura | Consulta únicamente su sucursal asignada y activa; sin escritura ni partidas corporativas. |

No se crea un rol CONTADOR. La UI deriva acciones de las capacidades devueltas; el servicio comprueba permisos, actor activo, empresa y alcance de sucursal. «Editar borrador» se ofrece para captura manual, sin fuente asociada. La pantalla no ofrece eliminación.

Publicar pide un motivo de 5 a 500 caracteres, asigna folio y protege la póliza. Una publicada conserva sus renglones: la corrección se registra mediante otra póliza, nunca sobrescribiendo la original. La reversa invierte cargos y abonos y se publica con motivo y fecha elegida; una original ya revertida no ofrece una segunda reversa.

«Corregir con reemplazo» publica la reversa y guarda el reemplazo como borrador en una transacción. **Reversa y reemplazo comparten la misma fecha contable elegida y la sucursal original**; esa fecha no tiene que ser la fecha de la original. El reemplazo requiere revisión y publicación posterior; su fecha queda bloqueada al editarlo. El historial muestra origen manual o fuente, fecha y actor de captura, motivo/fecha/actor de publicación y enlaces entre original, reversa y reemplazo.

## Evidencia y habilitación

La revisión fresca de acabado concluyó **SHIP, sin hallazgos abiertos**, después de corregir el retorno de foco al cancelar el editor. Evidencia visual:

| Comprobación del revisor | Dictamen |
| --- | --- |
| Desbordamiento del listado móvil | Resuelto |
| Visibilidad simultánea de cargos y abonos | Resuelto |
| Ajuste del identificador del actor | Resuelto |
| Identidad visual existente | Resuelto |
| Motivo explícito de autorización | Resuelto |
| Navegación original/reversa/reemplazo | Resuelto |
| Foco al cancelar el editor | Resuelto |
| Acabado global de esta pantalla | SHIP |

- `.tmp/fc07-desktop.png`
- `.tmp/fc07-mobile.png`
- `.tmp/fc07-editor-desktop.png`
- `.tmp/fc07-editor-mobile.png`

Estas capturas provienen de un arnés sintético de HTTP y sesión que renderiza los componentes y CSS reales. No prueban contabilidad productiva en vivo ni un piloto con clientes. Los resultados del checkpoint técnico se registran por separado en `todo.md`; el dictamen visual no sustituye esas verificaciones.

La funcionalidad permanece **deshabilitada** y no se han aplicado migraciones operativas. La API solo se habilita con `ACCOUNTING_REVIEW_ENABLED=1`; cualquier otro valor conserva el cierre seguro con respuesta 503 y explicación para seguir consultando resultados operativos. Activar esa variable únicamente después de revisar las migraciones y su aplicación correspondiente.

Fuentes del contrato: `components/finance/accounting-journals.tsx`, `accounting-journal-editor.tsx`, `accounting-types.ts`, `lib/services/accounting/journal-service.ts` y `journal-http.ts`.
