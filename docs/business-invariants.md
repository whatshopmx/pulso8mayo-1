# Invariantes de Negocio — Pulso HORECA

**Propósito:** afirmaciones que SIEMPRE deben ser verdaderas para que el sistema sea correcto como "sistema operativo" de un grupo restaurantero de 3–15 sucursales. Cada invariante tiene forma verificable (test, query SQL de reconciliación, o revisión contra fuente oficial). Si una falla, es un bug de negocio, no de opinión.

**Estado:** ✅ verificado · ❌ violado · ⬜ pendiente de verificar

---

## 1. Multi-tenant / multi-sucursal (el riesgo #1 del perfil cliente)

| # | Invariante | Verificación | Estado |
|---|-----------|--------------|--------|
| 1.1 | Ningún endpoint devuelve datos fuera del `companyId` de la sesión | Auditoría de endpoints + test E2E cross-tenant | ❌ 17+ endpoints sin auth — ver `docs/audits/2026-08-01-tenant-scoping-audit.md` |
| 1.2 | `companyId`/`userId`/`approvedBy` jamás se aceptan del cliente (query/body); siempre de la sesión | Revisión de código + CI check | ❌ patrón extendido |
| 1.3 | Un gerente de sucursal solo lee/escribe su `branchId`; corporativo ve todas las suyas | Test E2E por rol | ⬜ |
| 1.4 | Reportes consolidados del grupo = suma exacta de sus sucursales, ni más ni menos | SQL de reconciliación | ⬜ |
| 1.5 | El header `x-pulso-tenant-id` no permite saltar a un tenant sin membresía verificada | Revisión (TODO abierto en `tenant-context.ts`) | ❌ TODO sin resolver |
| 1.6 | Una transferencia de inventario entre sucursales no crea ni destruye stock (sale de A = entra a B) | Test de integración `inventory/transfers` | ⬜ |

## 2. Inventario y costos

| # | Invariante | Verificación | Estado |
|---|-----------|--------------|--------|
| 2.1 | `stock_actual = Σ movimientos` (entradas − salidas − mermas ± ajustes) por producto/sucursal, en todo momento | SQL: comparar stock vs. `inventory/movements` | ⬜ script pendiente |
| 2.2 | Ningún movimiento deja stock negativo salvo configuración explícita | Constraint/test | ⬜ |
| 2.3 | Consumo teórico = Σ (receta × ventas registradas) del período (`theoretical-consumption-service`) | Test con datos semilla | ⬜ |
| 2.4 | Varianza de conteo físico >10% genera alerta (`stock-count-service` marca `isAlert`) | Test unitario | ⬜ umbral existe, falta test |
| 2.5 | Factura de proveedor se amarra a su orden de compra (`invoice-matching-service`); discrepancia de precio genera claim | Test de integración | ⬜ |
| 2.6 | Costo de receta usa conversiones de unidad correctas (kg↔g, L↔ml) vía `unit-conversion-service` | Test de propiedad: convertir y revertir = identidad | ⬜ |

## 3. Laboral (LFT / IMSS) — México

