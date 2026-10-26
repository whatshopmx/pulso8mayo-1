# AGU-03A — Fecha civil, retención y neto compartidos

2026-10-23. Continuación del consolidado sobre HEAD `bf2c386`, con FIS/AGU/IMSS locales conservados. Incrementos: A.1 (4 archivos de código/test) y A.2 (5 archivos). No se modificaron las bases compartidas, migraciones ni el proveedor fiscal real.

## Resultado

- El contrato puro `aguinaldo-payment.ts` valida `YYYY-MM-DD` sin coerción ni normalización de días imposibles. El año causado conserva el período de la percepción; la tarifa ISR y la UMA se resuelven por la fecha de pago. El valor inicial usa la fecha civil de `America/Mexico_City`, independiente de la zona del servidor.
- La preview devuelve `fechaPago`, `pago` por empleado (retención, deducciones, neto) y totales. El servidor valida la tarifa incluso con importe cero. Los bloqueos quedan visibles por empleado y sus importes no entran en totales de timbrables.
- Antes de crear un run, el servicio rechaza empleados bloqueados, RFC faltante o plantilla vacía. El bloqueo de acumulados mensuales de AGU-02C se conserva y ahora ocurre antes de crear run/payslip. No se autoriza ni timbra una regularización de subsidio.
- El timbrador simulado y el payslip reciben el mismo bruto y deducciones del preflight. No se recalculan con otro reloj. El neto se deriva de esos importes; todavía no se introduce un snapshot persistente de autorización.
- GET acepta la fecha civil; POST EXECUTE la exige. Empresa y actor provienen de la sesión; fechas imposibles y bloqueos de cálculo responden 400. La bitácora manual conserva su acción separada.
- La UI muestra fecha de pago, ISR y neto por fila y totales. Editar días usa el mismo cálculo puro y conserva cero en ambas bases. Los bloqueos fiscales pueden desaparecer al corregir días; nunca muestran un neto autorizado mientras sigan bloqueados. Cambiar fecha/año/sucursal invalida la preview, cancela la lectura anterior y bloquea ejecución mientras carga.

## Oráculo de enero independiente

Aguinaldo causado 2025 y pagado el 31-ene-2026, SD 600, 365 días: bruto 900000; exento `30 × 11314 = 339420`; gravado 560580; hipotético `round(560580 × 304 / 3650) = 46689`. Desde la tarifa mensual: ordinario 200772, combinado 210744. Retención `round(560580 × (210744 − 200772) / 46689) = 119731`; neto 780269. El primer valor escrito en el test tenía un error de redondeo de un centavo: se corrigió después de repetir estas operaciones sin importar el código productivo.

El caso de diciembre conserva bruto 900000, exento 351930, gravado 548070, retención 117065 y neto 782935. Exento 225000 y cero manual retienen cero. Fuentes fiscales y alcance de la interpretación: [AGU-02C](../AGU-02C/README.md), [FIS-01](../FIS-01/README.md).

## Verificación

- RED del servicio: 6 fallos / 14 aprobadas, antes de conectar fecha y preflight; incluye las dos regresiones de subsidio que antes creaban run/payslip ERROR.
- Contrato puro: 16/16. Servicio después del primer incremento: 20/20; prueba adicional de RFC en suite final.
- API real con sesión/servicio simulados: 11/11; fechas, propagación, aislamiento de empresa/actor y rechazos 401/403. No acredita RLS ni concurrencia DB.
- Chromium: 2/2, componente real y API simulada. Se comprobó diciembre→enero, ISR/neto y fecha del POST; cero editado; bloqueo por subsidio corregible; error de fuente sin preview ejecutable; foco del campo y anchos 320/768/1024/1440. [Captura](browser-desktop.png).
- Se corrigió una duplicación de React del harness Vite con `dedupe` y preoptimización de Radix; los fallos iniciales de ese harness no se cuentan como reproducción de un defecto del producto.
- Hook de diseño: tamaños de 10/11 px sustituidos por el paso `text-xs` definido en DESIGN.md. Sidecar revisado y refrescado conservando DESIGN.md. Los archivos de marca no intervienen en los cálculos.
- Lint focalizado: sin errores.
- Cierre final del conjunto (2026-10-23, HEAD base bf2c386 + locales): focalizadas AGU 48/48 exit 0; suite completa `pnpm test:unit` 163 archivos / 2004 passed, 1 skipped, 1 todo, exit 0; `pnpm lint` 0 errores (2468 warnings preexistentes); `pnpm build` con TypeScript exit 0 (heap 6144 MB solo en el proceso). Con estos exits, A queda cerrado localmente.

## Límites y siguiente incremento

AGU-03 padre sigue abierto: A no persiste autorización/snapshot ni hace recuperable una corrida parcial. La guarda actual rechaza un run ya existente; AGU-03B debe conservar fecha e importes autorizados, reutilizar timbre confirmado y evitar duplicar payslip/bitácora. AGU-03C conserva la aceptación con DB aislada, concurrencia, dos empresas y fallo/reintento. La fecha civil inicial corresponde al flujo mexicano actual; no representa una configuración de zona por sucursal.

El uso de la palabra dispersión en el flujo existente no acredita liquidación ni conciliación bancaria; AGU-04 mantiene esa revisión. No hay despliegue, env modificado, timbres reales ni envíos a personas. Cambios locales sin commit para preservar la separación de avances preexistentes que comparten archivos.
