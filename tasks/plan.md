# Implementation Plan: Evidence Gallery Overhaul (`app/dashboard/evidence`)

## Overview

Fix the design critique (18/40) of the Galería de Evidencias: restore trust in an audit
surface (dead controls, racy fetching, wrong fields), make the primary action accessible,
re-tokenize onto the Pulso OKLCH palette per DESIGN.md, and surface the branch dimension
for the multi-branch owner persona. Work spans one API route (`app/api/workflows/evidence/route.ts`)
and one client page (`app/dashboard/evidence/page.tsx`) plus small config/supporting pieces.

## Planning Findings (verified against source)

Beyond the critique, source inspection confirmed:

1. **Dead filters**: the API reads only `dateFrom`, `dateTo`, `search`. The `type` and
   `verified` params sent by the page are silently ignored — those two selects do nothing.
2. **Fabricated data**: every row is returned as `type: "PHOTO"` regardless of content;
   `stepName` is the raw `stepId`, while the frozen `title` column on
   `workflowInstanceSteps` is ignored. TEXT evidence content lives in the `value` jsonb
   column, not `url`.
3. **Image config gap**: `next.config.ts` has no `images.remotePatterns`; R2 presigned
   URLs (rotating query strings, 10-min TTL) would fail `next/image` optimization anyway.
   Plain `<img loading="lazy">` is the pragmatic render path.
4. **No migration needed**: schema columns `title`, `type`, `value`, `definition` already
   exist on `workflowInstanceSteps`.
5. **Tokens ready**: `bg-info`, `bg-success`, `bg-warning`, `text-destructive` etc. are
   mapped in `app/globals.css`; UI primitives exist (`skeleton.tsx`, `empty-state.tsx`,
   `toggle-group.tsx`, `tooltip.tsx`, `label.tsx`).
6. **Branches API exists**: `GET /api/branches` (`BranchService.listBranches`) can feed a
   Sucursal filter dropdown.

## Architecture Decisions

- **Derive media type server-side** from the evidence URL extension (photo/video/audio),
  falling back to the frozen step `type` column, then PHOTO. No schema change.
- **Plain `<img>` instead of `next/image`** for evidence photos: presigned URLs rotate
  their query string each fetch, defeating the optimizer and its cache; also avoids the
  missing `remotePatterns` config entirely.
- **Pagination via `page`/`limit` + `total` in the response**, not infinite scroll — keeps
  the fetch model simple and gives the "N evidencias · filtros activos" count for free.
- **Debounce (300 ms) + AbortController** in the page's fetch effect; latest response wins.
- **Stats become an inline summary strip** beside the header (counts computed over the
  filtered result set, labeled "de N filtradas"), replacing the banned 5-card hero row.
- **Vertical slices**: each phase leaves the page working; API contract changes land first
  and stay additive so the old page keeps rendering between tasks.

---

## Task 1: Truthful evidence payload — real media type, real step title, TEXT content

**Description:** The API currently fabricates its data: every row claims `type: "PHOTO"`,
`stepName` is a raw step ID, and TEXT content is unreachable. Select `title`, `type`,
and `value` from `workflowInstanceSteps` (columns already exist), derive the real media
type from the URL extension with fallbacks, return human titles, and add a `textContent`
field sourced from `value` for text evidence.

**Acceptance criteria:**
- [ ] Media type derived from URL extension: `.mp4/.mov/.webm` → VIDEO; `.mp3/.wav/.ogg/.m4a/.aac` → AUDIO; image extensions → PHOTO
- [ ] Fallback chain when no/unknown extension: frozen `type` column → `"PHOTO"`
- [ ] `stepName` returns `COALESCE(title, stepId)` — never a bare UUID when a title exists
- [ ] Response rows include optional `textContent` (from `value` jsonb) populated when type resolves to TEXT
- [ ] Existing fields unchanged (`data[]` shape stays additive)

**Verification:**
- [ ] Build succeeds: `pnpm run build`
- [ ] Manual check via dev server + curl: seed/demo data shows at least one non-PHOTO type or title fallback working

**Dependencies:** None

**Files likely touched:**
- `app/api/workflows/evidence/route.ts`
- `lib/storage/scoped-evidence.ts` (small pure helper for extension→type, exported for testability)

**Estimated scope:** Small (1–2 files)

---

## Task 2: Filter parity + pagination + branch filter + date guard

**Description:** Honor every param the UI already sends (`type`, `verified`) plus new
`branchId`, `page`, `limit`. Add a `dateFrom ≤ dateTo` guard, replace the hard
`.limit(200)` with real pagination, and include `total` so the client can show counts.

**Acceptance criteria:**
- [ ] `type` param filters on the derived media type (SQL-level where possible; post-filter acceptable given derived types)
- [ ] `verified=true/false` filters on `aiAnalysis.passed` (jsonb)
- [ ] `branchId` param filters by `workflowInstances.branchId`
- [ ] `dateFrom > dateTo` returns empty result set or 400 — never an inverted silent range
- [ ] `page`/`limit` params supported (default limit ~24); response includes `total`
- [ ] Tenant scoping untouched (companyId condition preserved)

