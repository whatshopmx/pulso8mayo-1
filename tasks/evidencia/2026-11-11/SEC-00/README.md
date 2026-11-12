# SEC-00 — Aceptación del arnés

Estado: aceptado, V2. Fecha 2026-11-11. HEAD `ba88018d2cbd7d879549cfe6476d39e4addfd5d2` más diff local; nuevo archivo `tests/integration/isolation-harness-db.test.ts`.

Entorno: proyecto `soft-cloud-50478212`, rama aislada `br-round-voice-belheola`, distinta de `main` (`br-steep-frog-bet3a8l6`). La rama procede del esquema inicial vacío; `.env.test` apunta explícitamente a ella. No se ejecutó contra la conexión anterior ni contra main.

```powershell
$env:NODE_OPTIONS = ($env:NODE_OPTIONS + ' --use-system-ca').Trim()
pnpm.cmd exec vitest run --configLoader bundle --config vitest.integration.config.ts --maxWorkers=1 --pool=threads tests/integration/isolation-harness-db.test.ts
```

Resultado: **4/4, exit 0**; 12.19 s. [Log íntegro](integration.log) y [exit nativo](exit.txt).

Cada caso crea dos empresas y dos sucursales por empresa en una transacción. El dueño ve cuatro evidencias; después las consultas se ejecutan como pulso_app, comprobando `current_user`, NOBYPASSRLS, NOSUPERUSER, propietario distinto y RLS habilitado. El runtime ve solo sus dos filas al alternar el contexto, aun con un filtro explícito por la otra empresa.

El insert ajeno falla con SQLSTATE 42501. Update/delete ajenos afectan cero filas y los valores originales de la otra empresa permanecen intactos. Sin contexto no hay lectura. Una escritura propia funciona y se revierte con el resto del caso; después se comprueba ausencia de fixtures y que contexto/rol local no sobreviven al rollback.

La membresía otorgada en esta rama permite al dueño de fixtures ejecutar SET LOCAL ROLE pulso_app, necesario en PostgreSQL 18; no otorga al runtime acceso al rol dueño. Se reutiliza el provisionador existente para credenciales sintéticas de prueba. No se amplió el rol de aplicación en main.

Intentos previos: el primero falló antes de los casos por confianza de certificados; el segundo conectó y detectó falta de membresía para SET ROLE (4 fallos). Ninguno cuenta como aceptación. Se corrigió el arnés, conservando las aserciones de RLS y sin desactivar TLS ni elevar el runtime.

Límite: prueba el arnés de empresa con evidencia y rollback real. No demuestra RLS de todas las tablas ni aislamiento de sucursal en todas las políticas, no verifica HTTP/navegador y no acepta SEC-05, INV-01 ni el piloto.
