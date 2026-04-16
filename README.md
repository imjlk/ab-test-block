# A/B Test Block

Block Directory-ready Gutenberg block plugin for running A/B and A/B/C content experiments directly inside the editor.

## What It Includes

-   One top-level `A/B Test` block plus an internal `Variant` child block
-   A/B or A/B/C authoring with fixed variant slots
-   Weighted delivery, sticky assignment, query-string preview overrides
-   Front-end render modes for either pruning inactive variants or hiding them after hydration
-   Sticky assignment scoped either to this page/block or to a shared experiment ID
-   Manual winner and CTR-based automatic winner
-   Editor actions for marking a selected block as the primary CTA
-   Fresh experiment lifecycle actions for starting a new run or using the current winner as a new baseline
-   Variant productivity actions for copying the visible variant or swapping A/B content
-   Viewable impression and primary CTA click aggregation through REST + custom table
-   Browser event, `window.kexpLayer`, `window.dataLayer`, and Clarity hook outputs
-   Server stats surfaced back into the editor Diagnostics panel
-   Optional assignment label that can be toggled in both the toolbar and inspector

## Tracking Semantics

-   `impression` means the active variant stays at least 50% visible for 1 second.
-   `click` means the first primary CTA click for the block on the current page.
-   `abtest_stats` / `abtest:stats` carry saved aggregate stats after counted events.
-   When a CTA-capable block is selected in the editor, use `Primary CTA` from the toolbar or the `Tracking` panel to add the explicit marker automatically.
-   For custom markup, use the `data-abtest-cta` attribute instead.
-   If no CTA marker exists inside the active variant, links and buttons fall back automatically.

## Experiment Identity

-   A single block instance is identified by `postId + blockInstanceId`.
-   `experimentId` is the logical experiment key and may be reused across multiple posts or pages.
-   The default sticky identity is a first-party cookie, not logged-in user identity.
-   Default sticky scope is the current page/block instance.
-   Optional shared-experiment sticky uses the cookie key `abtest_exp_{experimentId}`.
-   Page-block sticky uses the cookie key `abtest_{postId}_{blockInstanceId}`.
-   Existing `localStorage` keys are treated as a one-release migration fallback and promoted into cookies on the front end.
-   Server-side stats are aggregate only. Individual browser sticky assignments are not readable from the server.
-   Future CLI/reporting work should support both per-instance inspection and cross-post aggregation by `experimentId`.

## Front-end Output

-   Default front-end output is `Only render chosen variant`, which uses the internal `dom-prune` mode to render only the resolved active variant into the front-end HTML.
-   Optional `Keep all variants in HTML` mode uses the internal `css-hide` behavior and hides inactive variants after hydration.
-   Query preview, locked winner, manual winner, automatic winner candidate, sticky assignment, and weighted random all share the same precedence in PHP and the browser runtime.
-   The assignment label is hidden by default and can be toggled from the block toolbar or the `Labels & Hints` inspector panel.

## REST and Diagnostics Surface

-   `GET /wp-json/abtest-block/v1/stats` returns both `instance` and `experiment` snapshots.
-   `POST /wp-json/abtest-block/v1/event` and `POST /wp-json/abtest-block/v1/reevaluate` both return the latest stats snapshot.
-   Automatic reevaluation now returns a `reasonCode` such as `thresholds-not-met`, `tie`, or `insufficient-data` so Diagnostics and CLI output explain why a winner does or does not exist.
-   The editor Diagnostics panel shows `This block` and `This experiment` cards with impressions, clicks, CTR, last update time, and short winner explanations.
-   `Winning Rules` can now reevaluate automatic winner state on demand, apply the current candidate as a manual winner, or return a manual winner back to automatic mode.

## Operations

-   `wp abtest-block experiments --format=table|json [--limit=<n>]` lists tracked experiments with aggregate counts and last update time.
-   `wp abtest-block stats --post=<id> --block-instance=<id>` shows the current block-instance snapshot.
-   `wp abtest-block stats --experiment=<id>` shows the shared experiment aggregate snapshot.
-   `wp abtest-block winner-state --post=<id> --block-instance=<id> --format=json` shows the stored winner snapshot for one block instance.
-   The `winner-state` JSON also includes `reasonSummary`, `thresholds`, and `variantProgress` so the current automatic winner state is readable without opening the editor.
-   `define( 'AB_TEST_BLOCK_DISABLE_TRACKING', true );` disables new tracking writes and browser-layer emits site-wide while keeping saved stats readable.
-   Advanced installations can also short-circuit tracking through the `ab_test_block_tracking_enabled` filter.

## WordPress Playground