**Verification:**
- [ ] Build succeeds: `pnpm run build`
- [ ] Manual check: `?verified=false`, `?type=AUDIO`, `?branchId=…&page=2` each change results; `total` reflects filtered set

**Dependencies:** Task 1 (type derivation)

**Files likely touched:**
- `app/api/workflows/evidence/route.ts`

**Estimated scope:** Small (1 file, but query-logic dense)

---

### Checkpoint: Foundation

- [ ] curl against dev server confirms derived types, titles, `total`, `branchId` filtering
- [ ] Old page still renders (additive contract) — `pnpm run dev` smoke pass

---

## Task 3: Client fetch hardening — debounce, abort, retry, skeleton, count

**Description:** Search fires one fetch per keystroke with no abort, so stale responses
can overwrite fresh ones — fatal credibility for a compliance tool. Move fetching into a
debounced effect with AbortController, show a skeleton grid instead of a layout-jumping
spinner, add a retry affordance on error, and surface a result count.

**Acceptance criteria:**
- [ ] Search input debounced 300 ms; changing selects/dates fetches immediately
- [ ] AbortController cancels superseded requests; only the latest response sets state
- [ ] Loading state renders a skeleton grid/list holding layout position (no spinner swap)
- [ ] Error state offers "Reintentar" button instead of toast-only failure
- [ ] Result count shown near gallery header, e.g. "N evidencias · filtros activos", using API `total`
- [ ] Pagination controls (prev/next + page indicator) wired to `page`/`limit`/`total`

**Verification:**
- [ ] Build succeeds: `pnpm run build`
- [ ] Manual check: type quickly → single request in network tab after pause; throttle network → retry works

**Dependencies:** Task 2 (`total`, pagination params)

**Files likely touched:**
- `app/dashboard/evidence/page.tsx`
- possibly `hooks/use-debounced-value.ts` if no equivalent hook exists

**Estimated scope:** Medium (2–3 files)

---

## Task 4: Accessibility P0 — keyboard-openable cards, labeled inputs, aria-labels

**Description:** Cards and list rows are `<div onClick>` — keyboard and screen-reader
users cannot open any evidence. Filter labels aren't associated with inputs; the list Eye
button is icon-only. Make the primary action accessible.

**Acceptance criteria:**
- [ ] Grid cards and list rows render as `<button>` (full-width reset styling) or `role="button"` + `tabIndex=0` + Enter/Space handlers
- [ ] Visible focus ring on all interactive elements (`focus-visible:` utilities)
- [ ] Every filter uses `components/ui/label` with matching `htmlFor`/`id`
- [ ] Eye button gets `aria-label="Ver evidencia"` (or becomes redundant once row is a button — then remove it)
- [ ] Dialog traps focus correctly (Radix default) and closes on Escape

**Verification:**
- [ ] Build succeeds: `pnpm run build`
- [ ] Manual keyboard-only pass: Tab through filters → open evidence via Enter → close via Escape → switch view mode

**Dependencies:** None strictly; do after Task 3 to avoid same-file churn

**Files likely touched:**
- `app/dashboard/evidence/page.tsx`

**Estimated scope:** Small–Medium (1 file)

---

### Checkpoint: Hardening

- [ ] Keyboard-only walkthrough passes end-to-end
- [ ] Rapid typing produces exactly one in-flight request; stale responses discarded
- [ ] No layout jump during loading

---

## Task 5: Re-tokenize visuals + collapse stat row into summary strip

**Description:** Replace stock Tailwind palette with Pulso OKLCH tokens, delete banned
card shadows, and demote the five hero-metric stat cards into a compact inline summary
strip beside the header. Mapping per critique: PHOTO→info, VIDEO→chart/accent token,
AUDIO→warning, TEXT→muted, verification→success.

**Acceptance criteria:**
- [ ] Zero stock-palette classes remain (`blue-*`, `purple-*`, `orange-*`, `green-500`, `gray-*` replaced by info/chart/warning/muted/success tokens)
- [ ] `hover:shadow-lg transition-shadow` removed; hover = border/background tonal shift per Flat-By-Default rule
- [ ] Five stat cards replaced by one compact strip: total · fotos · videos · audios · verificadas, labeled to reflect they describe the filtered set ("de N filtradas")
- [ ] View-mode toggle uses lighter control (ToggleGroup or ghost segmented buttons), not two full Buttons
- [ ] Dark mode remains coherent (tokens handle it)

**Verification:**
- [ ] Build succeeds: `pnpm run build`
- [ ] Manual check against DESIGN.md: no shadows, no hero-metric row, warm palette throughout

**Dependencies:** Task 4 (same file; avoids edit conflicts)

