---
npm/ab-test-block: minor
---

Added: a manual `Sync structure from active variant` authoring action so editors can align the block tree across Variants without overwriting matching copy.

Changed: structure sync now preserves matching target content where block type and sibling order still line up, while filling missing blocks from the active Variant and removing extra blocks from target Variants.

Added: editor smoke coverage for A/B and A/B/C structure sync, including add, reorder, and no-op sync flows.  
