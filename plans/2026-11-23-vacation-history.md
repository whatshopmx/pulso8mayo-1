# NOM-02.c1 — Historia verificable de vacaciones

Base: `b132ead`, con árbol compartido. Continuación del plan de faltantes; implementación incremental. Este documento no acepta NOM-02.c1 ni autoriza migración operativa por inferencia.

## Objetivo y contrato

Reconstruir los días de vacaciones financiados para un período sin depender de saldos mutables posteriores. La misma consulta, con el mismo corte de conocimiento, debe devolver el mismo resultado aunque luego se concedan derechos o cancelen solicitudes. El resultado alimentará los conceptos salariales existentes; no cambia porcentajes ni define derechos legales nuevos.

Supuestos basados en el código actual:

- Se conservan días civiles enteros y rango inclusivo. No se introducen medios días ni se cambia a días laborables.
- Cada crédito declara cantidad y vigencia explícitas, sustentadas por una referencia. No se infiere caducidad legal ni se generan derechos futuros por antigüedad en este incremento.
- Un saldo inicial solo acredita su fecha y cobertura verificadas. No reconstruye períodos anteriores a partir de `days_balance`, `used`, `pending` o `updated_at`.
- El período económico y el corte de conocimiento son ejes distintos. Un evento registrado después del corte no cambia una consulta anterior. La aprobación y cancelación deben venir de historia, no del estado actual de la solicitud.
- El servidor establece empresa, actor y corte de conocimiento. No se aceptan esas autoridades desde el cuerpo HTTP.

## Evidencia de partida

`resolveVacationsForPeriod` consulta `vacation_accruals.days_balance` y usa `leave_balances.balance` como fallback. El filtro por año/periodStart excluye derechos futuros, pero esas columnas no conservan el estado anterior a una modificación. El schema de acumulaciones carece de un historial de consumo. Las rutas `leave/balances` y `leave/requests` escriben saldos por asignación y fuera de una transacción común; la ruta de saldo admite importes del propio usuario. No se debe migrar esos valores automáticamente como historia verificada.

El puente `history.leave` debe cerrar también los escapes actuales: el PATCH genérico de solicitudes aplica el cuerpo sin whitelist de campos ni capacidad de decisión; las transiciones no comparan el estado observado al actualizar y el cambio de saldo ocurre después. Alta y consumo consultan la anualidad del reloj actual, aunque la solicitud pertenezca a otro período. La integración exigirá alcance de empresa/sucursal/propiedad y pertenencia del tipo, días derivados de fechas, transición condicionada y evento/balance atómicos. Mantener estos escritores abiertos invalidaría la fuente histórica nueva.

## Fuente histórica

Una historia por empresa/empleado contiene una cobertura declarada, créditos y decisiones de solicitudes, con identificadores únicos y fecha de registro. Las correcciones serán eventos adicionales, con vínculo al hecho corregido, actor y motivo. La persistencia deberá impedir UPDATE/DELETE del historial y validar empresa/sujeto en base.

El contrato puro recibe una proyección de esos eventos hasta `knownAt`:

- Cobertura: `from`, `through`, `recordedAt`, `sourceReference`. Su ausencia es `MISSING`, no saldo cero. Cero créditos dentro de una cobertura explícita es cero conocido.
- Créditos: ID, días enteros no negativos, `validFrom`, `validThrough`, `recordedAt` y referencia. Una revocación posterior al corte no existe para esa consulta.
- La apertura ya incorpora los consumos anteriores a `coverage.from`; los créditos de la proyección comienzan en esa fecha o después. Un crédito anterior exige reconciliar una apertura verificable y produce conflicto si se intenta introducir íntegro, sin sus consumos previos.
- Solicitudes históricas aprobadas: ID canónico, días civiles, `approvalRecordedAt` y eventual `cancellationRecordedAt`. Estos campos nombran el registro de eventos, no las fechas editables de una solicitud legacy. Cada día se carga una vez. Solicitudes diferentes que reclaman el mismo día son `CONFLICT`, no se deduplican silenciosamente.
- Corte de conocimiento: instante UTC explícito. Un período anterior a la cobertura o posterior a ella queda `MISSING`. No se publican importes sobre cobertura incompleta.

Reconstrucción: procesar todos los días aprobados desde el inicio de cobertura hasta el cierre consultado, en orden civil. Cada día usa el crédito vigente que vence primero, con desempate binario estable por inicio e ID, sin colación dependiente del servidor. Créditos futuros no pagan días anteriores; remanentes vencidos no se arrastran por inferencia. El saldo anterior al período se calcula después de sus consumos previos. Los consumos dentro del período generan días elegibles, no se restan dos veces de un saldo ya neto. Solicitudes futuras no disminuyen retrospectivamente el período actual.

El resultado distingue `AVAILABLE`, `MISSING` y `CONFLICT`; errores de lectura se mapearán a `QUERY_ERROR` en el adaptador SQL. Devuelve días elegibles/no financiados, asignaciones por crédito/solicitud/día, saldo antes del período y remanente al cierre. El lector de nómina conservará procedencia y no declarará falta laboral por ausencia de historia.

