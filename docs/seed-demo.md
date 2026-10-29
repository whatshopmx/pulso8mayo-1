# Seed de demostración

El seed completo se ejecuta en 20 fases sobre el esquema actual.
Está destinado a una **base dedicada de demostración**: reinicia los datos de
la aplicación, incluidas credenciales y sesiones. No aplica migraciones.

```powershell
pnpm seed --reset
```

Requiere `DATABASE_URL` de la base demo, el esquema migrado y el rol de
mantenimiento/dueño. El rol runtime con RLS no sirve para reiniciar el demo:
se comprueban los permisos y el bypass de las tablas protegidas antes del borrado.
No desactiva RLS ni modifica sus políticas. Rechaza
`NODE_ENV=production`, empresas distintas a Pulso HORECA Demo y usuarios ajenos.
Comprueba las columnas antes de borrar y aborta si falta una migración.
El reinicio usa exclusivamente las tablas declaradas en Drizzle; no enumera
y borra indiscriminadamente todas las tablas públicas. Un fallo posterior puede
dejar una carga parcial: corrige el error y vuelve a ejecutar el seed completo.

Los comandos `pnpm seed:1 --reset` a `pnpm seed:20 --reset` ejecutan realmente
la fase indicada. Se destinan a diagnóstico, respetando sus dependencias; las
fases 14 y 15 agregan escenarios y no deben repetirse por separado sobre
un demo ya cargado. Para refrescar todos los datos utiliza el comando completo.
`pnpm seed:pass --reset` restaura sólo las credenciales del demo.

## Cobertura

| Fases | Datos |
| --- | --- |
| 1–3 | Empresa, sucursales, usuarios, RH, proveedores, cuentas cifradas, equipos |
| 4 | Insumos clasificados por almacenamiento, SKUs de alto valor, conversiones fraccionarias, recetas y subrecetas |
| 5 | Librería actual, programaciones por clave estable, pasos dinámicos resueltos y congelados, asignaciones y revisión |
| 6–10 | Turnos, asistencia, incidencias, cumplimiento, evaluaciones, comunicaciones e historial WhatsApp; solicitudes y objetivos relativos al día civil de CDMX |
| 11 | OC/OS, presupuestos y autorizaciones; totales derivados del detalle |
| 12 | Ventas, cortes, IVA, agregadores y lotes TPV con fecha de negocio de CDMX |
| 13 | Recepción trazada por lote, lecturas térmicas, OC cerrada, factura conciliada y discrepancia verificables; gastos y caja chica |
| 14 | Planes y órdenes de producción, descuento FEFO real, ingredientes fraccionarios, conteos y snapshots calculados por el servicio actual, versiones de recetas |
| 15 | Arqueo con faltante para revisar, propinas, nómina en borrador, tarifas de comisión por grupo/sucursal, liquidación de agregador, corrida pendiente y P&L calculado |
| 16 | Tiers y suscripción Executive, playbooks publicados/versionados, plan NOM-035 y excepciones generadas por los nueve adaptadores actuales |
| 17 | Catálogo global de reglas laborales, idempotente |
| 18 | Cuentas bancarias propias cifradas, estado de cuenta sintético, gateway TPV, obligaciones recurrentes por el servicio real y preparación fiscal ordinaria pendiente |
| 19 | Evidencia canónica derivada de pasos de workflow y escenarios de protección civil |
| 20 | Aguinaldo en borrador con cálculo, retención y propuesta de días del servicio actual; snapshots conservados y mediciones KPI derivadas de fuentes actuales |

No se fabrican pagos bancarios, timbrados fiscales ni resultados de IA. Las
cuentas bancarias son sintéticas. Los historiales de WhatsApp y evidencias son
datos de demostración. La proyección de excepciones conserva eventos locales
marcados como procesados, sin enviarlos a Inngest ni disparar automatizaciones.
Los gemelos y briefs se generan mediante sus flujos normales; no se insertan
cachés arbitrarias de motores.

## Coherencia y repetición

