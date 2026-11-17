# Acceso al archivo POS desde el detalle del corte

Incremento posterior a `9ca357c` / `37d26ef`: conectar la UI con la lectura privada
sin debilitar la validación de referencias. Árbol compartido con cambios locales
preexistentes; solo se incluyen los archivos de este incremento.

## Comportamiento

- El detalle del corte muestra **Consultar archivo POS** si tiene una referencia. No coloca `rawFileUrl` en ningún enlace.
- La consulta llama a `/api/sales/cuts/{id}/pos-file`; solo una respuesta válida ofrece **Abrir archivo POS**, en otra pestaña con `noopener noreferrer`.
- El enlace se retira al vencer el TTL del servidor (máximo 600 segundos). Una nueva consulta solicita otra firma; no se persiste en localStorage ni se reutiliza entre cortes.
- Durante la consulta se bloquea la duplicación y se anuncia el estado. Cerrar el detalle aborta la petición; el componente se reinicia al cambiar de corte o referencia.
- Sesión vencida, permiso denegado, archivo no disponible y error de red tienen mensajes operativos y reintento. No se muestran detalles de excepciones ni se admiten esquemas de URL distintos de HTTPS.
- Sin referencia, se informa que no hay archivo adjunto y no se realiza una consulta.

## Verificación

| Control | Resultado |
|---|---|
| Regresión antes de implementar | El detalle se renderizaba y faltaba `Consultar archivo POS` |
| `pnpm.cmd exec playwright test --config tests/playwright-pos-file.config.ts` | 10/10 Chromium, exit 0 |
| Regresión de red antes de corregir el mensaje | Mostraba `Failed to fetch`; tras corregirlo pasa con mensaje operativo |
| Caso reforzado de teclado/composición | 1/1, exit 0; repetición del mismo caso, no un caso funcional adicional |
| ESLint de componente, detalle, arnés, spec y configuración | exit 0, sin diagnósticos |
| TypeScript con heap de 4096 MiB, `--noEmit --incremental false` | Código nativo 0, sin diagnósticos |
| Next CLI `build --webpack`, con certificados del sistema y heap de 4096 MiB | Código nativo 0; compilación, tipos, 455/455 páginas y trazas completadas |
| Chrome DevTools, contexto aislado de localhost | Acción accesible; estado anunciado; sin errores ni advertencias de consola en la vista inicial |

Los diez casos cubren enlace autorizado, HTTP 401/403/404/500 con reintento,
ausencia de archivo, expiración y firma nueva, red caída/respuesta inválida,
respuesta tardía de un corte cerrado y teclado/composición en 320/768/1024/1440 px.

El arnés usa `SalesCutDetailSheet`, `SalesCutPosFile`, Radix y CSS compilado reales,
con cortes y respuestas HTTP sintéticos explícitos. No reemplaza los componentes.
La primera captura se tomó durante la animación; se corrigió esperando los límites
del panel y terminando animaciones al capturar. La comprobación reforzada pasó.

Capturas finales: [móvil](ui-access-mobile.png) y [escritorio](ui-access-desktop.png).

El build se ejecutó directamente con Node y el CLI instalado de Next (equivalente
al script `build` con `--webpack`). Un proceso Node capturó los códigos de salida
nativos y escribió los logs, evitando el falso negativo de redirección de stderr
en PowerShell observado en el incremento anterior. Resultado: tipos 0 (298 s),
build 0 (560 s). Logs locales no versionados: `.tmp/pos-ui-types.log`,
`.tmp/pos-ui-build.log` y `.tmp/pos-ui-check-results.json`.
Persisten los mensajes conocidos de `fetchConnectionCache` y render estático de
`/dashboard/labor/documents` por `headers`; no impidieron terminar el build.
No se repitió la suite general ni se afirma suite global verde: el incremento
anterior había registrado cuatro fallos de finanzas fuera del flujo POS.

## Alcance de la aceptación

Esto acredita la UI en navegador aislado. No acredita aún el recorrido completo
Next + Better Auth + DB + R2 desde esta pantalla, ni el runtime NOBYPASSRLS.
No acepta `INV-01.b4.storage`, sus padres ni la fila 11.11.

La política legacy de `pos-reference-isolation.md` permanece vigente. Las claves
históricas y las subidas por `/api/sales/cuts/upload` que usan el espacio
`sales-cuts` no se vuelven válidas por añadir este botón: la ruta privada conserva
su contrato canónico POS. Unificar esos productores exige otro incremento.

No se modificaron las rutas de subida/lectura, el contrato de autorización,
las migraciones, la ingesta ni las pantallas locales ajenas a este trabajo.
