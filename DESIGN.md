---
name: Pulso HORECA
description: Plataforma de gestión operativa y cumplimiento normativo para cadenas HORECA
colors:
  primary: "oklch(0.52 0.17 25)"
  primary-foreground: "oklch(0.99 0 0)"
  secondary: "oklch(0.96 0.01 85)"
  secondary-foreground: "oklch(0.30 0.03 25)"
  accent: "oklch(0.94 0.04 30)"
  accent-foreground: "oklch(0.35 0.12 25)"
  background: "oklch(1 0 0)"
  foreground: "oklch(0.16 0.01 30)"
  muted: "oklch(0.965 0.005 85)"
  muted-foreground: "oklch(0.50 0.01 85)"
  border: "oklch(0.91 0.01 85)"
  success: "oklch(0.60 0.16 150)"
  warning: "oklch(0.72 0.15 80)"
  info: "oklch(0.52 0.10 245)"
  destructive: "oklch(0.50 0.22 22)"
  sidebar-bg: "oklch(0.985 0.003 85)"
  sidebar-fg: "oklch(0.16 0.01 30)"
  chart-1: "oklch(0.58 0.18 25)"
  chart-2: "oklch(0.62 0.16 70)"
  chart-3: "oklch(0.55 0.10 160)"
  chart-4: "oklch(0.52 0.08 240)"
  chart-5: "oklch(0.56 0.15 0)"
typography:
  display:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "clamp(1.5rem, 4vw, 3rem)"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "clamp(1.25rem, 3vw, 1.875rem)"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "clamp(1rem, 2vw, 1.25rem)"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.01em"
  mono:
    fontFamily: "Geist Mono, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: "0.25rem"
  md: "0.375rem"
  lg: "0.625rem"
  xl: "0.75rem"
  2xl: "1rem"
  3xl: "1.25rem"
  4xl: "1.5rem"
spacing:
  xs: "0.25rem"
  sm: "0.5rem"
  md: "1rem"
  lg: "1.5rem"
  xl: "2rem"
  2xl: "3rem"
  3xl: "4rem"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.md}"
    padding: "0.5rem 1rem"
    typography: "{typography.label}"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "0.5rem 1rem"
    typography: "{typography.label}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "0.5rem 1rem"
    typography: "{typography.label}"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.card-foreground}"
    rounded: "{rounded.lg}"
    padding: "1.5rem"
  input:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "0.5rem 0.75rem"
  sidebar:
    backgroundColor: "{colors.sidebar-bg}"
    textColor: "{colors.sidebar-fg}"
    rounded: "{rounded.md}"
---

# Design System: Pulso HORECA

## 1. Overview

**Creative North Star: "The Command Center"**

Pulso is the command center for Mexican restaurant groups with 3 to 15 branches. Every screen gives the owner a clear view of what's happening across all locations — compliance status, inventory levels, labor costs, and active workflows — with the authority to act from one place. The interface is confident without being bureaucratic, operational without being cold.

This system explicitly rejects anything that feels like a government compliance portal (heavy borders, dense tables, institutional gray) or a generic SaaS tool. Compliance is a byproduct of good daily operations, not the identity of the product. The design is purpose-built for HORECA — familiar to someone who runs restaurants, not someone who runs Jira.

**Key Characteristics:**
- Flat with tonal layering — depth comes from surface relationships, not shadows
- Tactile and confident — buttons and inputs respond with satisfying feedback
- Operational at every pixel — nothing decorative, every element serves a real purpose
- Dark/light mode with full OKLCH palette
- WhatsApp is a first-class interface, not an add-on

## 2. Colors

The palette is anchored by Operational Red — a deep, confident crimson that commands attention without shouting. Neutrals carry a subtle warmth toward the red hue (chroma 0.005–0.01 at hue 85), avoiding the sterile gray of generic enterprise software.

### Primary
- **Operational Red** (`oklch(0.52 0.17 25)`): The brand anchor. Used for primary actions, active navigation states, key metrics, and the logo. Never decorative — every appearance signals something actionable or important.
- **Operational Red Foreground** (`oklch(0.99 0 0)`): White text on red surfaces. High contrast, always readable.