| # | Invariante | Fuente oficial | Estado |
|---|-----------|----------------|--------|
| 3.1 | Jornada diurna: 6:00–20:00, máx 8h. Nocturna: 20:00–6:00, máx 7h. Mixta: máx 7.5h | LFT Arts. 60–61 | ❌ `labor-calculator.ts` usa diurna 6:00–**22:00** y nocturna 22:00–6:00 |
| 3.2 | Horas extra dentro del límite legal (máx 3h/día, 3 veces/semana) se pagan al **doble**, sin importar si son diurnas o nocturnas | LFT Art. 67 | ❌ el código paga extra nocturna al **triple** (regla inexistente en la LFT) |
| 3.3 | Horas extra que excedan 9h/semana se pagan al **triple** | LFT Art. 68 | ❌ no existe la lógica de tope de 9h (`maxMinutes: undefined` en todas las reglas) |
| 3.4 | Semanal máximo: 48h diurna / 42h nocturna / 45h mixta | LFT Art. 61 | ❌ se usa 48h plano para todos los turnos |
| 3.5 | Prima dominical: +25% por trabajar domingo | LFT Art. 71 | ⬜ hay `// Check for Sundays`, falta verificar cálculo |
| 3.6 | Trabajo en día festivo obligatorio: salario del día + doble | LFT Art. 75 | ⬜ implementado como 3x plano, verificar contra nómina real |
| 3.7 | Descansos obligatorios detectados sin falsos negativos (`lft-conflict-detector`) | LFT Art. 63 | ⬜ |
| 3.8 | Nómina calculada = f(asistencias, incidencias, extras) y es **reproducible**: mismos inputs → mismo resultado | Test de determinismo `payroll-calculator` | ⬜ |
| 3.9 | Cálculos IMSS/SUA (`imss-parser`, `payroll-calculator`) cuadran con tablas oficiales vigentes | Tablas IMSS/INFONAVIT vigentes | ⬜ verificar contra fuente |

## 4. Workflows y cumplimiento (NOM-251 / NOM-035)

| # | Invariante | Verificación | Estado |
|---|-----------|--------------|--------|
| 4.1 | Un workflow programado se ejecuta exactamente 1 vez por ocurrencia (idempotencia de crons Inngest) | SQL: ejecuciones duplicadas por schedule/día = 0 | ⬜ |
| 4.2 | Evidencia con confidence < umbral (`minConfidence` en `verification-engine`) NUNCA queda auto-aprobada | Test unitario | ⬜ regla existe, falta test |
| 4.3 | Toda acción de usuario queda en audit log (`audit-service`) con actor, timestamp y tenant | SQL: acciones sin log = 0 | ⬜ |
| 4.4 | Un incidente crítico escala si no se atiende en el tiempo configurado (`escalation-service`) y la cadena termina en corporativo | Test de integración con tiempo simulado | ⬜ |
| 4.5 | Las evidencias de cumplimiento no se pueden falsificar desde fuera (webhook WhatsApp con firma verificada) | Revisión | ❌ `whatsapp/receive-photo` acepta cualquier POST |
| 4.6 | Checklists NOM-251 cubren los puntos normativos (temperaturas, tiempos, higiene) tal como los define la norma | Revisión de `templates/*.json` contra NOM-251-SSA1-2009 | ⬜ revisión con experto/norma |

## 5. Operación del grupo (3–15 sucursales)

| # | Invariante | Verificación | Estado |
|---|-----------|--------------|--------|
| 5.1 | Un día operativo completo (apertura, recepción, turnos, incidencias, cierre) se refleja en el dashboard corporativo sin intervención manual | Escenario E2E "un día operativo" con 5 sucursales | ⬜ escenario pendiente |
| 5.2 | Las notificaciones (WhatsApp/email/in-app) llegan al rol correcto según `notification-dispatcher` y respetan preferencias de usuario | Test de integración | ⬜ |
| 5.3 | Crons de Inngest cubren los horarios de operación real del cliente (recordatorios 8:00, reportes 6:00, breaks 18:00) y en timezone del tenant | Revisión `lib/inngest/functions/` | ⬜ verificar timezone |
| 5.4 | Smart links públicos expiran y no son reutilizables fuera de su ventana | Test + revisión `smart-link-service` | ⬜ |

---

## Cómo usar este documento

1. **Antes de cada release:** correr los SQL de reconciliación (sección 2.1, 4.1, 4.3) contra staging — deben devolver 0 filas.
2. **Al tocar un módulo:** convertir los ⬜ de ese módulo en tests antes de refactorizar.
3. **Al cerrar un ❌:** mover a ✅ con el link al test/fix que lo respalda.
4. Toda regla de negocio nueva entra aquí primero (spec), luego al código.
