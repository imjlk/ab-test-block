# A/B Test Block

Block Directory-ready Gutenberg block plugin for running A/B and A/B/C content experiments directly inside the editor.

## What It Includes

-   One top-level `A/B Test` block plus an internal `Variant` child block
-   A/B or A/B/C authoring with fixed variant slots
-   Weighted delivery, sticky assignment, query-string preview overrides
-   Sticky assignment scoped either to this page/block or to a shared experiment ID
-   Manual winner and CTR-based automatic winner
-   Viewable impression and primary CTA click aggregation through REST + custom table
-   Browser event, `window.kexpLayer`, `window.dataLayer`, and Clarity hook outputs
-   Server stats surfaced back into the editor Debug panel

## Tracking Semantics

-   `impression` means the active variant stays at least 50% visible for 1 second.
-   `click` means the first primary CTA click for the block on the current page.
-   `abtest_stats` / `abtest:stats` carry saved aggregate stats after counted events.
-   Mark a CTA explicitly with the Additional CSS class `abtest-cta`.
-   For custom markup, use the `data-abtest-cta` attribute instead.
-   If no CTA marker exists inside the active variant, links and buttons fall back automatically.

## Experiment Identity

-   A single block instance is identified by `postId + blockInstanceId`.
-   `experimentId` is the logical experiment key and may be reused across multiple posts or pages.
-   The default sticky identity is browser `localStorage`, not cookies or logged-in user identity.
-   Default sticky scope is the current page/block instance.
-   Optional shared-experiment sticky uses the key `abtest-exp:{experimentId}`.
-   Server-side stats are aggregate only. Individual browser sticky assignments are not readable from the server.
-   Future CLI/reporting work should support both per-instance inspection and cross-post aggregation by `experimentId`.

## REST and Debug Surface

-   `GET /wp-json/abtest-block/v1/stats` returns both `instance` and `experiment` snapshots.
-   `POST /wp-json/abtest-block/v1/event` and `POST /wp-json/abtest-block/v1/reevaluate` both return the latest stats snapshot.
-   The editor Debug panel shows `This block` and `This experiment` cards with impressions, clicks, CTR, and last update time.

## Operations

-   `wp abtest-block experiments --format=table|json [--limit=<n>]` lists tracked experiments with aggregate counts and last update time.
-   `wp abtest-block stats --post=<id> --block-instance=<id>` shows the current block-instance snapshot.
-   `wp abtest-block stats --experiment=<id>` shows the shared experiment aggregate snapshot.
-   `wp abtest-block winner-state --post=<id> --block-instance=<id> --format=json` shows the stored winner snapshot for one block instance.
-   `define( 'AB_TEST_BLOCK_DISABLE_TRACKING', true );` disables new tracking writes and browser-layer emits site-wide while keeping saved stats readable.
-   Advanced installations can also short-circuit tracking through the `ab_test_block_tracking_enabled` filter.

## WordPress Playground

-   Open the latest `main` build in Playground: [Open in Playground](https://playground.wordpress.net/?blueprint-url=https%3A%2F%2Fraw.githubusercontent.com%2Fimjlk%2Fab-test-block%2Fplayground-build%2F.wordpress-org%2Fblueprints%2Fgithub-blueprint.json)
-   That README link uses the generated `playground-build` branch, which is refreshed from `main` and serves the current built plugin zip plus blueprint.
-   `bun run playground:sync` regenerates the tracked blueprint files under `.wordpress-org/blueprints/`.
-   `bun run playground:preview-link` prints the raw `playground-build` blueprint URL and the matching Playground link for the current repository remote.
-   `.wordpress-org/blueprints/blueprint.json` is the WordPress.org preview blueprint that is meant to land in the plugin SVN assets path as `assets/blueprints/blueprint.json`.
-   `bun run wordpress-org:copy-assets -- --target=/path/to/svn/assets` copies `.wordpress-org/*` into the exact SVN assets layout for future deployment automation.
-   Pull requests from this repository get a Playground preview button in the PR description with the current branch build installed.

## Development

```bash
bun install
bun run start
```

## Validation

```bash
bun run typecheck
bun run lint
bun run build
```

Recommended local loop:

```bash
bun run build
bun run smoke:e2e:editor
bun run visual:e2e:check
```

## Smoke Modes

-   `bun run smoke:e2e:core` checks front-end render, one active variant, `abtest_impression` / `abtest_stats`, and sticky assignment for both `instance` and `experiment` scopes.
-   `bun run smoke:e2e:editor` focuses on editor regressions such as parent selection retention, toolbar variant switching, visible variant persistence, block add/remove, and Debug panel visibility.
-   `bun run smoke:e2e` runs the full suite by combining `core` and `editor`.
-   GitHub Actions only hard-asserts `smoke:e2e:core`.
-   The editor smoke keeps the `Identity & Preview` panel `Experiment ID` toggle as a best-effort check so sidebar DOM changes do not make CI flaky.
-   CI also runs a clean zip-install smoke that installs `ab-test-block.zip` into a fresh WordPress environment before checking routes and front-end render.

## Visual QA

-   `bun run visual:e2e:update` refreshes the repo-tracked Playwright baseline screenshots for the canonical parity fixture.
-   `bun run visual:e2e:check` recaptures the same fixture locally and compares it against the committed baselines.
-   `bun run wordpress-org:sync-screenshots` copies the current front/editor parity baselines into `.wordpress-org/screenshot-1.png` and `.wordpress-org/screenshot-2.png`.
-   The current baseline set covers:
    -   front `Variant A`
    -   front `Variant B`
    -   editor with the parent block selected
    -   editor with a child variant selected
-   This suite is local-first for now so we can stabilize screenshot noise before promoting any subset into CI.

## Local WordPress Validation

```bash
bun run env:start
```

The local site runs at `http://localhost:8890/wp-admin` with username `admin` and password `password`.

Suggested smoke-test loop:

1. Insert the `A/B Test` block in a new post.
2. Confirm A/B variants are created automatically and `Variant` is hidden from the inserter.
3. Add and remove Variant C, adjust weights, save, reload, and confirm there is no invalid block warning.
4. Preview with both `?abtest=experiment_id:b` and the block-specific preview key.
5. Confirm frontend assignment, sticky behavior, viewable impressions, and CTA click tracking on a published post.

Stop or reset the environment with:

```bash
bun run env:stop
bun run env:destroy
```

## Packaging

```bash
bun run plugin-zip
bun run playground:sync
```

This generates a submission-ready zip that includes the built plugin files under the `ab-test-block` root folder.

The Playground blueprint sync keeps these repo-tracked files up to date:

-   `.wordpress-org/blueprints/blueprint.json`
-   `.wordpress-org/blueprints/github-blueprint.json`

For future WordPress.org deployment automation, copy the tracked assets into an SVN checkout with:

```bash
bun run wordpress-org:copy-assets -- --target=/path/to/plugin-svn/assets
```

## Code Structure

-   `src/types.ts`: shared experiment domain types
-   `src/blocks/test`: parent block editor, render, and view runtime
-   `src/blocks/variant`: internal child block editor and save markup
-   `ab-test-block.php`: block registration, stats storage, token verification, REST routes
-   `src/api-types.ts` and `src/api-schemas`: runtime REST contracts

## Generated Artifacts

`bun run sync-types` generates block metadata and PHP validators for the parent and child blocks.

`bun run sync-rest` generates JSON Schema and OpenAPI files for the runtime event, stats, and reevaluation endpoints.
