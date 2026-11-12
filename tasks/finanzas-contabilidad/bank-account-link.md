# Vínculo contable desde cuentas bancarias

Fecha: 2026-11-12. Solicitud: completar el vínculo en `/dashboard/finance/settings/bank-accounts`, conservando la cuenta bancaria y su propósito de pagos, ingresos o mixto.

Cada banco activo tiene una acción **Cuenta contable**. El diálogo consulta el vínculo vigente y permite seleccionar una cuenta de activo, activa, de movimiento y vigente hoy. Un banco mixto conserva el mismo vínculo para entradas y salidas. La acción no cambia su propósito, número, saldo base ni identidad.

Si falta el catálogo, se puede crear una cuenta contable de activo con código, nombre y vigencia dentro del diálogo. Crear la cuenta y guardar el vínculo son acciones explícitas separadas: si el vínculo falla, la cuenta creada permanece disponible sin afirmar que el banco quedó vinculado. No se crean bancos, cuentas de ingreso/gasto, saldos iniciales ni pólizas por inferencia.

Se reutilizan GET/POST de `/api/finance/accounting/preparation`, `createAccount`, `linkSource` y `accounting_source_links`. Guardar aquí modifica el mismo vínculo que utiliza Preparar contabilidad y los adaptadores contables. No se añade tabla, migración, endpoint ni permiso; la API mantiene sesión, empresa, alcance, permisos, bandera, origen y guardas SQL existentes.

Los errores de lectura o guardado se muestran en el diálogo sin bloquear el catálogo bancario. Se conserva la selección al fallar el guardado y se permite reintentar. Las cuentas no elegibles no se ofrecen para un vínculo nuevo; la cuenta actual inválida conserva su identificación con una indicación de revisión. Un banco fuera de MXN o un catálogo truncado no permite guardar.

## Verificación

- Reproducción inicial: el recorrido falla porque la pantalla no tiene la acción contable. Se corrige primero el montaje Vite para evitar dos copias de React; ese error de montaje no se cuenta como reproducción funcional.
- Seis pruebas de navegador nuevas aprobadas: vínculo y reapertura sin cambiar propósito, creación de cuenta y vínculo explícito, error/reintento, acceso denegado, MXN/catálogo incompleto, teclado/móvil y rol sin acción. Regresión de Preparar contabilidad: cinco pruebas aprobadas. Componentes, página, CSS y Radix reales; HTTP y sesión sustituidos por fixtures sintéticos, sin usar la base operativa. Evidencia local: `.tmp/bank-account-accounting-{red-final,focused,final,preparation-regression}.log` y `.tmp/bank-account-accounting-mobile.png`.
- Inspección adicional en Chrome DevTools sobre el montaje local: diálogo, etiquetado de selector, estado deshabilitado y creación disponibles; consola sin errores ni advertencias. Captura inspeccionada desde el navegador. La captura móvil de Playwright comprueba contención del diálogo y retorno del foco al cerrar con Escape.
- ESLint focalizado sin errores ni advertencias. Se ajusta el texto previo de saldo base de 10px a `text-xs` y la altura del botón para seguir la escala de DESIGN.md; el hook de diseño deja de reportarlo.
- TypeScript **exit 0** (`.tmp/bank-account-tsc-independent{,-exit.txt}`); lint global **exit 0, cero errores y 2435 advertencias** (`.tmp/bank-account-lint-independent{,-exit.txt}`). Los archivos modificados de código y pruebas pasan lint sin advertencias.
- La suite general se intenta con un worker y heap de 4096 MB: registra cuatro fallos en `tests/unit/inventory/sales-entry-access.test.ts` (`ownedRecipes.map is not a function`), fuera de los archivos de este cambio. Tanto ese test como `app/api/inventory/sales-entry/route.ts` se están modificando en paralelo; se conservan. Se interrumpe la ejecución propia sin marcarla aprobada ni excluir pruebas para conseguir un verde. Evidencia: `.tmp/bank-account-unit-all.log`. El resultado general del commit aislado deberá acreditarse por separado en CI.
- Regresión unitaria financiera **18 archivos, 203/203 aprobadas, exit 0** (`.tmp/bank-account-finance-unit.log` y su archivo de salida). **Build de producción exit 0**, con compilación, tipos y generación aprobados, usando red autorizada para fuentes y el bundler/configuración existentes (`.tmp/bank-account-build.log`, `.tmp/bank-account-build-exit.txt`).

La intervención conserva las modificaciones concurrentes de inventario, migraciones y planificación. No configura cuentas reales ni activa o certifica FC-20/21. Los cambios de despliegue, si se ejecutan, deben registrarse después de verificar el commit y el sitio publicado.