## Construcción por incrementos

1. **Contrato:** `vacation-history.ts`, pruebas puras y este documento. Reproducir pérdida de saldo histórico, crédito futuro, doble descuento, vencimiento, cancelación posterior, solapamientos y falta de cobertura. Sin activar la fuente incompleta.
2. **Persistencia:** schema y migración aditiva generada, metadatos separados y pruebas SQL. Historia append-only, referencias de empresa/sujeto y privilegios mínimos. Cobertura verificada separada de datos legacy; no hacer backfill automático.
3. **Escritor:** apertura/créditos con capacidad de administración, motivo/referencia, idempotencia y bloqueo por empleado; aprobaciones/cancelaciones en la misma transacción que sus eventos. Cerrar edición de saldos por el propio beneficiario y resolver el puente de permisos VACATION sin duplicar solicitudes. Versionar la fuente ante correcciones para invalidar borradores.
4. **Lector:** consulta SQL al corte y adaptación del contrato al cálculo de nómina. La fuente activa no cae a saldos mutables. Falta, conflicto o error impiden presentar prima pagada como verificada. Los datos precargados de pruebas deberán declarar su procedencia histórica explícita; no son un bypass del recorrido de producción.
5. **Aceptación:** PostgreSQL con LOGIN independiente, dos empresas, fronteras de sucursal/propiedad, carreras y rollback; Next/Better Auth/navegador para administración y solicitudes; oráculos SQL de nómina antes/después de una corrección. Solo entonces aceptar el historial; el cierre de NOM-02.c1 requiere también permisos y adopción del cálculo.

IDs de ejecución: `NOM-02.c1.history` agrega `contract` → `schema` → `grants` → `decisions` → `leave` → `reader` → `acceptance`. `grants` cubre la administración de apertura/créditos y el cierre de escritura sin capacidad administrativa; `decisions` el vínculo atómico con vacaciones; `leave` el puente VACATION y sus saldos/rutas. No se fusionan tres escritores distintos en un ticket de cinco archivos.

Cada incremento fija hasta aproximadamente cinco archivos de código; metadatos generados y trazabilidad se separan cuando corresponda. Los pasos posteriores siguen abiertos hasta ejecutarse y verificarse.

## Stack, estructura y estilo

TypeScript, Drizzle/PostgreSQL, Zod y Vitest existentes; sin dependencias nuevas. Contrato en `lib/services/`, schema en `lib/db/schema.ts`, SQL generado en `drizzle/`, unitarias en `tests/unit/payroll/`, pruebas nativas en `tests/integration/`, evidencia en `tasks/evidencia/2026-11-23/`.

```ts
const result = resolveVacationHistory({
  periodStart: '2026-05-01', periodEnd: '2026-05-15', knownAt: '2026-05-16T12:00:00.000Z',
  coverage, grants, requests,
});
// AVAILABLE con cero es distinto de MISSING o CONFLICT.
```

## Comandos y verificación

```powershell
pnpm.cmd exec vitest run --configLoader bundle --maxWorkers=1 --pool=threads tests/unit/payroll/vacation-history.test.ts
pnpm.cmd exec eslint lib/services/vacation-history.ts tests/unit/payroll/vacation-history.test.ts
pnpm.cmd db:generate --name nom02c1_vacation_history
pnpm.cmd exec drizzle-kit check
node --use-system-ca node_modules/vitest/vitest.mjs run --configLoader bundle --config vitest.integration.config.ts --maxWorkers=1 --pool=threads tests/integration/vacation-history-db.test.ts
pnpm.cmd run build
pnpm.cmd exec tsx scripts/validate-faltantes.ts
```

El build usa heap 4 GB y certificados del sistema si el entorno lo requiere. Los comandos de migración generan candidatos locales; no aplican SQL operativo. Las pruebas nativas usan únicamente el helper de base desechable en endpoint distinto al operativo y verifican limpieza. V1 cubre aritmética y contratos; V2 persistencia/aislamiento/concurrencia; V3 capacidades, errores visibles y recuperación.

## Límites

Siempre: fechas civiles, centavos, transacciones, actor de sesión, alcance de empresa/sucursal, pruebas RED/GREEN y revisión antes de commit. Preservar cambios locales de terceros. Nunca: inferir historia de un saldo actual, inventar caducidad o derechos, silenciar errores como cero, permitir asignación de derechos sin capacidad administrativa, usar `db:push`, editar credenciales o migrar el entorno operativo sin el lote autorizado.

Pendientes de política: fuente y aprobación de derechos por antigüedad, vigencia/caducidad y criterios de apertura verificada se configurarán con evidencia explícita; este contrato no decide la normativa ni convierte saldos legacy en evidencia. Los snapshots aprobados/timbrado y el cierre de NOM-06 conservan sus propias puertas.
