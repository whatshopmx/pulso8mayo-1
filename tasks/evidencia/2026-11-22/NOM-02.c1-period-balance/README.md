# NOM-02.c1 — Corte temporal y ausencia explícita de saldo

Base: `ef061c4f89ac51f5923cc5d425a5f305c55eba51` más árbol local compartido. Incremento de código, sin aceptar NOM-02.c1.

## Cambio

- La nómina excluye acumulaciones de años posteriores al cierre y las que comienzan después del último día del período, incluso dentro del mismo año. El límite SQL incluye microsegundos del último día.
- El fallback de `leave_balances` excluye anualidades futuras y verifica la empresa del tipo de permiso.
- Los datos precargados aplican el mismo corte cuando declaran año/fecha. El contrato legacy de saldo precargado sin año se conserva como entrada del caller referida al período; no acredita reconstrucción histórica.
- Listas precargadas vacías y fuentes exclusivamente futuras producen `MISSING`, mientras una fila con saldo cero sigue siendo `AVAILABLE`. No se confunden ausencia y saldo agotado.
- Se conservan las fórmulas salariales y fiscales existentes.

## Verificación

- RED: seis regresiones nuevas fallaron contra la implementación anterior (6 fallidas y 7 aprobadas).
- GREEN: `pnpm.cmd exec vitest run --configLoader bundle --maxWorkers=1 --pool=threads tests/unit/payroll/vacation-period-balance-db.test.ts lib/services/__tests__/payroll-nom02c1-balance-status.test.ts lib/services/__tests__/payroll-nom02c1-vacations.test.ts lib/services/__tests__/payroll-nom02a-attendance.test.ts lib/services/__tests__/payroll-nom02b-overtime.test.ts`: **64/64, cinco archivos, exit 0**, 33.43 s.
- Cinco de esos casos ejecutan las consultas del servicio contra PGlite: corte con microsegundos, empresa ajena, cero real, falta de datos aplicables, fallback y error SQL. PGlite no acredita runtime PostgreSQL independiente ni RLS.
- ESLint focal de los tres archivos de código: **exit 0**, cero errores; 19 advertencias `any` existentes en el servicio.
- Tipos globales: `node --max-old-space-size=4096 node_modules/typescript/bin/tsc --noEmit --incremental false`: **exit 0**, sin diagnósticos.
- Validador documental: **239 filas, 86 tareas base, 114 hijos, 75 aceptados, cero errores**, exit 0; `git diff --check` exit 0.
- Build inicial `pnpm.cmd run build`: **exit 1**, sin poder descargar Geist/Geist Mono de Google Fonts. Reintento con acceso de red autorizado: compilación correcta en 102 s, pero worker de TypeScript terminó **exit 134** por heap agotado a ~2 GB. Los logs se conservaron en `.tmp/nom02c1-period-build*.log`.
- Build completo con acceso de red autorizado y `NODE_OPTIONS=--max-old-space-size=4096`: **exit 0**, compilación, TypeScript y **455/455** páginas completadas, `BUILD_ID: lXp05Male0dQ_9TfUPsVK`. La variable se restauró al finalizar; no se cambió configuración del proyecto. El log incluye un aviso de render dinámico por `headers` en `/dashboard/labor/documents`; el build finaliza correctamente.

## Pendientes

`days_balance` y `leave_balances.balance` siguen siendo saldos mutables. Filtrar por período de acumulación evita utilizar derechos futuros, pero no reconstruye el saldo anterior a consumos/modificaciones posteriores ni prueba vigencia/caducidad de remanentes. Esa reconstrucción exige una fuente histórica con movimientos o snapshots y su aceptación V2; no inferirla de este filtro.

Continúan pendientes la aceptación nativa de NOM-02.c1, NOM-06, snapshots aprobados, impuestos/deducciones, timbrado y despliegue. No se ejecutaron migraciones ni se alteraron bases externas. Los cambios locales previos de UI laboral y alcance de validación/timbrado no forman parte de este incremento.
