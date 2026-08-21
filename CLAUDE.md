# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Pulso HORECA — multi-tenant SaaS for Mexican restaurant/hotel/café chains: operational workflows
(checklists with photo evidence + AI verification), NOM-251/NOM-035/LFT compliance, IMSS payroll
filings, inventory, shifts/attendance, sales & finance, all wired to WhatsApp notioifications to smartlink automations.
**The product UI and most code comments are in Spanish** — match that when writing user-facing
strings, and keep `messages/es.json` as the source of copy.

## Commands

Package manager is **pnpm**, not npm.

```bash
pnpm install
pnpm run dev              # localhost:3000
pnpm run build            # run before committing — this is the gate that catches TS errors
pnpm run lint

# Database (Drizzle + Neon Postgres)
pnpm db:generate          # generate a migration from lib/db/schema.ts
pnpm db:migrate           # apply migrations
pnpm db:push              # ⚠️ can DROP tables — never use it on a shared/prod DB

# Seeds (ordered; seed-full runs all 10)
pnpm seed && pnpm seed:pass   # full dataset + login passwords
pnpm seed:4                   # a single stage, e.g. inventory

# E2E
pnpm test:e2e
pnpm exec playwright test tests/corte-arqueo.spec.ts          # single spec
pnpm exec playwright test tests/corte-arqueo.spec.ts -g "faltante"  # single case

# Inngest local dev
INNGEST_DEV=1 pnpm run dev
npx inngest-cli@latest dev -u http://localhost:3000/api/inngest
```

### Testing notes that will bite you

- Specs run **serially** (`workers: 1`) against the *real dev database* — they share state
  (high-value SKU flags, active counts per branch) and will clobber each other in parallel.
- `tests/auth.setup.ts` logs in once as `carlos@pulso.mx` / `123456` (created by `pnpm seed:pass`)
  and stores cookies in `tests/.auth/`. Without a seeded DB every spec fails at setup.
- Default `webServer` is `npm run dev`, which compiles each route on first hit and blows the
  timeouts. Prefer running against a build:
  `pnpm build && PLAYWRIGHT_WEB_SERVER_CMD="npm run start" pnpm test:e2e`.
  `next dev` and `next start` share `.next` — kill the dev server before building.
- Test data is created/cleaned via direct SQL in `tests/support/db.ts` and tagged `[E2E]`.
- `tests/**` is excluded from `tsconfig.json`, so `pnpm build` will not typecheck specs.
- **The workflow extractor specs need the Inngest dev server running.** Completing an instance
  only emits `workflow/instance.completed`; the extraction into stock counts, waste, production
  and receiving happens in the `workflow-extractors` Inngest function. Without the dev server
  those specs poll for rows nobody writes and time out:
  `npx --yes inngest-cli@latest dev -u http://localhost:3000/api/inngest --no-discovery`
  (and start the app with `INNGEST_DEV=1`, or the SDK targets Inngest Cloud).
- Specs that only call services and SQL directly (`conteo-fecha-local`, `redondeo-ingredientes`,
  `extractor-idempotente`, `snapshot-idempotente`) need neither the server nor Inngest, and run
  in seconds: `pnpm exec playwright test --no-deps --project=chromium <spec>`.
- `next start` serves the **build**, not your working tree. After touching service code, rebuild
  before verifying or you will confirm a green that means nothing.

## Architecture

Next.js 16 App Router · React 19 · TypeScript (`strict: false`) · Drizzle ORM on Neon Postgres ·
better-auth · Radix/shadcn + Tailwind v4 · Inngest for durable jobs · next-intl (locale hardcoded
to `es`).

### Request path

