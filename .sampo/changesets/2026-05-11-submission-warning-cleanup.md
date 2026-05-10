---
npm/ab-test-block: patch
---

Changed: added a staged submission `Plugin Check` workflow so contributor validation now runs against the actual WordPress.org payload instead of the repo root.

Changed: reorganized preview query parsing, packaging metadata, and render internals to better match WordPress plugin submission expectations without changing runtime experiment behavior.

Fixed: reduced submission-facing packaging and database query issues so the shipped plugin payload now passes `Plugin Check` without errors.
