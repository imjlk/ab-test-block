# ab-test-block

## 0.4.0 — 2026-04-16

### Minor changes

- [46ff085](https://github.com/imjlk/ab-test-block/commit/46ff085c6969e932d28c10ac85f498e4cf703c80) Added: a manual `Sync structure from active variant` authoring action so editors can align the block tree across Variants without overwriting matching copy.
  
  Changed: structure sync now preserves matching target content where block type and sibling order still line up, while filling missing blocks from the active Variant and removing extra blocks from target Variants.
  
  Added: editor smoke coverage for A/B and A/B/C structure sync, including add, reorder, and no-op sync flows. — Thanks @imjlk!
- [d3ac240](https://github.com/imjlk/ab-test-block/commit/d3ac2407b4507b9cc40d325518f695f435c8cc42) Changed: `Compare variants` now keeps the active Variant as a decision-oriented baseline with changed-only cards, compact review badges, and direct `Edit Variant X` / `Sync structure now` actions.
  
  Changed: structure differences in `Compare variants` are now summarized as changed blocks only, including added, extra, reordered, and nested structure hints instead of repeating the full block tree.
  
  Changed: compare CTA and winner-state summaries now use the same explicit / fallback / no-CTA and manual / candidate / locked / winner-preview vocabulary shown elsewhere in the editor.
  
  Added: stronger editor smoke coverage for compare no-diff states, changed-block summaries, CTA transitions, decision badges, and compare-driven edit / sync flows. — Thanks @imjlk!

## 0.3.4 — 2026-04-07

### Patch changes

- [74df8a6](https://github.com/imjlk/ab-test-block/commit/74df8a6ed2ce7bf46fd2e0a6181ca3f074024449) Changed: made the Assignment label copy more readable so editor and front-end previews explain why a variant is showing instead of exposing raw internal source names.
  
  Added: the editor Diagnostics panel now explains when malformed saved content would make `Only render chosen variant` fall back to the first available variant until the post is saved again.
  
  Fixed: stabilized the legacy sticky migration smoke for CI and promoted a stable front-end visual parity baseline into the CI workflow. — Thanks @imjlk!
- [2fe0551](https://github.com/imjlk/ab-test-block/commit/2fe0551a3d332a9007d06c563583dd2516b7b4d6) Changed: unified the editor and toolbar wording around Assignment label, Quick summary, Diagnostics, and Front-end output so the block settings are easier to understand.
  
  Fixed: hardened `dom-prune` rendering so the front end never falls back to rendering every variant when the requested variant cannot be found.
  
  Added: malformed `dom-prune` smoke coverage to verify that only one variant is emitted into front-end HTML and that fallback rendering stays safe. — Thanks @imjlk!

## 0.3.3 — 2026-04-07

### Patch changes

- [206fdd0](https://github.com/imjlk/ab-test-block/commit/206fdd0bcd7b934d44d45b6efba7c98c6390bec9) Changed: the front end now defaults to `dom-prune`, so only the active variant is rendered into the live HTML unless a block is explicitly switched to `CSS hide` mode for compatibility.
  
  Changed: sticky assignment is now cookie-first, with a one-release migration path that promotes existing browser `localStorage` assignments into first-party cookies.
  
  Added: a shared runtime label toggle for both the editor and front end, plus new front-end rendering controls in the inspector and block toolbar. — Thanks @imjlk!
- [b8efa72](https://github.com/imjlk/ab-test-block/commit/b8efa729e1b4db911221e650de5b404c3918a9f0) Changed: finalized the Block Directory submission polish by unifying the canonical A/B demo fixture across block examples, Playground content, and WordPress.org screenshots.
  
  Added: local visual parity baselines and screenshot sync tooling so editor and front-end presentation can stay aligned as the block evolves.
  
  Changed: polished editor copy and toolbar accessibility cues without changing tracking semantics or public APIs. — Thanks @imjlk!

## 0.3.2 — 2026-04-03

### Patch changes

- [7213848](https://github.com/imjlk/ab-test-block/commit/721384829fff0732f8bd22131106626f45e8ff1b) Polish the plugin for WordPress Block Directory submission by tightening the
  plugin metadata, preserving curated inserter examples during type sync, and
  adding WordPress.org-facing screenshots and assets. — Thanks @imjlk!

## 0.3.1 — 2026-04-02

### Patch changes

- [d83acac](https://github.com/imjlk/ab-test-block/commit/d83acac129b7347ca17c30d113b0c3dc078925a8) Improves the editor-side operating experience for A/B test experiments.
  
  - refines the Debug panel into clearer current-state and stats sections
  - documents the split core/editor/full smoke test modes for contributors
  - adds a Copy ID action for the advanced Experiment ID field without unlocking editing — Thanks @imjlk!

## 0.3.0 — 2026-04-02

### Minor changes

- [299e920](https://github.com/imjlk/ab-test-block/commit/299e92035e8f7574963b2b4e98ddc641afc87bf2) Added editor-visible stats, browser stats events, and a documented sticky scope model for instance- and experiment-level assignment behavior. — Thanks @imjlk!

## 0.2.1 — 2026-04-01

### Added

- [a14d1a2](https://github.com/imjlk/ab-test-block/commit/a14d1a2930bf487846dd4d474dcebefe1c03e47f) Add GitHub Actions release automation, a Sampo-based release PR workflow, and version syncing for WordPress plugin metadata files. — Thanks @imjlk!