### Secondary
- **Warm Off-White** (`oklch(0.96 0.01 85)`): Secondary surfaces, subtle backgrounds, hover states on light mode.
- **Deep Warm** (`oklch(0.30 0.03 25)`): Text on secondary surfaces.

### Accent
- **Warm Pink** (`oklch(0.94 0.04 30)`): Subtle accent surfaces, hover highlights, secondary emphasis.
- **Deep Rose** (`oklch(0.35 0.12 25)`): Text on accent surfaces.

### Neutral
- **White** (`oklch(1 0 0)`): Page background, card surfaces in light mode.
- **Near-Black** (`oklch(0.16 0.01 30)`): Primary body text. Slight warmth (hue 30) keeps it from feeling harsh.
- **Muted** (`oklch(0.965 0.005 85)`): Subtle background tint for secondary surfaces.
- **Muted Foreground** (`oklch(0.50 0.01 85)`): Secondary text, metadata, placeholders.
- **Border** (`oklch(0.91 0.01 85)`): Subtle dividers and input strokes.

### Semantic
- **Success Green** (`oklch(0.60 0.16 150)`): Completed tasks, positive metrics, approval states.
- **Warning Amber** (`oklch(0.72 0.15 80)`): Pending items, medium-priority alerts.
- **Info Blue** (`oklch(0.52 0.10 245)`): Informational indicators, help text.
- **Destructive Red** (`oklch(0.50 0.22 22)`): Errors, deletions, critical failures.

### Named Rules
**The One Voice Rule.** Operational Red is used on at most 10-15% of any given screen. Its rarity is the point — when red appears, it means something.

**The Flat-By-Default Rule.** Surfaces are flat at rest. Depth is conveyed through tonal layering (lighter/darker backgrounds), not shadows. Shadows appear only as a response to interaction.

## 3. Typography

**Display & Body Font:** Geist (with system-ui, sans-serif fallback)
**Mono Font:** Geist Mono (with monospace fallback)

**Character:** A single geometric sans-serif family across the entire system. Geist is clean, precise, and slightly condensed — it reads well at small sizes in dense data tables and scales confidently to headings. The single-family approach reinforces the "one platform, one truth" principle: no decorative flourishes, no hierarchy confusion.

### Hierarchy
- **Display** (700, clamp(1.5rem, 4vw, 3rem), 1.1, -0.02em): Page titles and section headers. Used sparingly — typically once per page.
- **Headline** (600, clamp(1.25rem, 3vw, 1.875rem), 1.2, -0.01em): Card titles, section headings within a page.
- **Title** (600, clamp(1rem, 2vw, 1.25rem), 1.3): Subsection headers, sidebar items, dialog titles.
- **Body** (400, 0.875rem, 1.5): Primary reading text, table cells, descriptions. Max line length 70ch.
- **Label** (500, 0.75rem, 1.4, 0.01em): Button text, form labels, badges, small metadata.
- **Mono** (400, 0.8125rem, 1.5): Code blocks, IDs, timestamps, numeric data in tables.

### Named Rules
**The No-Orphan Rule.** Body text uses `text-wrap: pretty` to prevent single-word orphans. Headlines use `text-wrap: balance` for even line lengths.

**The Label-Floor Rule.** Label (12px / `text-xs`) is the smallest size in the system. There is no 9px, 10px or 11px step: those values were an undocumented sub-ramp that made the type scale punch through its own floor, and they are unreadable at arm's length on a tablet in a kitchen. Micro-metadata, helper text and glyph badges all sit at Label; separation comes from weight and color, not from shrinking below the floor.

## 4. Elevation

The system is flat by default. Depth is conveyed through tonal layering — lighter or darker surface backgrounds create hierarchy without shadows. This keeps the interface clean, fast, and focused on content rather than decoration.

### Shadow Vocabulary
No shadow vocabulary. The system uses tonal layering exclusively:
- **Page background** (`--background`): The base layer.
- **Card / surface** (`--card`): One step up from background (white on light mode, slightly lighter on dark mode).
- **Sidebar** (`--sidebar`): A distinct tonal layer, visually separated from the main content area.
- **Modal / dialog** (`--popover`): The highest tonal layer, with a backdrop overlay.