- La nómina ordinaria conserva el estado `DRAFT`. Sus recibos se calculan con
  `calculateEmployeePayroll`: contrato, propinas y festivos según el motor
  vigente. Ese motor actualmente devuelve cero en horas extra; el seed no
  inventa un cálculo distinto. Las preparaciones fiscales quedan `PENDIENTE`,
  sin UUID, sello ni fecha de timbrado, y usan el período completo del recibo.
- El aguinaldo usa `previsualizarAguinaldo` y `crearSnapshotAguinaldo`. Incluye
  permisos aprobados por enfermedad general y sin goce, solicitudes pendientes
  y vacaciones. La propuesta audita las fuentes y conserva proyecciones,
  pendientes y conflictos; no convierte días sin checada en faltas.
  Si un empleado queda bloqueado (por ejemplo, por acumulados de subsidio
  pendientes de conciliar), su motivo se conserva en la preview y se imprime
  durante la carga; no se fabrica un recibo calculado para ese empleado.
- El snapshot de aguinaldo es un ejemplo en `DRAFT`, sin `deliveryVersion`:
  no autoriza iniciar envíos al PAC desde recuperación. No se ejecutan
  `executeAguinaldoRun` ni `recuperarAguinaldoRun` durante el seed.
- Las cantidades pseudoaleatorias tienen secuencias fijas por fase. Cada reset
  reinicia esas secuencias; IDs, hashes y timestamps siguen siendo nuevos.
  Los escenarios de asistencia caen siempre en jornadas existentes, sin perder
  el retardo o las horas extra cuando cambia el día de la semana.
- Los KPI son una foto de las fuentes actuales al final de la carga, calculada
  por `KpiCalculator`; no se simulan treinta días de historia. Se omiten las
  mediciones de cumplimiento laboral, costo laboral y satisfacción mientras
  sus tokens del calculador devuelvan constantes. Las demás métricas conservan
  la semántica actual de ese servicio, incluidas sus limitaciones.
- Los acumulados vacacionales son estimaciones mensuales informativas del año
  actual, con antigüedad y días del calculador de prestaciones; se identifican
  como demo en `notes`. No acreditan saldos autorizados.

El catálogo de festivos de la fase 1 y las vigencias legales conservan sus
fuentes de 2026. El seed no extrapola tarifas fiscales a años sin publicación
en el sistema: un año no soportado debe actualizarse antes de generar aguinaldo.

## Correcciones frente al seed anterior

- Las programaciones usaban posiciones de una librería que creció: algunos
  títulos lanzaban una plantilla distinta. Ahora se resuelven por clave estable.
- Un workflow completado podía contener pasos pendientes o truncarse a ocho
  pasos. Ahora conserva todos los pasos, tiempos, responsable y asignación.
- La conversión KG → LB guardaba `2205` y algunas recetas apuntaban al frijol
  en lugar de la tortilla. Se corrigieron ambos datos.
- La recepción no creaba existencias ni actualizaba la OC, y la factura
  “conciliada” no sumaba lo mismo que sus líneas. Ahora los tres documentos
  comparten ítems y cantidades, y la discrepancia tiene documentos enlazados.
- Evaluaciones y objetivos respetan la sucursal del empleado; la calificación
  decimal se deriva de sus respuestas.
- Varias fases individuales y el comando de contraseñas terminaban sin llamar
  a `main`. Los comandos pasan por un ejecutor común.

## Verificación aislada

```powershell
pnpm exec vitest run --configLoader bundle --maxWorkers=1 tests/unit/seed-integration.test.ts tests/unit/seed-safety.test.ts tests/unit/seed-scenarios.test.ts
```

La prueba crea Postgres en memoria con PGlite a partir del esquema Drizzle,
aplica las migraciones SQL de RLS de evidencia, recepción, monitoreo,
conteos y nómina, y ejecuta las 20 fases dos veces con reinicio. Verifica las relaciones principales,
la conciliación por el servicio real, credenciales y adaptación idempotente de
excepciones. También comprueba que una base con otro tenant o una columna
faltante se rechaza antes de borrar. Comprueba retardos y descansos, aprobaciones
del mismo turno, nómina contra el calculador, aguinaldo contra la preview y
KPI contra sus fuentes. Con un rol `NOBYPASSRLS` comprueba el rechazo del reset,
el aislamiento de nómina y la lectura con contexto transaccional. No conecta a Neon.
