# Seed de demostración

El seed completo está alineado con el esquema actual y se ejecuta en 16 fases.
Está destinado a una **base dedicada de demostración**: reinicia los datos de
la aplicación, incluidas credenciales y sesiones. No aplica migraciones.

```powershell
pnpm seed --reset
```

Requiere `DATABASE_URL` de la base demo y el esquema migrado. Rechaza
`NODE_ENV=production`, empresas distintas a Pulso HORECA Demo y usuarios ajenos.
Comprueba las columnas antes de borrar y aborta si falta una migración.
El reinicio usa exclusivamente las tablas declaradas en Drizzle; no enumera
y borra indiscriminadamente todas las tablas públicas. Un fallo posterior puede
dejar una carga parcial: corrige el error y vuelve a ejecutar el seed completo.

Los comandos `pnpm seed:1 --reset` a `pnpm seed:16 --reset` ejecutan realmente
la fase indicada. Se destinan a diagnóstico, respetando sus dependencias; las
fases nuevas 14 y 15 agregan escenarios y no deben repetirse por separado sobre
un demo ya cargado. Para refrescar todos los datos utiliza el comando completo.
`pnpm seed:pass --reset` restaura sólo las credenciales del demo.

## Cobertura

| Fases | Datos |
| --- | --- |
| 1–3 | Empresa, sucursales, usuarios, RH, proveedores, cuentas cifradas, equipos |
| 4 | Insumos clasificados por almacenamiento, SKUs de alto valor, conversiones fraccionarias, recetas y subrecetas |
| 5 | Librería actual, programaciones por clave estable, pasos dinámicos resueltos y congelados, asignaciones y revisión |
| 6–10 | Turnos, asistencia, incidencias, cumplimiento, evaluaciones, comunicaciones e historial WhatsApp |
| 11 | OC/OS, presupuestos y autorizaciones; totales derivados del detalle |
| 12 | Ventas, cortes, IVA, agregadores y lotes TPV con fecha de negocio de CDMX |
| 13 | Recepción trazada por lote, lecturas térmicas, OC cerrada, factura conciliada y discrepancia verificables; gastos y caja chica |
| 14 | Planes y órdenes de producción, descuento FEFO real, ingredientes fraccionarios, conteos y snapshots calculados por el servicio actual, versiones de recetas |
| 15 | Arqueo con faltante para revisar, propinas, nómina en borrador, tarifas de comisión por grupo/sucursal, liquidación de agregador, corrida pendiente y P&L calculado |
| 16 | Tiers y suscripción Executive, playbooks publicados/versionados, plan NOM-035 y excepciones generadas por los nueve adaptadores actuales |

No se fabrican pagos bancarios, timbrados fiscales ni resultados de IA. Las
cuentas bancarias son sintéticas. Los historiales de WhatsApp y evidencias son
datos de demostración. La proyección de excepciones conserva eventos locales
marcados como procesados, sin enviarlos a Inngest ni disparar automatizaciones.
Los gemelos y briefs se generan mediante sus flujos normales; no se insertan
cachés arbitrarias de motores.

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
pnpm run test:unit tests/unit/seed-integration.test.ts tests/unit/seed-safety.test.ts
```

La prueba crea Postgres en memoria con PGlite a partir del esquema Drizzle,
ejecuta las 16 fases dos veces con reinicio, verifica las relaciones principales,
la conciliación por el servicio real, credenciales y adaptación idempotente de
excepciones. También comprueba que una base con otro tenant o una columna
faltante se rechaza antes de borrar. No conecta a Neon.