**Files likely touched:**
- `app/dashboard/evidence/page.tsx`

**Estimated scope:** Medium (1 file, broad diff)

---

## Task 6: Trust controls — download, Eye wiring, TEXT rendering, fallbacks, score 0

**Description:** Ship the promises the UI makes: "Descargar" actually downloads, TEXT
evidence shows its content (not the storage URL), broken images degrade gracefully, and
a failed AI verification (score 0) renders instead of disappearing.

**Acceptance criteria:**
- [ ] Descargar renders as `<a href={url} download>` (presigned URL) — file saves; for legacy http URLs opens in new tab as fallback
- [ ] List-view Eye either opens the dialog (wired) or is removed in favor of the now-focusable row (Task 4 decision)
- [ ] TEXT evidence in dialog renders `textContent` (Task 1 field), not `url`
- [ ] Photo tiles/dialog show fallback UI (icon + "No disponible") on image error
- [ ] Audio evidence gets a compact player row instead of sitting inside an `aspect-video` muted box
- [ ] `aiScore` displays whenever present including `0`; unverified badge distinguishes pending vs failed using `aiReason` presence

**Verification:**
- [ ] Build succeeds: `pnpm run build`
- [ ] Manual check: download a seeded photo; open a TEXT evidence; break one image URL (devtools) → fallback appears

**Dependencies:** Tasks 1 (textContent), 4 (row/button semantics), 5 (token classes)

**Files likely touched:**
- `app/dashboard/evidence/page.tsx`

**Estimated scope:** Medium (1–2 files)

---

## Task 7: Branch dimension — Sucursal filter, card caption, list column

**Description:** The primary persona (owner of 3–15 branches) asks "which branch is
behind on evidence?" — answer it. Fetch `/api/branches` for the dropdown (API support
landed in Task 2), and make branch visible everywhere evidence is listed.

**Acceptance criteria:**
- [ ] "Sucursal" select in filter bar fed by `GET /api/branches`, scoped to tenant
- [ ] Branch name shown as caption on grid cards and as a column/segment in list view
- [ ] Detail dialog already shows sucursal — keep consistent naming
- [ ] Filter combines correctly with existing filters (AND semantics verified)
- [ ] Stretch (optional): group-by-sucursal sections in list mode

**Verification:**
- [ ] Build succeeds: `pnpm run build`
- [ ] Manual check: pick one branch → only its evidence appears; captions match selection

**Dependencies:** Tasks 2 (API branchId), 5 (layout/tokens settled)

**Files likely touched:**
- `app/dashboard/evidence/page.tsx`

**Estimated scope:** Medium (1–2 files)

---

## Task 8: Language & labels polish

**Description:** Close the copy drift: Spanish labels for media types, sane initials,
self-explanatory AI badge, and the small consistency items from the critique's minor list.

**Acceptance criteria:**
- [ ] Type label map: PHOTO→Foto, VIDEO→Video, AUDIO→Audio, TEXT→Texto (chips + filters + dialog)
- [ ] Initials take the first two words only ("María De La O" → "MD"; single names don't crash)
- [ ] Green badge reads "Verificada por IA" (compact variant on cards, tooltip with score)
- [ ] `h1` gets `tracking-tight` matching sibling pages
- [ ] Empty state embeds a "Limpiar filtros" button inline

**Verification:**
- [ ] Build succeeds: `pnpm run build`; `pnpm run lint` clean
- [ ] Manual read-through: zero raw enum leaks in UI

**Dependencies:** Tasks 5–7 (final pass over same file)

**Files likely touched:**
- `app/dashboard/evidence/page.tsx`

**Estimated scope:** Small (1 file)

---

### Checkpoint: Complete

- [ ] All acceptance criteria across tasks met
- [ ] `pnpm run build` && `pnpm run lint` clean
- [ ] DESIGN.md review: flat surfaces, OKLCH tokens only, no hero-metric row, Operational Red discipline intact
- [ ] Critique re-run target: ≥30/40 (from 18/40)

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Media-type inference misclassifies legacy seed URLs | Low | Fallback chain: extension → frozen `type` column → PHOTO |
| Presigned URLs expire while user idles (10-min TTL) | Med | Known behavior; document; images refetch on next page load |
| Pagination changes response shape breaks other consumers | Low | Route consumed only by this page today; verify with grep before merging; keep `data` key intact |
| `strict: false` hides type regressions | Med | Per-task manual verification + build gate |
| Scope creep toward bulk actions / sort (heuristic #7) | Med | Explicitly deferred — see Open Questions |

## Open Questions

- Bulk actions and sort controls (critique heuristic #7 scored 1/4): separate follow-up plan, or fold in later?
- List-mode "group by sucursal": stretch goal inside Task 7, or deferred?
- Should WhatsApp-originated evidence carry a channel mark? Provenance data doesn't appear
  to exist yet in `workflowInstanceSteps` — would need upstream work first.
