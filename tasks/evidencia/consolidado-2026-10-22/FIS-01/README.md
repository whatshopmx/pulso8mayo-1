# FIS-01 — Oráculos fiscales por fecha y zona

Verificación de fuentes: 2026-10-22. Montos de fixtures en centavos enteros; redondeo monetario al centavo más cercano, después de cada cálculo de impuesto mensual. No se importan constantes de producción en el oráculo `tests/fixtures/fiscal-2026.ts`.

## Fuentes oficiales y vigencia

| Parámetro | Valor en pesos / vigencia | Fuente |
|---|---|---|
| Mínimo general / ZLFN 2025 | 278.80 / 419.88; 01-ene a 31-dic-2025 | [CONASAMI, resolución DOF 19-dic-2024](https://sidof.segob.gob.mx/notas/docFuente/5745678) |
| Mínimo general / ZLFN 2026 | 315.04 / 440.87; 01-ene a 31-dic-2026 | [CONASAMI, resolución DOF 09-dic-2025](https://sidof.segob.gob.mx/notas/docFuente/5775534) |
| UMA 2025 | Diaria 113.14; mensual 3439.46; desde 01-feb-2025, cubre enero 2026 | [INEGI, 09-ene-2025](https://www.inegi.org.mx/contenidos/saladeprensa/boletines/2025/uma/uma2025.pdf) |
| UMA 2026 | Diaria 117.31; mensual 3566.22; desde 01-feb-2026 | [INEGI, 08-ene-2026](https://www.inegi.org.mx/contenidos/saladeprensa/boletines/2026/uma/uma2026.pdf) |
| ISR mensual 2026 | Apartado B.V, 11 tramos, artículos 96 LISR y 175 RLISR | [SAT, Anexo 8 RMF 2026, DOF 28-dic-2025](https://www.sat.gob.mx/minisitio/NormatividadRMFyRGCE/documentos2026/rmf/anexos/Anexo-8-RMF-2026_DOF-28122025.pdf) |
| Subsidio 2026 | Tope mensual 11492.66 inclusive; enero 15.59% de UMA mensual anterior; después 15.02% de UMA mensual vigente | [Decreto DOF 31-dic-2025, artículo único y transitorio segundo](https://sidof.segob.gob.mx/notas/docFuente/5777649) |
| Exención / retención | Exención previa; procedimiento mensual opcional, distinto del ajuste anual | [RLISR 151](https://wwwmat.sat.gob.mx/articulo/06527/articulo-151), [RLISR 174](https://wwwmatnp.sat.gob.mx/articulo/46306/articulo-174) |

No derivar UMA mensual multiplicando diaria por 30.4: usar la cifra mensual publicada. Enero: 3439.46 × 0.1559 = 536.211814 → **536.21**. Febrero: 3566.22 × 0.1502 = 535.646244 → **535.65**. El monto 536.22 del considerando del decreto no reemplaza la fórmula de su parte dispositiva.

Mínimo es GENERAL o ZLFN, no se asigna frontera por estado completo. Una zona desconocida carece de resultado. La tabla laboral actual solo tiene un campo de mínimo; FIS-03 debe resolver zona explícita sin confundirlo con el general.

## Cálculos independientes

Art. 96, importes en pesos:

- Base 3000: 16.22 + (3000 − 844.60) × 6.40% = 154.1656 → 154.17; neto 0 tras subsidio.
- Base 10000: 420.95 + (10000 − 7168.52) × 10.88% = 729.015024 → 729.02; neto enero 192.81, febrero 193.37.
- Base 11492.66: 420.95 + (11492.66 − 7168.52) × 10.88% = 891.416432 → 891.42; neto 355.77. Un centavo adicional conserva impuesto redondeado pero elimina subsidio: neto 891.42.
- Base 15000: 1339.14 + (15000 − 14644.65) × 17.92% = 1402.81872 → 1402.82.

Aguinaldo diciembre 2026: cap 30 × 117.31 = **3519.30**. Bruto 2250 es totalmente exento aunque el SD ordinario sea 600: ISR extraordinario esperado **0**. Bruto 9000: exento 3519.30, gravado **5480.70**; la retención Art. 174 debe usar ese gravado. El procedimiento y sus redondeos se prueban al implementar AGU-02; estas pruebas de FIS-01 fijan la separación bruto/exento/gravado.

## Revalidación laboral original

[Decreto DOF 01-may-2026](https://sidof.segob.gob.mx/notas/docFuente/5786537): entrada en vigor ese día; transitorios segundo/cuarto: ordinaria 48/46/44/42/40 y extra 9/9/10/11/12 en 2026–2030. Se conserva esa secuencia. La reforma del art. 68 agrega límite de cuatro horas extraordinarias adicionales y doce horas totales al día; no convertir triple en autorización de infringir topes. El registro electrónico tiene disposiciones desde 01-ene-2027 y ámbito/excepciones por definir, separado de readiness.

## Límites del incremento

Los fixtures terminan en sus vigencias publicadas. Años de tarifa 2025/2027/2031 son **no soportados** por el módulo ISR actual; `unsupportedTaxYears` es el contrato de regresión de AGU-02, aún pendiente de conectar. UMA 2026 cubre hasta enero de 2027 por su ciclo anual; febrero de 2027 es desconocido. Un dato desconocido debe bloquear el cálculo exigible, sin heredar tarifa/minimum/UMA; la aceptación productiva de ese bloqueo corresponde a FIS-02 y AGU-02.

FIS-01 no acredita corrección del seed, caché, retención ni timbrado: la semilla aún contiene valores desfasados y AGU-02 aún usa el bruto. No ejecutar seed en base operativa. `fiscal-fixtures.test.ts` valida Art. 96, exención y límites del selector con estos oráculos, sin DB. Tarifa anual exportada no implica ajuste anual implementado.

Verificación: las 17 pruebas nuevas de este archivo pasan junto con las 11 de AGU-01 (28/28, exit 0) en `../CHECKPOINT-01/focused.log`. `unit.log` conserva el primer borrador: cuatro fallos por dos operaciones aritméticas mal transcritas en el fixture, corregidas antes de la validación final. La suite completa y controles generales se registran en [CHECKPOINT-01](../CHECKPOINT-01/README.md).
