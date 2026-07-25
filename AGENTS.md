# Pulso HORECA - Agent Instructions

Software for HORECA chains (hotels, restaurants, cafés) focused on quality control, NOM-251/NOM-035 compliance, inventory audits, RH/attendance, and WhatsApp automations.

## 🚀 Core Commands

```bash
# Package manager: pnpm (NOT npm)
pnpm install              # Install deps
pnpm run dev              # Dev server (localhost:3000)
pnpm run build            # Production build
pnpm run lint             # ESLint
pnpm test:e2e             # Playwright E2E tests

# Database (Drizzle ORM + Neon Postgres)
pnpm db:generate          # Generate migrations
pnpm db:push              # ⚠️ DANGER: can drop tables
pnpm db:migrate           # Apply migrations

# Inngest
pnpm run dev              # Start with INNGEST_DEV=1 for Inngest local dev
npx inngest-cli@latest dev -u http://localhost:3000/api/inngest  # Dev server UI

# Utilities
npx tsx scripts/seed-demo-data.ts  # Seed demo data
```

## 📁 Architecture

**Stack:** Next.js 16 (App Router), React 19, TypeScript, Drizzle ORM, Neon Postgres, better-auth, Radix UI, Tailwind CSS v4, Recharts

**Key directories:**
- `app/api/` - API routes (workflows, inventory, labor, compliance, WhatsApp)
- `app/dashboard/` - Main dashboard pages
- `lib/db/schema/` - Drizzle schema modules
- `lib/services/` - Business logic layer
- `lib/whatsapp/` - WhatsApp integration (Wasender API)
- `components/workflow/` - Workflow executor & builder
- `templates/` - Pre-built workflow templates (15+ HORECA operations)

**Entry points:**
- Workflow execution: `app/api/workflows/execute/route.ts`
- WhatsApp webhook: `app/api/whatsapp/webhook/route.ts`
- AI verification: `app/api/ai/verify/route.ts`
- Inngest serve: `app/api/inngest/route.ts` (durable functions & cron)
- Inngest functions: `lib/inngest/functions/` (11 cron jobs migrated from Vercel)

## ⚙️ Configuration

**Environment (.env required):**
- `DATABASE_URL` - Neon Postgres connection
- `BETTER_AUTH_SECRET` - Auth secret
- `WASENDER_API_KEY`, `WASENDER_API_URL` - WhatsApp (Wasender)
- `QSTASH_TOKEN`, `QSTASH_*` - Upstash cron/redis
- `R2_*` - Cloudflare R2 storage (or local fallback)
- `RESEND_API_KEY` - Email notifications
- `INNGEST_DEV=1` - Local dev mode for Inngest
- `INNGEST_SIGNING_KEY` - Production signing key (Inngest Cloud)
- `INNGEST_EVENT_KEY` - Production event key (Inngest Cloud)

**Inngest Cron Jobs** (`lib/inngest/functions/`):
- `*/5 * * * *` - Execute scheduled workflows
- `0 * * * *` - Check overdue items, send reminders, overdue workflows
- `0 8 * * *` - Daily reminders
- `0 */6 * * *` - Inventory checks, stock check, compliance alerts
- `0 6 * * *` - Scheduled reports, document expiration
- `0 18 * * *` - Break reminders

## 🧪 Testing

```bash
# E2E tests (Playwright)
pnpm test:e2e

# Test config: playwright.config.ts
# Base URL: PLAYWRIGHT_TEST_BASE_URL env var (default: localhost:3000)
# Runs dev server automatically via webServer config
```

**Note:** Tests excluded from TypeScript (`tsconfig.json`), run separately.

## 🏗️ Key Conventions

**Multi-tenant:** All data scoped by `tenantId`/`companyId`. Use `lib/tenant-context.ts` for access checks.

**Auth:** `better-auth` with session-based auth. Always verify with `getSession()`.

**Database safety:** `drizzle-kit push` can drop tables - verify against `.env` before running.

**Notification flow:**
- `NotificationService` - Direct notification API
- `NotificationDispatcher` - Template-based with user preferences
- Channels: WhatsApp (Wasender), Email (Resend), In-App (DB table)

**Storage:** R2 with local fallback when credentials missing.

## 📝 Workflow System

Core workflow engine (`workflow` package) handles:
- Template-based workflow definitions (`templates/*.json`)
- Step-by-step execution with AI verification
- Evidence collection (photos, text, OCR)
- WhatsApp conversation integration
- Smart links for external execution

