# Correcciones de Fondo Legal Reformas LFT + Parámetros Laborales Configurables

## Contexto (por qué)

Investigación DOF (oct-2026) contra el código:

**Etiquetas legales incorrectas.** Hay 3 stratos mezclados en `reformas-laborales-2026.md`:

1. **Ley vigente** (obligatoria hoy): calendario jornada 48→40h (DOF 1-may-2026), Ley Silla (DOF 19-dic-2024, plazo interno vencido 14-dic-2025), brecha salarial/tabuladores (DOF dic-2024), registro electrónico de jornada (obligación vigente; lineamientos STPS y vigor 1-ene-2027).
2. **Fecha firme futura**: escalones 2027-2030 (9/10/11/12h dobles, tope diario 12h, extras ≤4h/día en máx 4 días/semana).
3. **Solo iniciativas, NO ley**: desconexión digital, licencia salud mental 7d, duelo 5d/paternidad 10-15d, anti-buró (Senado aprobó mar-2026, falta Diputados), prima por IA (+2 meses, Morena jul-2026).

**Bugs de legalidad detectados** (`lib/services/labor-calendar-rules.ts`):
- 2026 `maxWeeklyTripleOvertimeCap: 0` → el Art. 68 vigente desde 1-may-2026 ya permite **4h triples en 2026**. El validador hoy tolera hasta 9h dobles "sin tope triple": ilegal.
- Falta regla de distribución: extras ≤4h/día y ≤4 días/semana (Art. 66), tope 12h diarias suma ordinaria+extra (Art. 68).
- `MINIMUM_WAGE_MXN = 278.80` pegado en `ai-severance-calculator.ts` (dato 2026).
- `AISeveranceCalculator` cita "LFT Art. 50/439" que no existe en la ley vigente.
- Regla +50% / compensación 30 días de `off-hours-event-service` no localizada en DOF — no se puede alegar como norma; debe vivirse como política de empresa configurable o honestamente como preview.

**Dato clave de arquitectura**: el repo ya resuelve este problema para parámetros operativos — tabla `tenantOperatingConfig` (schema.ts:3275), servicio único `tenant-config-service.ts` (caché 5 min, lazy defaults), auditoría con vigencia en `config_change_logs`, catálogo contractual en `lib/company/operating-policy-catalog.ts`, UI en `app/dashboard/company/operating-config/page.tsx`. Este plan extiende ese patrón a lo laboral en vez de duplicar mecanismos. Advertencia [H04] aplica: todo campo nuevo debe declarar consumidor, o removerlo.

## Tasks