`proxy.ts` (root — Next 16's renamed `middleware.ts`) runs on `/dashboard/*`, `/api/*`,
`/onboarding` and does four things before a handler sees the request: rate limiting
(`lib/rate-limiter.ts`, Upstash Redis), session verification via a fetch to
`/api/auth/get-session`, path-level RBAC (`hasAccess` in `lib/rbac/permissions.ts`, redirecting to
`getDefaultDashboard(role)`), and injecting `x-user-id` / `x-pulso-tenant-id` headers. Users with
no `companyId` get forced into `/onboarding`.

### Auth and tenancy — the single most important convention

Everything is scoped by `companyId` (the tenant) and optionally `branchId`. **`tenantId` always
comes from the session, never from a query param or request body** — same for `userId`,
`createdBy`, `approvedBy`, `escalatedBy`.

Preferred entry point for API routes:

```ts
export const GET = withTenantAuth(async (req, { auth }) => {
  // auth.tenantId, auth.user.id, auth.branchId — all session-derived
  return ApiHandler.success(data);
});
```

- `lib/api/with-auth.ts` — `withTenantAuth`, `withRoleAuth`, `requireTenantAuth`, `requireRoleAuth`.
  The `with*` wrappers catch `ApiError` and shape the JSON response for you.
- `lib/api/error.ts` / `lib/api/response.ts` — `ApiError.forbidden(...)` etc., and the
  `{ success, data | error }` envelope every route returns (`ApiHandler.success/error`).
- `lib/rbac/require-role.ts` — guards for **server components**: `requireRole`/`requireManagementRole`
  *redirect*, while `requireRoleApi`/`requireManagementRoleApi` *throw*. Pick by context.
- `lib/branch-scope.ts` — `GERENTE` and `SUPERVISOR` are pinned to their own branch;
  `enforceBranchScope` overrides any requested `branchId` for them. Use it instead of trusting
  a branch id from the client.
- Roles: `SUPER_ADMIN`, `ADMIN`, `GERENTE`, `SUPERVISOR`, `EMPLEADO`, `READONLY`.

**Duplicate-name trap:** `lib/permissions.ts` vs `lib/rbac/permissions.ts`, and `requireAuth` exists
in *both* `lib/tenant-context.ts` and `lib/api/with-auth.ts` with different return shapes. Check
which one you're importing. New code should use the `lib/api/` + `lib/rbac/` versions;
`lib/tenant-context.ts` is the older path.

### Layers

Routes stay thin: `app/api/**/route.ts` → `lib/services/*-service.ts` (business logic, ~100 modules)
→ `lib/db`. Cross-cutting engines live alongside the services: `verification-engine.ts`,
`incident-engine.ts`, `operational-twin-engine.ts`, `kpi-calculator.ts`.

`app/dashboard/**` holds the pages; `components/<domain>/` the domain UI; `components/ui/` shadcn
primitives; `hooks/` and `hooks/queries/` the client-side data layer (TanStack Query).

### Database

- Schema is **modular under `lib/db/schema/`** (`core`, `auth`, `equipment`, `security`,
  `subscription`, `playbooks`, `operational-twin`, …), but `lib/db/schema.ts` is still the
  drizzle-kit entrypoint and holds a large legacy tail of tables plus most `pgEnum`s. It re-exports
  `./schema/index`. Add new tables to a module; only touch `schema.ts` when you must.
- `lib/db/index.ts` deliberately uses the **`neon-serverless` (WebSocket) driver, not `neon-http`** —
  `neon-http` throws on `db.transaction` at runtime, and the repo has many transactional paths.
  Don't "simplify" it back to HTTP. The pool is cached on `globalThis` to survive dev hot-reload.
- Migrations in `drizzle/` are numbered (`0049_…`) and some are **hand-authored with descriptive
  names** (`0032_arqueo-cierre-turno`). A committed migration is *not* proof it was applied to the
  DB you're pointed at — `scripts/check-migration-drift.ts` and `scripts/repair-migration-journal.ts`
  exist because that drift happens. Check before blaming RBAC or a service for missing columns.

### Background jobs (Inngest)

`app/api/inngest/route.ts` serves the functions registered in `lib/inngest/functions/index.ts`
(~30: crons like `cron-execute-schedules`, `cron-inventory-checks`, `imss-alerts`, plus event
handlers like `whatsapp-router`, `workflow-executor`, `notification-dispatch`). Events are typed in
`lib/inngest/events.ts`; client id is `pulso29`. Without `INNGEST_DEV=1` the SDK targets Inngest
Cloud. `lib/cron/` still holds some older QStash-era logic that services call directly.

### Workflows

Templates are JSON under `templates/<domain>/` (see `templates/TEMPLATE_SCHEMA.md` and
`TEMPLATES_CATALOG.md`), executed by `lib/services/workflow-execution-service.ts` with
`components/workflow/workflow-executor.tsx` as the UI. Steps collect evidence (photos → R2 via
`lib/r2-client.ts`, with a local fallback when credentials are absent), which
`/api/ai/verify` scores; >85% confidence auto-approves, otherwise it queues for human review.

Completing certain templates has **side effects on other domains** — `receiving-from-workflow.ts`,
`merma-from-workflow.ts`, `production-from-workflow.ts`, `stock-count-from-workflow.ts` hook into
`workflow-execution-service.ts` *after* the instance is marked `COMPLETED` and extract rows into
receiving reports, waste, production and stock counts. If you change completion handling, these
extractors are what breaks.

Smart links (`lib/services/smart-link-service.ts`, `app/api/smart-links/`) let an employee run a
workflow from WhatsApp without a dashboard session.

### Notifications

Two layers that coexist: `NotificationService` (direct send) and `NotificationDispatcher`
(template + per-user preferences, delegates to the Service). Channels are WhatsApp via WasenderAPI
(`lib/whatsapp/wasender-client.ts`), email via Resend, and in-app rows in `notifications`.
Everything degrades to logging when credentials are missing, so a "sent" log locally means nothing.

## Conventions

- Import alias `@/*` maps to the repo root.
- Validation with Zod v4 + react-hook-form; API responses always the `{ success, data|error }` envelope.
- Logging via `lib/logger.ts` (`createChildLogger('scope')`, pino) — not bare `console.log` in new code.
- `strict: false` means missing null checks won't surface at build time. Be explicit anyway,
  especially around `session.user` casts (the codebase is full of `as any` there).
- Design tokens (OKLCH palette, Geist type scale, flat/no-shadow elevation) are specified in
  `DESIGN.md` with `PRODUCT.md` for positioning. Operational Red is a 10–15% accent, not a fill.

## Reference docs in-repo

`AGENTS.md` (agent-oriented summary, includes CodeGraph usage rules), `PROJECT_CONTEXT.md`
(phase-by-phase implementation status and the prioritized TODO table), `templates/README.md`,
`docs/user-guide.md` and `docs/admin-guide.md` (Spanish). Root-level `*_PLAN.md` / `*_STATUS.md`
files are historical records of finished migrations — treat them as archaeology, not current state.
