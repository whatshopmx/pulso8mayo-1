# AGU-02C — Tasa Art. 174 y subsidio del mes por separado

2026-10-23. Continuación de [AGU-02A/B](../AGU-02/README.md), HEAD base `bf2c386`, con sus cambios locales y los de FIS/IMSS conservados. Alcance: cálculo puro y protección del consumidor existente, cinco archivos de código/test separados en C.1/C.2. Sin migraciones, seed operativo, timbres reales ni despliegue.

## Criterio y alcance

El [Art. 174 RLISR, fracciones I–V](https://wwwmatnp.sat.gob.mx/articulo/46306/articulo-174) establece la mensualización, diferencia de impuestos y tasa sobre la remuneración. El [decreto DOF 31-dic-2025, Artículo Segundo](https://sidof.segob.gob.mx/notas/docFuente/5777649) fija elegibilidad por ingresos gravados del mes de calendario y crédito contra el ISR de ese mes. El [decreto original DOF 01-may-2024, Artículo Segundo](https://sidof.segob.gob.mx/notas/docFuente/5725287) conserva el límite al impuesto a cargo y prohíbe entregar o trasladar el excedente a un impuesto posterior. Fuentes reconsultadas el 23-oct-2026; porcentajes y tarifa publicados conservados de FIS-01.

**Interpretación implementada:** determinar la tasa Art. 174 con los impuestos de tarifa antes del subsidio; después acreditar el beneficio mensual una sola vez contra el impuesto del mes. La elegibilidad considera el aguinaldo gravado real, no su equivalente hipotético. Esto es la composición del contrato del calculador a partir de esas fuentes, no una resolución particular del SAT. No se utiliza como regla vigente el instructivo CDMX de 2019 ni una calculadora externa.

El cálculo puro compara un **mes completo compuesto solo por el ordinario informado y este aguinaldo**, con el ordinario calculado mediante Art. 96 como línea base. No consulta qué subsidio ya se timbró ni supone que un dato calculado sea evidencia de una retención real. Otros pagos, anticipos, pluralidad de empleadores, periodicidades y acumulados efectivos requieren el snapshot/conciliación mensual de AGU-03/NOM. No es un ajuste anual.

## Contrato de cálculo

1. Hipotético = round(gravado / 365 × 30.4). Obtener ISR de tarifa sobre ordinario+hipotético y ordinario, sin subsidio en esa diferencia. Nominal Art. 174 = round(gravado × diferencia / hipotético), o cero si hipotético=0.
2. Ingreso gravado real del mes = ordinario+gravado; determina el subsidio causado mensual (tope inclusivo 11492.66). El bruto exento no entra en esa suma.
3. Aplicar el subsidio mensual al ISR ordinario primero; solo el remanente puede cubrir el nominal del aguinaldo. `subsidioAplicadoCents` ahora representa ese crédito efectivamente atribuible al aguinaldo. `retencionCents` es nominal menos ese crédito.
4. Separar `ajusteSubsidioCausadoCents` (diferencia de subsidio causado ordinario→mes real) de `ajusteIsrOrdinarioCents` (beneficio de ISR ordinario que se debe regularizar). Si el ISR ordinario es menor al subsidio, esos dos importes son distintos. Ninguno entra en la tasa ni se multiplica por 365/30.4.
5. `totalRetencionAdicionalCents` suma retención del aguinaldo y ajuste del ISR ordinario. Es una comparación mensual matemática, no autorización de descontarla del aguinaldo ni monto confirmado en un CFDI. Incluso con gravado 0.01 puede haber ajuste mensual mayor que ese pago; no se inventa un tope para ocultarlo.

Los campos `impuestoOrdinarioCents` e `impuestoConRemuneracionCents` devuelven ahora impuesto de tarifa **antes** del subsidio; el tipo y sus comentarios deben declarar ese cambio.

## Integración protegida

La retención sin coordinación mensual sigue al consumidor existente. Si el cálculo requiere regularizar subsidio causado o acreditar un remanente mensual al aguinaldo, el consumidor devuelve un error por empleado solicitando **acumulados mensuales**, antes de llamar al timbrador. No aplica una deducción aislada 002 para fingir que la regularización quedó resuelta.

La [FAQ del visor SAT, versión 2021, preguntas 27/29](https://www.sat.gob.mx/cs/Satellite?blobcol=urldata&blobkey=id&blobtable=MungoBlobs&blobwhere=1461175070362&ssbinary=true) describe la disminución mensual del subsidio causado y las inconsistencias por ajustes superiores al inicial. Se usa solo como respaldo histórico de la necesidad de conciliar comprobantes; no acredita el mapeo CFDI ni las reglas 2026. Acumulados reales, claves CFDI, autorización y recuperación de corrida parcial siguen en AGU-03. Este incremento no habilita el timbrado del ajuste mensual.

## Oráculos y validación

Importes en pesos. Los 15 fixtures de subsidio no importan constantes ni funciones de producción; un autor independiente de pruebas preparó los primeros 14 antes de modificar el calculador.

| Caso | Nominal Art. 174 | Crédito al aguinaldo | Ajuste ISR ordinario | Retención adicional comparada |
|---|---:|---:|---:|---:|
| Ordinario 11492.66 / gravado 1200, diciembre | 130.51 | 0 | 535.65 | 666.16 |
| Ordinario 11492.67 / gravado 1200 | 130.51 | 0 | 0 | 130.51 |
| Ordinario 11492.66 / gravado 0.01 | 0 | 0 | 535.65 | 535.65 |
| Ordinario 10000 / gravado 3650, enero | 397.06 | 0 | 536.21 | 933.27 |
| Mismo caso en febrero | 397.06 | 0 | 535.65 | 932.71 |
| Ordinario 6500 / gravado 1500, diciembre | 95.93 | 95.93 | 0 | 0 |
| Ordinario 7000 / gravado 4000, febrero | 344.47 | 125.48 | 0 | 218.99 |
| Ordinario 5000 / gravado 7000, diciembre | 447.97 | 0 | 282.17 | 730.14 |

Regresión principal: hipotético 99.95; ISR tarifa ordinario 891.42, combinado 902.29; diferencia 10.87. Nominal = round(1200 × 10.87 / 99.95) = 130.51. El ajuste 535.65 se cuenta una sola vez, fuera de la tasa. La comparación mensual es 891.42 + 130.51 − (891.42 − 535.65) = 666.16. No es el cálculo anterior de 6561.52.

Crédito parcial: ordinario 7000 → ISR 410.17; hipotético 333.15 → ISR combinado 438.86; nominal round(4000 × 28.69 / 333.15) = 344.47. Subsidio febrero 535.65: remanente 125.48, retención del aguinaldo 218.99. El crédito total es 410.17+125.48=535.65, sin duplicarlo.

La batería incluye el tope real y sus dos centavos vecinos; pérdida del subsidio aunque el hipotético no cruce; cruce del hipotético; exento/cero; enero/febrero; crédito total/parcial/nulo; retiro del causado distinto del ISR efectivamente reducido. El consumidor tiene regresiones con SD 350 (pérdida por total real, sin cruce hipotético) y SD 250 (crédito remanente): no llama al proveedor y conserva `cfdiStatus=ERROR`, nunca lo presenta como timbrado. Siguen pasando los casos sin coordinación mensual de AGU-02B y el cero manual de AGU-01.

Resultados observados hasta ahora:

- RED puro: `red-pure.log`, 17 fallos / 35 aprobadas, exit 1.
- RED consumidor: `red-consumer.log`, 2 fallos / 14 aprobadas, exit 1.
- GREEN focalizadas antes del último fixture: `focused.log`, 85/85, exit 0.
- Lint de los cinco archivos: `lint.log` / `lint.json`, exit 0 sin advertencias.
- Suite completa original: `unit.log` / `unit.json`, 161 archivos, 1972 passed, 1 skipped y 1 todo preexistentes, exit 0.
- El build original falló al descargar Geist/Geist Mono; la reanudación con acceso de red (`build-resume.log` / `build-resume.json`) terminó con TypeScript y exit 0. Hubo edición de AGU-03A durante esa reanudación: ese build es evidencia intermedia, no una captura inmutable de AGU-02C. El build final del conjunto se registra en [AGU-03A](../AGU-03A/README.md).

Continuación AGU-03A: el bloqueo del consumidor se adelantó al preflight, antes de crear run/payslip. Las regresiones ahora exigen cero escrituras, en lugar de un payslip ERROR; el cálculo puro y su criterio no cambiaron. El conjunto (AGU-02C + A.1 + A.2) quedó verificado unos contra otros con las salidas finales registradas en [AGU-03A](../AGU-03A/README.md): focalizadas 48/48, suite 163 archivos / 2004 passed exit 0, lint 0 errores y build con TypeScript exit 0. Cierre local del incremento; sin despliegue.

No se ha repetido la validación independiente de TypeScript: el build ejecuta su revisión completa. Los JSON finales registran comando, inicio, fin y exit. No se modificó `.env`, configuración de TypeScript, flags de validación ni fuentes; heap de build 6144 MB solo en el proceso.
