---
npm/ab-test-block: patch
---

Changed: the front end now defaults to `dom-prune`, so only the active variant is rendered into the live HTML unless a block is explicitly switched to `CSS hide` mode for compatibility.

Changed: sticky assignment is now cookie-first, with a one-release migration path that promotes existing browser `localStorage` assignments into first-party cookies.

Added: a shared runtime label toggle for both the editor and front end, plus new front-end rendering controls in the inspector and block toolbar.
