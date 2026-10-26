# AGU-02 — Base gravada y vigencia de la retención Art. 174

Fecha: 2026-10-23. HEAD de partida `bf2c386`; existen cambios locales previos de FIS-02/FIS-03 e IMSS, conservados. Este incremento modifica cinco archivos de código/test, separados en AGU-02A (calculador, pruebas y fixture) y AGU-02B (adaptación del consumidor y pruebas). Cambios locales sin commit ni despliegue; no se ejecutaron migraciones ni seed operativo. Las pruebas fiscales usan DB/proveedor simulados.

## Comportamiento y fuentes

El contrato del cálculo puro exige `aguinaldoGravadoCents` explícito, no negativo y no mayor al bruto. La tasa se obtiene y aplica sobre esa parte gravada. El importe exento se determina antes, con la UMA vigente, y el consumidor transporta `row.calculo.gravadoCents`. Se conservan bruto/exento en la percepción y la deducción resultante en el CFDI y el payslip. La prueba del consumidor usa DB/proveedor simulados; no acredita timbrado real ni persistencia Postgres.

La tarifa exige coincidencia exacta por año: el catálogo soporta 2026. Los ejercicios 2025/2027/2031, año fraccional y NaN se bloquean incluso cuando el gravado es cero. Centavos fraccionarios, negativos, no finitos o inseguros se rechazan; salario mensual explícito cero prevalece sobre el fallback diario. El hipotético y los impuestos mensuales se redondean al centavo; la tasa se conserva sin redondear para obtener la retención final. Exportar tarifa anual no implementa ajuste anual.

Fuentes consultadas el 23-oct-2026:

- [SAT, Art. 151 RLISR](https://wwwmat.sat.gob.mx/articulo/06527/articulo-151): la gratificación inferior al límite exento conserva exención aun si el salario es superior al mínimo. [SAT, beneficios de salarios](https://wwwmat.sat.gob.mx/consulta/02330/conoce-los-beneficios-del-regimen-de-salarios): 30 UMA del aguinaldo.
- [SAT, Art. 174 RLISR](https://wwwmatnp.sat.gob.mx/articulo/46306/articulo-174): procedimiento opcional de retención mediante remuneración / 365 × 30.4 y diferencia de impuestos mensuales. La aplicación posterior a separar el exento sigue el contrato FIS-01/AGU-02 del proyecto.
- [Anexo 8 RMF 2026, B.V](https://www.sat.gob.mx/minisitio/NormatividadRMFyRGCE/documentos2026/rmf/anexos/Anexo-8-RMF-2026_DOF-28122025.pdf): tarifa mensual. [Decreto DOF 31-dic-2025](https://sidof.segob.gob.mx/notas/docFuente/5777649): tope 11492.66 y porcentajes de subsidio; importes de UMA y sus vigencias documentados en [FIS-01](../FIS-01/README.md).

## Oráculos independientes

Los importes esperados están escritos en `tests/fixtures/fiscal-2026.ts`, sin importar constantes ni funciones de producción.

| Caso, pesos | Operaciones | Retención esperada |
|---|---|---|
| Diciembre, bruto 2250 / SD 600 | Exento 2250, gravado 0; mensual ordinario 18240 | **0** |
| Diciembre, bruto 9000 / SD 600 | Exento 3519.30; gravado 5480.70; hipotético 456.47. ISR ordinario = 1856.84 + (18240 − 17533.65) × 21.36% = 2007.72; ISR combinado = 2105.22; diferencia 97.50. Tasa = 97.50 / 456.47 | round(5480.70 × 97.50 / 456.47) = **1170.65** |
| Enero/febrero, mensual ordinario 10000 / gravado 3650 | Hipotético 304; ISR bruto 729.02 → 762.09. Subsidio enero 536.21: netos 192.81 → 225.88; febrero 535.65: 193.37 → 226.44. Diferencia en ambos: 33.07 | round(3650 × 33.07 / 304) = **397.06** |
| Bruto cero, o gravado 0.01 | Hipotético redondeado 0, sin división por cero | **0** |

El fixture de enero usa exento 3394.20 (30 × UMA diaria 113.14); febrero usa 3519.30. Las pruebas del consumidor incluyen año completo con bruto 9000 y 90 días con bruto 2219.18 / totalmente exento / SD 600.

## Hallazgo pendiente: AGU-02C

La política anterior resta dos impuestos netos, cada uno con su propia elegibilidad de subsidio. Si el ordinario mensual es 11492.66 y el gravado es 1200, el hipotético es 99.95. Ordinario neto = 891.42 − 535.65 = 355.77; combinado sin subsidio = 902.29. Extrapolar la diferencia 546.52 / 99.95 al gravado retendría **6561.52**, superior incluso al bruto 4719.30.

Se bloquea explícitamente cualquier cruce de elegibilidad entre ambos escenarios, sin recortar el resultado ni adoptar otra regla fiscal por inferencia. Un centavo sobre el tope en el ordinario ya deja ambos escenarios sin subsidio y conserva un resultado calculable (130.51 sobre gravado 1200).

Las fuentes consultadas establecen el procedimiento y subsidio mensual, pero no resuelven explícitamente este tratamiento conjunto. El documento oficial histórico de [CDMX para 2019](https://www.transparencia.cdmx.gob.mx/storage/app/uploads/public/5e2/f7a/752/5e2f7a7521435859896260.pdf), localizado durante la investigación, tampoco acredita una regla 2026 para este producto. Hace falta criterio fiscal sustentado y un oráculo para habilitar el cruce. **AGU-02 sigue abierto**; AGU-02A/B no equivalen a completar AGU-03.

## Verificación

- RED puro: `red.log`, exit 1, 22 fallos / 17 aprobadas antes de corregir. Se reemplazaron las expectativas anteriores que gravaban la parte exenta y heredaban tarifa entre ejercicios.
- GREEN puro: `green-pure.log`, 56/56, exit 0.
- RED consumidor: `red-consumer.log`, 5 fallos / 9 aprobadas, exit 1, antes de transportar el gravado.
- Focalizadas: `focused.log`, 70/70, exit 0. El ajuste posterior del bruto del fixture enero y la validación tipada están incluidos en la suite completa final.
- Suite completa: `unit.log` / `unit.json`, **161 archivos / 1956 passed / 1 skipped / 1 todo**, exit 0. No se añadieron omisiones.
- Lint de los cinco archivos: `lint.log` / `lint.json`, exit 0, sin advertencias.
- TypeScript: `types.log` / `types.json`, `pnpm exec tsc --noEmit --incremental false`, exit 0.
- Build: `build.log` / `build.json`, **exit 0**, incluida su validación TypeScript y generación de páginas. El primer intento restringido falló al descargar Geist/Geist Mono de Google Fonts (`build-restricted-failed.*`); reintento autorizado con red, TLS activo y heap de 6144 MB solo en el proceso.
- `git diff --check` de los archivos afectados: exit 0; avisos de conversión LF→CRLF sin errores de whitespace.

Los runners registran comando, inicio, fin y exit en cada JSON. Los logs RED/focalizados fueron capturados por PowerShell; los finales por Node en UTF-8. Los mensajes de fallo de extractores en `unit.log` pertenecen a casos de error/reintento de sus pruebas y la suite termina con exit 0.

El build conserva avisos ya observados en FIS-03: `fetchConnectionCache` deprecado y la ruta de documentos usando `headers()` durante el intento de render estático. Next termina con exit 0; esto no equivale a una consola sin avisos ni valida el módulo de documentos. La revisión del incremento cubrió contrato requerido, validación monetaria, exención, redondeos, fallos, ausencia de efectos nuevos de red/DB en el cálculo puro y preservación del consumidor; los límites fiscales y de recuperación quedan identificados arriba.

AGU-02A/B quedan verificados localmente. AGU-02 padre sigue pendiente por AGU-02C. No se cambiaron archivos del frente bancario/IMSS ni migraciones; los cambios previos se conservan. Este resultado no acredita timbrado real, recuperación de corrida parcial, V2 ni despliegue.

Próximos pasos: resolver AGU-02C; completar AGU-03 con preview de retención, recuperación/idempotencia y V2 en DB aislada. La prueba simulada de AGU-02B no cierra esa aceptación. Continúan pendientes DIA-01/02 y las demás fases del consolidado. El tracker bancario `tasks/plan.md` conserva su alcance BAN/OPS independiente.