### Named Rules
**The Flat-By-Default Rule.** Surfaces are flat at rest. No box-shadows on cards, dropdowns, or containers. Interactive elements (buttons, inputs) use background color changes and border shifts for feedback, not shadows.

## 5. Components

### Buttons
- **Shape:** Gently rounded corners (6px / 0.375rem).
- **Primary:** Operational Red background, white text, 8px 16px padding. Label typography (500 weight, 0.75rem).
- **Hover:** Darken the red by increasing saturation slightly. Transition: 150ms ease.
- **Focus:** Ring outline in Operational Red at 40% opacity (2px offset).
- **Active:** Slightly darker background, no transform shift.
- **Outline:** Transparent background, 1px border in `--border`, foreground text. Hover fills with muted background.
- **Ghost:** Transparent background, foreground text. Hover fills with muted background. No border.
- **Size variants:** `sm` (6px 10px), default (8px 16px), `lg` (12px 24px), `icon` (36x36px square).

### Cards
- **Corner Style:** Rounded (10px / 0.625rem).
- **Background:** White in light mode, slightly lighter than page bg in dark mode.
- **Shadow Strategy:** None — flat by default. Tonal separation from the page background provides depth.
- **Border:** 1px solid `--border` for definition.
- **Internal Padding:** 24px (1.5rem) default.

### Inputs / Fields
- **Style:** 1px solid `--border` stroke, white background, 6px radius.
- **Focus:** Border shifts to Operational Red with a subtle ring glow (ring color at 40% opacity).
- **Error:** Border shifts to Destructive Red. Error message appears below in Destructive Red at body size.
- **Disabled:** Muted background, muted foreground, reduced opacity.
- **Padding:** 8px 12px (0.5rem 0.75rem).

### Navigation (Sidebar)
- **Style:** Flat panel with its own tonal background (`--sidebar`). No shadow, no border-right — tonal separation from the main content area.
- **Typography:** Title weight for section headers, body weight for items.
- **Default:** Foreground color at full opacity.
- **Hover:** Accent background tint.
- **Active:** Operational Red text or background indicator (pill highlight).
- **Mobile:** Collapsible via sidebar trigger. Overlay on small screens with backdrop.

### Badges
- **Style:** Small pill shape (full rounding), 6px 10px padding, label typography.
- **Variants:** One per semantic color (success green, warning amber, info blue, destructive red, plus neutral/default).
- **Use:** Status indicators, counts, tags.

### Tables
- **Style:** Clean, minimal. No vertical borders. Horizontal dividers in `--border` between rows.
- **Header:** Muted background, label typography (500 weight, uppercase tracking optional).
- **Rows:** Alternating backgrounds optional (every other row gets muted tint). Hover highlights row with accent tint.
- **Cells:** Body typography. Numeric cells right-aligned with mono font option.

## 6. Do's and Don'ts

### Do:
- **Do** use Operational Red sparingly — at most 10-15% of any screen. Its rarity signals importance.
- **Do** use tonal layering for depth instead of shadows. A card sits one step above the page background.
- **Do** keep tables clean: horizontal dividers only, no vertical borders, hover highlight on rows.
- **Do** use Geist consistently across the entire system. One family, no mixing.
- **Do** make compliance information feel operational, not bureaucratic. Present it as a dashboard metric, not a form.
- **Do** design for the owner overseeing 15 branches first — the dashboard is the command center.

### Don't:
- **Don't** use shadows on cards, containers, or the sidebar. The system is flat by default.
- **Don't** use border-left or border-right greater than 1px as a colored accent stripe. Use full borders, background tints, or nothing.
- **Don't** use gradient text (`background-clip: text` with a gradient). Use solid colors. Emphasis via weight or size.
- **Don't** make the interface feel bureaucratic or government-like. No heavy borders, no dense tables with tiny type, no institutional gray.
- **Don't** use glassmorphism (blurred backgrounds with transparency) as a default pattern.
- **Don't** use the hero-metric template (big number, small label, supporting stats) as a default layout pattern.
- **Don't** use tiny uppercase tracked eyebrow text above every section. One deliberate kicker is voice; an eyebrow on every section is a tell.
- **Don't** use numbered section markers (01 / 02 / 03) as default scaffolding.
- **Don't** let text overflow its container. Test heading copy at every breakpoint.
