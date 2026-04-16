---
npm/ab-test-block: minor
---

Changed: `Compare variants` now keeps the active Variant as a decision-oriented baseline with changed-only cards, compact review badges, and direct `Edit Variant X` / `Sync structure now` actions.

Changed: structure differences in `Compare variants` are now summarized as changed blocks only, including added, extra, reordered, and nested structure hints instead of repeating the full block tree.

Changed: compare CTA and winner-state summaries now use the same explicit / fallback / no-CTA and manual / candidate / locked / winner-preview vocabulary shown elsewhere in the editor.

Added: stronger editor smoke coverage for compare no-diff states, changed-block summaries, CTA transitions, decision badges, and compare-driven edit / sync flows.