-   Open the latest `main` build in Playground: [Open in Playground](https://playground.wordpress.net/?blueprint-url=https%3A%2F%2Fraw.githubusercontent.com%2Fimjlk%2Fab-test-block%2Fplayground-build%2F.wordpress-org%2Fblueprints%2Fgithub-blueprint.json)
-   That README link uses the generated `playground-build` branch, which is refreshed from `main` and serves the current built plugin zip plus blueprint.
-   `bun run playground:sync` regenerates the tracked blueprint files under `.wordpress-org/blueprints/`.
-   `bun run playground:preview-link` prints the raw `playground-build` blueprint URL and the matching Playground link for the current repository remote.
-   `.wordpress-org/blueprints/blueprint.json` is the WordPress.org preview blueprint that is meant to land in the plugin SVN assets path as `assets/blueprints/blueprint.json`.
-   `bun run wordpress-org:copy-assets -- --target=/path/to/svn/assets` copies only the publishable WordPress.org assets into an existing SVN `assets/` directory.
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
bun run plugin-zip
bun run wordpress-org:preflight
```

## Smoke Modes

-   `bun run smoke:e2e:core` checks front-end render, `dom-prune` versus `css-hide`, `abtest_impression` / `abtest_stats`, sticky assignment for both `instance` and `experiment` scopes, and legacy `localStorage` migration into cookies.
-   `bun run smoke:e2e:editor` focuses on editor regressions such as parent selection retention, toolbar variant switching, visible variant persistence, block add/remove, and Diagnostics panel visibility.
-   `bun run smoke:e2e` runs the full suite by combining `core` and `editor`.
-   GitHub Actions only hard-asserts `smoke:e2e:core`.
-   The editor smoke keeps the `Experiment Identity` panel `Experiment ID` toggle as a best-effort check so sidebar DOM changes do not make CI flaky.
-   CI also runs a clean zip-install smoke that installs `ab-test-block.zip` into a fresh WordPress environment before checking routes and front-end render.

## Visual QA

-   `bun run visual:e2e:update` refreshes the repo-tracked Playwright baseline screenshots for the canonical parity fixture.
-   `bun run visual:e2e:check` recaptures the same fixture locally and compares it against the committed baselines.
-   `bun run visual:e2e:ci` checks the most stable front-end subset (`front-a.png`) with a small pixel-diff tolerance so we can keep evaluating it as a future CI candidate.
-   `bun run wordpress-org:sync-screenshots` copies the current front/editor parity baselines into `.wordpress-org/screenshot-1.png` and `.wordpress-org/screenshot-2.png`.
-   The current baseline set covers:
    -   front `Variant A`
    -   front `Variant B`
    -   editor with the parent block selected
    -   editor with a child variant selected
-   The suite remains local-first while we keep stabilizing runner-to-runner screenshot drift before promoting any subset into CI.

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
bun run wordpress-org:preflight
bun run wordpress-org:stage
```

This generates a submission-ready zip that includes the built plugin files under the `ab-test-block` root folder.

The Playground blueprint sync keeps these repo-tracked files up to date:

-   `.wordpress-org/blueprints/blueprint.json`
-   `.wordpress-org/blueprints/github-blueprint.json`

## WordPress.org Deployment

Use this release sequence:

1. Merge the release PR generated from `sampo`.
2. Tag the version and publish the GitHub release.
3. Run the manual `WordPress.org Deploy` workflow from GitHub Actions.

Local dry-run commands:

```bash
bun run plugin-zip
bun run wordpress-org:preflight
bun run wordpress-org:stage
```

`bun run wordpress-org:stage` writes a ready-to-commit SVN layout under `.wordpress-org-dist/ab-test-block/`:

-   `trunk/`
-   `tags/<version>/`
-   `assets/`

If you only need to refresh an existing SVN `assets/` directory, copy the publishable assets with:

```bash
bun run wordpress-org:copy-assets -- --target=/path/to/plugin-svn/assets
```

The manual GitHub workflow expects these secrets:

-   `WPORG_SVN_USERNAME`
-   `WPORG_SVN_PASSWORD`

## Code Structure

-   `src/types.ts`: shared experiment domain types
-   `src/blocks/test`: parent block editor, render, and view runtime
-   `src/blocks/variant`: internal child block editor and save markup
-   `ab-test-block.php`: block registration, stats storage, token verification, REST routes
-   `src/api-types.ts` and `src/api-schemas`: runtime REST contracts

## Generated Artifacts

`bun run sync-types` generates block metadata and PHP validators for the parent and child blocks.

`bun run sync-rest` generates JSON Schema and OpenAPI files for the runtime event, stats, and reevaluation endpoints.
