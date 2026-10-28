# Contrato de días computables de aguinaldo — DIA-01

Versión 1. Fecha de revisión: 2026-10-26. Implementación pura: `lib/services/aguinaldo-days-policy.ts`. El adaptador de fuentes reales y su conexión a la preview están en `lib/services/aguinaldo-days-adapter.ts` y `lib/services/aguinaldo-payroll-service.ts` (DIA-02A/B/C, 2026-10-28); la aceptación V2 con Postgres aislado y dos empresas reales sigue en DIA-02D.

## Fuente y reglas aplicables

La [LFT, artículo 87](https://www.ordenjuridico.gob.mx/Documentos/Federal/html/wo125151.html) reconoce el aguinaldo anual y su proporción por tiempo trabajado. La [guía de PROFEDET](https://www.profedet.gob.mx/profedet/prensa/preguntas_aguinaldo.html) incluye vacaciones, descansos semanales, maternidad, paternidad y riesgo de trabajo para el cómputo. La [aclaración STPS/PROFEDET](https://www.profedet.gob.mx/profedet/prensa/vence-plazo-aguinaldos.html) distingue faltas injustificadas y enfermedad general, salvo mejor condición contractual. Fuentes reconsultadas el 26-oct-2026.

La decisión de aplicación es partir del calendario de vigencia laboral y descontar únicamente la unión de ausencias aprobadas con tratamiento NO_COMPUTABLE explícito. La falta de checadas no prueba una falta. Descansos/festivos y períodos computables permanecen en el calendario aunque no produzcan un turno COMPLETED.

Un permiso sin goce no debe descontarse sólo por un nombre libre del catálogo. Maternidad, paternidad y riesgo de trabajo requieren conservar el tratamiento protegido incluso si un dato de pago es incorrecto. Una mejor condición contractual puede conservar enfermedad general como computable. El adaptador debe justificar la clasificación; si no puede hacerlo, entrega REVISAR y requiere resolución manual antes de ejecutar.

## Entrada y salida

- Año causado separado de fecha de pago. Período civil inclusivo: máximo de 1-ene/antigüedad y mínimo de 31-dic/baja, cuando corresponda. La fecha de antigüedad ya prioriza seniorityDate sobre hireDate en el consumidor actual.
- Fecha de corte y zona IANA explícitas. El corte indica hasta cuándo se consultaron fuentes, sin convertir días posteriores en faltas. Si el período termina después del corte, se declara proyección anual.
- Fechas de ausencias civiles válidas, ID de origen, aprobación y tratamiento COMPUTABLE, NO_COMPUTABLE o REVISAR. Rangos fuera de vigencia no alteran el resultado. Rangos e identidades inválidos se rechazan.
- Turnos: evidencia de actividad, nunca denominador de cobertura. Varias checadas del mismo día no duplican días. Un turno nocturno se asignará al día local de inicio, sin descontar el siguiente por no tener inicio de turno.
- Salida: versión, período, corte/zona, calendario, días no computables únicos, propuesta, valor usado, fuente, días con turno, pendientes/conflictos y estado de revisión. Cobertura de fuentes PARCIAL: ninguna colección de checadas acredita por sí sola cobertura completa.
- Ajuste manual entero 0..366 prevalece, incluido cero. No elimina las incidencias pendientes de la evidencia. La autorización/actor y el snapshot del consumidor conservarán su procedencia en DIA-02/AGU-04.
- Un día protegido que coincide con una exclusión se mantiene computable y se señala como conflicto. Sin override manual, un conflicto o clasificación pendiente exige revisión; no se entrega como conteo definitivo autorizado.

El contrato cuenta días civiles. No modifica la fórmula monetaria de prorrateo, salario, tarifa ISR ni UMA. El motor monetario existente usa DIAS_PRORRATEO=365; la diferencia de un año bisiesto se hace visible como 366 días y no se oculta cambiando el calendario de este contrato.

## Fuentes del repositorio y brechas del adaptador

| Fuente real | Uso y límite |
|---|---|
| users + employee_profiles | Empresa, sucursal, antigüedad y estado. La consulta actual del aguinaldo sólo incluye activos; no prometer liquidación de bajas por este contrato. |
| employee_contracts | Salario y contrato activo; no acredita cobertura anual de asistencia. |
| branches.timezone | Conversión explícita de instantes de turno al día local. No usar la zona del servidor. La ausencia de zona válida debe ser visible y resuelta por el consumidor. |
| shift_sessions(COMPLETED) | Evidencia observada. Agrupar por día local, unir duplicados y acotar a vigencia; un turno aislado no autoriza restar los demás días. |
| leave_requests(APPROVED/COMPLETED) + leave_types | Rangos/empresa/actor de aprobación. isPaid y name no equivalen por sí solos a clasificación jurídica completa. Una solicitud o tipo ajeno no puede influir en la empresa consultada. |
| vacation_requests | Fuente separada existente de vacaciones aprobadas. Se conserva el calendario; no exigir una checada para computar vacaciones ni duplicarlas si también aparecen en permisos. |
| Faltas/incapacidades y política aplicable | Sólo deducir con fuente/estado/tratamiento verificables; no generar ausencias sintéticas desde días sin turno. Si el catálogo no permite clasificar, revisión/override explícito. |

Los rangos civiles capturados en solicitudes se leen como fechas civiles, sin convertir una medianoche codificada en UTC al día anterior. Los turnos sí representan instantes y necesitan zona. DIA-02 debe comprobar ambas semánticas con consultas reales y fuentes de captura; no se aplica una misma conversión ciega a ambas.

## Oráculos independientes de días

| Caso | Calendario | Exclusiones únicas | Propuesta |
|---|---:|---:|---:|
| Activo todo 2026, sólo un turno capturado | 365 | 0 | 365 |
| Año completo con descansos, festivos, vacaciones y maternidad | 365 | 0 | 365 |
| Alta 1-jul-2026; permisos no computables 29-jun–3-jul y 2–4-jul | 184 | 4 | 180 |
| Falta pendiente, no aprobada | 365 | 0 | 365 |
| Incapacidad sin clasificar, sin override | 365 | 0 | 365, requiere revisión |
| Igual caso con manual 0 / manual 200 | 365 | 0 | Se usan 0 / 200; pendiente conservado |
| Licencia protegida y falta coinciden el 1-may | 365 | 0 | 365, conflicto visible |
| Baja efectiva 30-jun-2026 | 181 | 0 | 181 |
| Todo 2024 | 366 | 0 | 366 días civiles |

V1: `pnpm.cmd run test:unit tests/unit/aguinaldo-days-policy.test.ts`, 12/12. Fechas imposibles, zona desconocida y manual negativo/fraccionario se rechazan. DIA-02A/B/C conectan las fuentes reales y la preview con clasificación explícita, cruce sin duplicar y overrides no precargados (14/14 adaptador, 5/5 navegador). DIA-02D conserva V2 para consultas reales en Postgres aislado, dos empresas y preview→run; AGU-04 conserva la aceptación del recorrido completo.
