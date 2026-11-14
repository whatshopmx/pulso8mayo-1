# Demo contable publicado en Netlify

Fecha: 2026-11-12. Estado: banderas habilitadas y consulta verificada; piloto contable FC-20/21 sin aceptar.

El propietario solicita encender contabilidad y publicar el demo en Netlify; confirma que no hay clientes y que los datos son del seed. Después confirma haber agregado `ACCOUNTING_REVIEW_ENABLED=1` y `ACCOUNTING_POSTING_ENABLED=1` en Netlify. No se cambian `.env` local, credenciales, cuentas ni datos contables desde esta intervención.

Se sube a `origin/main` el commit vacío `e6a93ff9fd4338447ab13ce84083bf1912f4397e` para solicitar el redeploy vía la integración Git. Su árbol de archivos coincide con `2be55da`; las modificaciones locales concurrentes quedan fuera. GitHub inicia CI, pero el push por sí solo no acredita que Netlify haya publicado esa revisión. No se obtiene acceso al panel privado: BrowserSkill no tiene navegador conectado y no hay credenciales de CLI/API Netlify configuradas. No se consultan ni extraen tokens del navegador.

## Comprobación del sitio publicado

- `https://pulso-horeca.netlify.app`: HTTP 200, servido por Netlify.
- Inicio de sesión con la administradora demo del seed: HTTP 200. La sesión temporal se cierra al terminar; no se guardan contraseña, token ni cookies en la evidencia.
- `GET /api/finance/accounting/preparation`: HTTP 200 con `success=true`. Esta ruta exige sesión, permiso y bandera de revisión; su respuesta devuelve `postingEnabled=true`.
- Catálogo observado: cinco centros/partidas, **cero cuentas contables y cero vínculos**. No se publica apertura ni póliza, no se recuperan hechos ni se modifica una operación para simular contabilidad lista.
- [Evidencia de lectura](pilot-netlify-2026-11-12.json). La consulta acredita las banderas del sitio activo al comprobarlo; no identifica el hash exacto desplegado ni la conexión de base remota.

Las 23 pruebas focalizadas de rutas contables pasan en cuatro archivos unitarios. La compilación local restringida falla descargando Geist/Geist Mono; el reintento con red autorizada **aprueba con exit 0**, incluida compilación, tipos y generación, sin cambiar configuración. Evidencia: `.tmp/accounting-pilot-netlify-build-network.log` y `.tmp/accounting-pilot-netlify-build-network-exit.txt`. El [CI de GitHub del commit de redeploy](https://github.com/whatshopmx/pulso8mayo-1/actions/runs/43251873706) termina **success**. Estas comprobaciones no sustituyen la prueba funcional del piloto ni el resultado privado del despliegue de Netlify.

## Preparación que falta para operar el demo

Configurar catálogo y vínculos, reglas y apertura sintéticos revisables para la empresa demo; comprobar que la base de Netlify tiene el esquema necesario (la migración autorizada de `.env` no demuestra identidad de la conexión remota); verificar recepción/factura/pago y recuperación con importes conocidos. FC-14–19 y la activación recuperable por empresa FC-20 siguen pendientes según el plan. Esta prueba no acredita estados/cierre/exportación ni validación contable/fiscal de un cliente.

Para desactivar, cambiar ambas banderas a `0` en Netlify y redesplegar; verificar que la ruta de revisión vuelve a su bloqueo de servicio sin borrar datos. La variable debe estar disponible para Functions: [documentación oficial](https://docs.netlify.com/build/functions/environment-variables/). No revertir ni borrar pólizas como mecanismo de apagar el demo.

## Implementación de activación recuperable por empresa (FC-20, 2026-11-14)

- **Control por empresa (`accounting_company_settings`, migración `0150_fc20_company_activation.sql`):** modos `DISABLED`, `COMPARISON` y `ACTIVE` con `postingEnabled`, `reviewEnabled`, fecha de apertura y registro de activación/desactivación (`disableReason`).
- **Vista previa de apertura sin publicación automática:** `previewCompanyOpening` y `scripts/accounting-opening-preview.ts` validan balance, vigencia de cuentas, ausencia de pólizas en/antes de `openingDate` y contabilizan histórico excluido (`historicalExcluded`).
- **No solapamiento histórico:** `recordAccountingEventIn` y `recoverMissingAccountingEvents` omiten operaciones con fecha `<= openingDate`.
- **Retroceso seguro:** `disableCompanyPilot` detiene nuevos hechos, recuperación (`recoverMissingAccountingEvents`, `dueAccountingEvents`) y publicación (`processAccountingEvent`, `accountingPost`) para la empresa sin borrar pólizas ni evidencia en `accounting_events`.
- **Métricas por empresa:** `measureCompanyPilotMetrics` mide backlog (`pendingCount`, `maxAgeSeconds`), fallos (`failedCount`, `recentErrors`), latencia promedio y diferencias P&L vs contabilidad/flujo (`ESTIMACION`, `FECHA`, `FUENTE`).
- **Documentación operativa:** [docs/accounting-operations.md](../../docs/accounting-operations.md).
- **Pendiente de FC-21:** validación formal del primer cierre piloto por el responsable contable antes de ampliar la activación.