**AI Verification:** `/api/ai/verify` endpoint with confidence scoring. Auto-approves >85%, marks for review otherwise.

## 📊 Database Schema

Modular schema in `lib/db/schema/`:
- `core.ts` - Core business tables
- `auth.ts` - Auth & permissions
- `equipment.ts` - Equipment tracking
- Additional modules as needed

Main schema: `lib/db/schema.ts`

## 🚨 Common Gotchas

1. **Strict mode:** TypeScript `strict: false` - some type issues may not surface
2. **i18n:** Uses `next-intl` with config at `./i18n/config.ts`
3. **Workflow package:** Custom `workflow` npm package (v4.1.0-beta.52)
4. **Playwright tests:** Excluded from TS build, run via separate command
5. **Inngest dev mode:** Set `INNGEST_DEV=1` for local dev, otherwise Inngest defaults to Cloud mode

## 📚 Documentation

- `PROJECT_CONTEXT.md` - Phase completion status, TODOs
- `docs/user-guide.md` - End user guide (Spanish)
- `docs/admin-guide.md` - Admin documentation
- `plans/system-architecture.md` - Architecture diagrams
- `templates/README.md` - Template library docs

## 🔧 Development Flow

1. `pnpm install` (one-time setup)
2. Copy `.env` with required credentials
3. `pnpm db:push` (caution: can drop tables)
4. `npx tsx scripts/seed-demo-data.ts` (optional demo data)
5. `pnpm run dev`
6. Run `pnpm run build` before committing to verify

<!-- CODEGRAPH_START -->
## CodeGraph

This project has a CodeGraph MCP server (`codegraph_*` tools) configured. CodeGraph is a tree-sitter-parsed knowledge graph of every symbol, edge, and file. Reads are sub-millisecond and return structural information grep cannot.

### When to prefer codegraph over native search

Use codegraph for **structural** questions — what calls what, what would break, where is X defined, what is X's signature. Use native grep/read only for **literal text** queries (string contents, comments, log messages) or after you already have a specific file open.

| Question | Tool |
|---|---|
| "Where is X defined?" / "Find symbol named X" | `codegraph_search` |
| "What calls function Y?" | `codegraph_callers` |
| "What does Y call?" | `codegraph_callees` |
| "What would break if I changed Z?" | `codegraph_impact` |
| "Show me Y's signature / source / docstring" | `codegraph_node` |
| "Give me focused context for a task/area" | `codegraph_context` |
| "See several related symbols' source at once" | `codegraph_explore` |
| "What files exist under path/" | `codegraph_files` |
| "Is the index healthy?" | `codegraph_status` |

### Rules of thumb

- **Answer directly — don't delegate exploration.** For "how does X work" / architecture / trace questions, answer with 2-3 codegraph calls: `codegraph_context` first, then ONE `codegraph_explore` for the source of the symbols it surfaces. Codegraph IS the pre-built index, so spawning a separate file-reading sub-task/agent — or running a grep + read loop — repeats work codegraph already did and costs more for the same answer.
- **Trust codegraph results.** They come from a full AST parse. Do NOT re-verify them with grep — that's slower, less accurate, and wastes context.
- **Don't grep first** when looking up a symbol by name. `codegraph_search` is faster and returns kind + location + signature in one call.
- **Don't chain `codegraph_search` + `codegraph_node`** when you just want context — `codegraph_context` is one call.
- **Don't loop `codegraph_node` over many symbols** — one `codegraph_explore` call returns several symbols' source grouped in a single capped call, while each separate node/Read call re-reads the whole context and costs far more.
- **Index lag**: the file watcher debounces ~500ms behind writes; don't re-query immediately after editing a file in the same turn.

### If `.codegraph/` doesn't exist

The MCP server returns "not initialized." Ask the user: *"I notice this project doesn't have CodeGraph initialized. Want me to run `codegraph init -i` to build the index?"*
<!-- CODEGRAPH_END -->

## Design Context

Design decisions are captured in two root files:
- **PRODUCT.md** — strategic: register (product), platform (web), users, positioning, brand personality, anti-references, design principles
- **DESIGN.md** — visual: OKLCH color tokens, Geist typography, component specs, elevation philosophy, do's and don'ts
- **`.impeccable/design.json`** — machine-readable sidecar for live mode

Key principles: Operational Red used sparingly (10-15%), flat with tonal layering (no shadows), single Geist family, compliance as a byproduct not a chore. Run `/impeccable` for the full command menu.
