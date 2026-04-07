---
npm/ab-test-block: patch
---

Changed: made the Assignment label copy more readable so editor and front-end previews explain why a variant is showing instead of exposing raw internal source names.

Added: the editor Diagnostics panel now explains when malformed saved content would make `Only render chosen variant` fall back to the first available variant until the post is saved again.

Fixed: stabilized the legacy sticky migration smoke for CI and promoted a stable front-end visual parity baseline into the CI workflow.
