---
npm/ab-test-block: patch
---

Changed: unified the editor and toolbar wording around Assignment label, Quick summary, Diagnostics, and Front-end output so the block settings are easier to understand.

Fixed: hardened `dom-prune` rendering so the front end never falls back to rendering every variant when the requested variant cannot be found.

Added: malformed `dom-prune` smoke coverage to verify that only one variant is emitted into front-end HTML and that fallback rendering stays safe.
