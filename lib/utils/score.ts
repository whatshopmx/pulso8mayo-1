/**
 * Score-to-color mapping, shared across every surface that shows a workflow
 * score so the semantics stay identical (the thresholds the reviewer trains
 * on daily). Token-based; never raw Tailwind palette classes.
 *
 *  ≥90 → success (green)   ·   ≥70 → warning-text (amber)   ·   else → destructive (red)
 *  null → muted (no score yet)
 */
export function scoreColorClass(score: number | null): string {
  if (score === null) return "text-muted-foreground";
  if (score >= 90) return "text-success font-bold";
  if (score >= 70) return "text-warning-text font-bold";
  return "text-destructive font-bold";
}