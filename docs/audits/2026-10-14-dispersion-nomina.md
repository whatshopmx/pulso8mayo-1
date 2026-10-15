# C21 — Dispersión de nómina (`payrollDispersion`)

Fecha: 14 de octubre de 2026. Plan: [C21](../../tasks/plan-conexion-frontend-backend.md#c21). Seguimiento: [tareas](../../tasks/todo-conexion-frontend-backend.md).

## Decisión

`payrollDispersion` permanece **`descriptiva`** en el catálogo de C15. El producto no ejecuta dispersión bancaria ni transferencias automatizadas de nómina: la corrida de nómina se calcula, se timbra (CFDI de nómina vía FiscalAPI) y el estado de pago se refleja en tesorería, de donde un apoderado genera un layout bancario que dispersa manualmente. Ningún módulo —exportación, timbrado o dispersión— lee la columna `payroll_dispersion` para decidir nada; elegir CONSOLIDADA, POR_RAZON_SOCIAL o MIXTO no agrupa corridas, ni exporta recibos, ni activa pagos automáticos.

La clasificación sigue el criterio de C15: cada política se clasifica por lo que el código hace hoy, verificado contra el consumidor que la lee. Deducir permisos o agrupaciones del nombre del valor sería repetir H04. El contrato de la entrada del catálogo quedó escrito contra el recorrido real:

- **Aplicación:** se lee al abrir la pantalla de configuración; ningún módulo de nómina lee la columna para decidir nada; el producto no ejecuta dispersión bancaria autónoma —las corridas se procesan y timbran por empresa, y la tesorería genera layouts bancarios que un apoderado dispersa manualmente—.
- **Excepciones:** elegir una modalidad no agrupa corridas, exportaciones ni recibos ni activa pagos automáticos.
- **Decisión pendiente:** resuelta el 14-10-2026 (C21) — la dimensión permanece descriptiva porque no existe integración de dispersión bancaria directa; la UI documenta honestamente el esquema operativo del grupo sin enviar dinero real.

Los valores y rangos del contrato (`CONSOLIDADA` como default `notNull`, las tres opciones del enum) no cambian; sólo cambian la descripción y la decisión registrada.

## Recorrido real que la dimensión describe

```
calcular   calculateEmployeePayroll(userId, inicio, fin)   → percepciones del periodo
timbrar    executePayrollRun(companyId, inicio, fin)       → payroll_runs + payroll_payslips
             └─ timbrarNomina (fiscal-service)             → POST /invoices (CFDI N) a FiscalAPI
programar  TreasuryService.getUnpaidPayrollRuns(companyId) → nómina pendiente en corrida de tesorería
dispersar  generateBankDisbursementLayout                  → layout SPEI manual (rol tesorería, C18)
```

El único escritor del estado de pago de una corrida de nómina es la liquidación de la corrida de tesorería (C18/C19); la columna de dispersión no participa.

## Verificación

### V1 — Unidades (`tests/unit/finance/payroll-dispersion-policy.test.ts`, 7 pruebas)

Sobre el catálogo real: registro de la política (campo, sección, grupo), clasificación `descriptiva` sin consumidor, permiso `settings/update` y alcance Grupo, texto honesto sin promesas de pagos automatizados, las tres opciones descriptivas (`caso: null`), default `CONSOLIDADA` en la configuración base y la decisión registrada con su fecha y tarea.

### V2 — Navegador aislado

Sin cambios de interfaz en C21: la sección de dimensiones ya no promete nada que la columna no cumpla (los textos de las tres opciones describen cómo se **declara** la nómina, no pagos automatizados), y el distintivo de estado (`descriptiva`) sale del catálogo desde C15. Las 31 pruebas de `tests/e2e/operating-config.spec.ts` siguen en verde. **Límite declarado:** como en C13–C20, la autorización no se ejerce en navegador con Next/auth; queda en las unitarias sobre la ruta real y en el recorrido contra la base.

### V3 — Recorrido contra la base real + sandbox FiscalAPI (`scripts/verify-payroll-dispersion.ts`, 25 comprobaciones)

El script siembra dos empresas aisladas en Neon (sin datos de producción), con empleados cuyo RFC corresponde a **personas físicas de prueba del SAT** del catálogo oficial (`lib/fiscal/sat-test-data.ts`, docs.fiscalapi.com/testing-data) y el emisor de sandbox EKU9003173C9 con su CSD (`tests/fixtures/fiscalapi-certs/`). Los empleados van sin CURP a propósito: el payload usa la CURP genérica del catálogo SAT (XEXX010101MNEXXXA8), porque el complemento valida formato NOM111 y una CURP inventada hace que el PAC rechace. Resultado:

| Bloque | Comprobaciones |
| --- | --- |
| Siembra | Empresas con RFC distintos, sucursales por empresa, Empresa A `CONSOLIDADA` y Empresa B `POR_RAZON_SOCIAL` persistidas y relidas. |
| Cálculo | `calculateEmployeePayroll` devuelve exactamente 15 días × salario diario por empleado, sin contaminación cruzada. |
| Corrida y aislamiento | `executePayrollRun` crea 1 corrida por empresa; `getPayrollRuns` de A no ve la de B. |
| **Timbrado real sandbox** | El PAC devolvió **TIMBRADO con UUID real** para ambas empresas (`b61668d5…` para XOCHILT CASAS CHAVEZ —Empresa A— y `43800df3…` para KARLA FUENTE NOLASCO —Empresa B—); cada CFDI tiene como receptor a la persona de prueba designada; el payslip conserva el folio (recargar no lo borra). |
| Tesorería | `getUnpaidPayrollRuns` ve sólo la nómina de su empresa, con el total exacto de percepciones, y ninguna ve la del otro tenant. |
| Historia | Alternar Empresa A a MIXTO no altera corridas ni timbrados: mismo UUID, mismo estado. |
| Limpieza | Empresas, usuarios, contratos, checadas, corridas, payslips, timbrados y config de prueba borrados en `finally`; confirmado. |

**Nota de entorno:** la primera ejecución contra el sandbox fue rechazada por el PAC con 403 `Saldo insuficiente. Disponible: 0, Requerido: 1` —el payload autenticó y validó; faltaban timbres de prueba en la cuenta—. El script está construido para no maquillar ese caso: si el PAC rechaza, comprueba que la constancia quedó `RECHAZADO` con el mensaje real, que el payslip no afirma TIMBRADO ni guarda folio, y registra el folio como pendiente en el informe. Tras recargar timbres de prueba en la cuenta de sandbox, ambas empresas timbraron con folio real. Los timbres de prueba se compran en el dashboard de FiscalAPI con las tarjetas de prueba del catálogo (PCI DSS impide comprarlos por API).

### Puertas de fase

| Comando | Resultado |
| --- | --- |
| `pnpm exec vitest run tests/unit/finance/payroll-dispersion-policy.test.ts tests/unit/company/operating-policy-catalog.test.ts` | 31/31 (7 de C21 + 24 del catálogo: 6 aplicadas / 6 descriptivas / 1 pendiente). |
| `pnpm run test:unit` | **1190 aprobadas**, 1 omitida, 1 TODO (89 archivos). |
| `pnpm run lint` | **0 errores** (2402 warnings, todos preexistentes; el único warning de archivos de C21 —import sin usar— quedó corregido). |
| `pnpm run build` | Exitoso (salida 0). |
| `tsc --noEmit` | Sin errores de tipos en los archivos de C21. |

## Límites declarados

1. **Sin V2 con Next/auth**, igual que C13–C20: el navegador intercepta la API; la autorización vive en las unitarias sobre la ruta real y en este recorrido contra la base.
2. El timbrado se ejerció contra el **sandbox** de FiscalAPI (FISCALAPI_ENV=test) con cuentas de prueba del SAT; nunca contra PAC de producción ni con dinero real.
3. La verificación es de la **corrida y su timbrado**, no de una dispersión bancaria: no existe tal recorrido en el producto, que es justamente lo que la clasificación descriptiva registra.
4. `payrollDispersion` sigue sin consumidor; si el negocio define agrupaciones por razón social o mezcla de nómina, será una tarea nueva con su contrato, no una reinterpretación de la columna.
