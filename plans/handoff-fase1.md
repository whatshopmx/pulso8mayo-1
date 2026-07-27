# Handoff — Fase 1: Núcleo Operativo de Inventario

## Estado Actual

- **Fase 0 completada:** cron de alertas reactivado, creditNotes conectado a UI, OCR integrado en recepción
- **Fase 1 completada:** orgType en storageLocations, Knowledge Graph, yieldPercent, módulo de Producción
- Módulo de inventario ~68% construido
- Todo compila y pasa lint sin errores nuevos

## Arquitectura Relevante

- **DB:** `lib/db/schema.ts` (~2350 líneas, tabla centralizada). Próximas tablas van aquí o en `lib/db/schema/` modular.
- **Auth:** `getSession()` en API routes, `auth.api.getSession({ headers })` en algunos endpoints — usar `getSession` para consistencia.
- **Stack:** Next.js 16 App Router, Drizzle ORM, Neon Postgres.
- **Inngest:** Funciones durables en `lib/inngest/functions/`. La función `cron-inventory-checks` ya ejecuta `checkInventoryAlerts` cada 6h.
- **NotificationDispatcher:** `lib/services/notification-dispatcher.ts` — maneja envío multicanal (WhatsApp/email/in-app).
- **StockAlertService:** `lib/services/stock-alert-service.ts` — tiene `checkStockLevels`, `sendAlerts`, `checkPriceIncrease`, getters para UI.

## Fase 1 — Items

### 1.1: `type` en storageLocations + separación central/sucursal

**Contexto:** `storageLocations` ya tiene columna `type` con enum físico (`DRY_STORAGE`, `REFRIGERATOR`, etc.). El plan pide agregar *otro* concepto de tipo: `'CENTRAL' | 'BRANCH' | 'VIRTUAL' | 'TRANSIT'` para diferenciar almacenes centrales de sucursales.

**Qué hacer:**
1. Agregar columna `orgType` (o similar) a `storageLocations` — NO modificar el `type` existente
2. En `inventory-service.ts` (o nuevo service) agregar lógica para consultas que diferencien central vs sucursal
3. Actualizar UI de `location-manager.tsx` si aplica

**Riesgo:** Migración DB requiere `drizzle-kit generate` + `db:migrate`. `db:push` es peligroso (puede dropear tablas).

### 1.2: Módulo de Producción (batch cooking)

**Contexto:** No existe aún. El módulo más grande de Fase 1.

**Qué hacer:**
1. Schema: `productionOrders`, `productionResults` (nuevas tablas)
2. Service: `production-service.ts` con lógica de planeación, registro de insumos, producto terminado
3. UI: `app/dashboard/inventory/production/` con planificador de batches
4. Los insumos se descuentan de `inventoryBatches` al registrar producción
5. Producción sugerida basada en ventas históricas (salesEntries ya existe)

**Dependencias:** schema de ventas (`salesEntries`) para sugerencias. Revisar `lib/services/inventory-service.ts` para ver cómo descuentan stock actualmente (ej: waste/transfer).

### 1.3: Rendimientos (yieldPercent)

**Contexto:** Modelar que 10kg carne → 8.4kg útiles (84% rendimiento).

**Qué hacer:**
1. Agregar columna `yieldPercent` a `inventoryItems` y `recipeItems`
2. Afecta consumo teórico y costeo de recetas
3. Ajustar `recipe` service si existe

### 1.4: Inventory Knowledge Graph

**Contexto:** Base analítica por par ingrediente-sucursal. Sin PRD detallado.

**Qué hacer:**
1. Nueva tabla `inventoryKnowledgeGraph`
2. Nuevo service `knowledge-service.ts`
3. Se alimenta de movimientos, mermas, conteos
4. Métricas: merma promedio, variación, tendencia, consumo

## Convenciones a Seguir

- **API routes:** `app/api/inventory/<recurso>/route.ts` con GET/POST/PATCH según CRUD
- **Auth:** Usar `getSession()` de `@/lib/auth`, verificar `session.user.companyId`
- **DB imports:** `import { ... } from '@/lib/db/schema'`
- **Servicios:** Clases estáticas en `lib/services/` — seguir patrón de `StockAlertService`
- **Notificaciones:** Usar `NotificationDispatcher.sendInventoryAlert()` para alertas
- **Validación:** Zod schemas en API routes
- **Multi-tenant:** Siempre filtrar por `companyId`
- **Precios:** Enteros en centavos (integer)
- **Idioma UI:** Español

## Comandos Útiles

```bash
pnpm run dev              # Dev server
pnpm run build            # Build + typecheck
pnpm run lint             # ESLint
pnpm db:generate          # Generar migración Drizzle
pnpm db:migrate           # Aplicar migración (seguro)
# NO USAR db:push sin verificar contra qué DB apunta
```

## Próximo Inicio Sugerido

**1.1** es el más rápido y desbloquea la separación lógica. Después **1.4** (knowledge graph) es independiente. **1.2** (producción) es el más grande — requiere planeación de UI + schema + service + API.
