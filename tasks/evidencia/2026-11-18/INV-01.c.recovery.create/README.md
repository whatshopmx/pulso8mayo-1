# Recovery: creación visible de expediente

Base: HEAD `9bf4089` más cambios locales preexistentes. Continuación de `INV-01.c.recovery.ui-routes`, sin aceptación del hijo ni de sus padres.

## Criterios y cambio

- Desde captura de ventas y con sucursal seleccionada, abrir recuperación y elegir Crear expediente.
- Capturar UUID de venta y tres atestaciones distintas ya verificadas (venta, receta histórica y ausencia de consumo), más motivo obligatorio de hasta 2000 caracteres.
- Enviar únicamente referencias, sucursal, motivo y clave idempotente al POST existente. Empresa y actor siguen resueltos en servidor; se conservan autorización, verificación de fuentes, R2 obligatorio y transacción del servicio.
- Conservar clave al reintentar los mismos datos mientras el formulario siga abierto. Cambiar datos genera otra clave. Deshabilitar acciones y cierre durante el envío; timeout de 30 segundos libera el formulario y permite reintentar.
- Abrir el expediente devuelto para revisión; crear no aprueba, aplica inventario ni elimina la segregación de funciones. El ID permanece en el campo de consulta si falla la lectura posterior.
- Reiniciar el diálogo por sucursal para evitar arrastrar venta, propuesta o motivo a otra sucursal.

La nueva pieza `recovery-create-form.tsx` mantiene la captura fuera del diálogo de revisión. Se elevaron cinco tamaños de 10/11px a `text-xs` según el mínimo de DESIGN.md. El arnés Vite existente ahora preoptimiza Radix Dialog para evitar una segunda copia de React al abrir el diálogo.

## Verificación

Antes de integrar el formulario, el test de navegador falló esperando Crear expediente en el diálogo existente. Una primera ejecución descubrió además un fallo del arnés (Invalid hook call por optimización tardía de Radix); se corrigió antes de reproducir la ausencia de la acción.

| Comando | Resultado |
|---|---|
| `pnpm.cmd exec playwright test --config tests/playwright-sale-recovery.config.ts` | 4/4 Chromium, 29,6 s; componentes reales, API simulada |
| `pnpm.cmd test:unit lib/storage/__tests__/pos-upload.test.ts tests/unit/sales/pos-file-read.test.ts tests/unit/inventory/sales-entry-smart-link.test.ts lib/services/__tests__/sale-recovery-proposals-route.test.ts --maxWorkers=1 --pool=threads` | 59/59, cuatro archivos; incluye regresiones del aislamiento POS |
| `pnpm.cmd exec eslint app/dashboard/inventory/sales-entry/recovery-create-form.tsx app/dashboard/inventory/sales-entry/recovery-dialog.tsx app/dashboard/inventory/sales-entry/sales-entry-client.tsx tests/e2e/sale-recovery-create.spec.ts tests/playwright-sale-recovery.config.ts tests/support/sales-entry-browser-server.ts` | exit 0 |
| `pnpm.cmd exec tsx scripts/validate-faltantes.ts` | 239 filas, 86 base, 99 adicionales, 24 aceptados, cero errores |
| `git diff --check` | exit 0; avisos de conversión LF/CRLF |

Los cuatro casos de navegador cubren: alta y apertura de revisión sin autoaprobación; mismo payload/clave tras 503; atestaciones duplicadas sin petición; cambio de motivo con clave nueva; UUID inválido sin petición; pérdida de respuesta y reintento con la misma clave; envío único y Escape bloqueado durante petición; reinicio por sucursal y ausencia de desbordamiento horizontal en móvil. Se revisaron visualmente las capturas `.tmp/recovery-create-desktop.png` y `.tmp/recovery-create-mobile.png`. El caso móvil no registró errores de página.

`node --max-old-space-size=4096 ./node_modules/typescript/bin/tsc --noEmit --incremental false`: exit 0 en la corrida final, después de los cambios del formulario. No se ejecuta build global ni se repiten aquí las integraciones externas históricas de POS.

## Límites

La UI requiere referencias de atestaciones ya existentes; no implementa aquí el recorrido de carga/atestación ni un selector documental. Las guardias y verificación documental pertenecen a los servicios existentes. El navegador usa API simulada y componentes/CSS reales, sin DB, sesión real o R2. No se aplica DDL, no se modifica stock ni se despliega. Quedan pendientes dependencias de `INV-01.b`, integración de sesión/R2, aceptación V2/V3 conjunta y carreras con conexiones independientes.

## Preparación del commit

Al solicitarse el commit se ejecutó `pnpm.cmd run build`: Turbopack compiló correctamente en 84 s, pero el worker de TypeScript agotó el heap de aproximadamente 2 GiB (`JavaScript heap out of memory`, worker exit 134). No acredita build completo. El typecheck independiente con `--max-old-space-size=4096` registrado arriba sí terminó con exit 0. El commit incluye las rutas y el diálogo de recovery previamente locales, necesarios para que la nueva captura sea funcional; conserva fuera los cambios de otros dominios. En el checklist se prepara únicamente la nota de esta continuación.