- [ ] Task 1: Crear `lib/db/schema/labor-law-ref.ts` — tabla `laborLawCalendarRules` con vigencia por **fecha** (no bucket anual): `effectiveFrom`, `effectiveTo`, `maxWeeklyHours`, `maxDoubleOvertimeHours`, `maxTripleOvertimeHours`, `maxDailySumHours`, `maxExtraHoursPerDay`, `maxExtraDaysPerWeek`, `minWageMxn`, `sourceDofUrl`, `sourcePublishedOn`. Seed idempotente (`scripts/seed-labor-law-rules.ts` + migración) con las 5 filas del transitorio 1-may-2026 + salarios mínimos anuales conocidos. La tabla es **solo lectura para usuarios** (Ley = no editable); perfil "legal-admin/platform" mantiene el seed. → Verify: `pnpm db:generate` sin DROP; seed corre 2x sin duplicar.
- [ ] Task 2: Arquitectura de resolución en 3 capas — `lib/services/labor-rules-resolver.ts`: (1) resuelve ley por fecha efectiva de la tabla seed (usa patrón de caché/Tag de `tenant-config-service`); (2) merge con override de empresa (contrato colectivo/CT puede ser **más restrictivo**, nunca más laxo: validador rechaza override que suba topes); (3) catálogo de statuts para reformas pendientes `lib/company/labor-reform-status-catalog.ts`: cada servicio huérfano declara provenance (`'LAW' | 'PENDING_INITIATIVE' | 'POLICY'`), con nota legal citada y DOF URL. → Verify: test unitario del resolver: fecha 2026-04-30 → 48h/sin triple; 2026-07-01 → 48h + 4 triple; 2031 clampa a 40h.
- [ ] Task 3: Corregir `lib/services/labor-calendar-rules.ts` (bug 2026): triple cap 2026 = 4; mantener compat de firma `getRulesForYear` delegando al resolver de Task 2. Extender `lib/labor-validation.ts` y `lib/services/lft-conflict-detector.ts` con las 3 reglas nuevas de Art. 66/68: tope 12h diarias suma, extras ≤4h/día, ≤4 días con extras por semana. → Verify: tests existentes de `labor-validation.test.ts` siguen pasando + casos nuevos invalidan 9h dobles sin triple en 2026.
- [ ] Task 4: Quemado de constantes fuera:
  - `MINIMUM_WAGE_MXN` de `ai-severance-calculator.ts` y `seniority cap 2x` → resueltos desde `laborLawCalendarRules.minWageMxn` por fecha de finiquito.
  - Escalones de reformas nuevas (mental health 7d, severance IA, +50% off-hours, desconexión WhatsApp) → cada cálculo llama al catálogo de statuts: si `'PENDING_INITIATIVE'`, el servicio computa como **proyección** con flag `legalBasis: pending` en su output (no como indemnización legal); si `'POLICY'` es opcional por empresa.
  - `LFT_SCHEDULED_REFORMS` deja de ser fuente de verdad (queda compat/deprecated).
  → Verify: grep sin constantes de dólares/ UMAs/ días-legales en `lib/services` reform-* salvo defaults de seed.
- [ ] Task 5: UI de parámetros — extender `app/dashboard/company/operating-config/page.tsx` con sección "Parámetros Laborales (Ley Fedeal del Trabajo)": (a) tabla ley 2026-2030 con vigencia + fuente DOF (read-only); (b) overrides de empresa (si aplica) con badge "más restrictivo que la ley"; (c) toggles de reformas pendientes con statuts y etiqueta honesta ("Iniciativa en Congreso — no vigente"). Auditoría de cambios ya cubierta por `config_change_logs`. → Verify: `pnpm run build`; revisar manual con dev server.
- [ ] Task 6: Preparar `registro electrónico de jornada 2027` en la configuración: campos por sucursal (sistema de registro usado, acuerdo firmado URL, beneficiario del estamos atribuible) en `breakComplianceRules`/nueva tabla ligera — flag `electronicRegistryReadiness` por sucursal (OFF/WIRING/READY), visible en compliance. Las lineamientos STPS aún no publican: diseño tolerante (`null` congela conducta). → Verify: página compliance muestra readiness por sucursal.
- [ ] Task 7: Suite + cierre: tests unitarios del resolver y validadores extendidos (~8 nuevos); actualizar `lib/__tests__/labor-reforms-2026.test.ts` con el conteo real; corregir en `reformas-laborales-2026.md` el registro "75/75" por el real, y etiquetar Task 5/7/9 como "previsivo (iniciativas)". → Verify: `pnpm test:unit` y `pnpm run build` limpios.

## Orden y dependencias

1 → 2 → 3 (sobre el resolver) → 4 → 6 (paralelo con 4) → 5 → 7. Task 3 es el **hotfix de legalidad** — puede desacoplarse como PR urgente (fix del triple cap 2026 con el mapa existente si Task 1-2 aún no están) mientras el resto corre en serie.

## Done When
- [ ] Ningún cálculo laboral depende de una constante duplicada: ley viene de tabla con vigencia + fuente DOF.
- [ ] La corrección 2026 (4h triples desde 1-may-2026) está en producción y testeada.
- [ ] Cada servicio de reformas pendientes declara su statuts legal en catálogo y lo refleja en su output/UI — imposible alegar "ley" que no es ley.
- [ ] Redness de registro electrónico 2027 visible por sucursal.
- [ ] Conteos de pruebas y estatus legales en docs = reales.
