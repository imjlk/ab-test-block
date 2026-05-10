=== A/B Test Block ===
Contributors: imjlk
Tags: ab test, experiment, split test, marketing, block
Requires at least: 6.9
Tested up to: 6.9
Requires PHP: 7.4
Stable tag: 0.4.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Run A/B and A/B/C content experiments directly in the block editor.

== Description ==

A/B Test Block is a pure block plugin for the WordPress Block Directory.

Build one experiment block, author up to three content variants, and let WordPress choose which variant to show with preview overrides, sticky assignment, weighted delivery, and winner rules.

Highlights:

* One top-level `A/B Test` block with an internal `Variant` child block
* A/B and A/B/C authoring flows with weighted traffic allocation
* Sticky visitor assignment using first-party cookies, scoped per page block or shared Experiment ID
* Query-string preview overrides for testing specific variants before publishing
* Front-end output modes for rendering only the chosen variant or keeping all variants in HTML for compatibility
* Manual winner selection and CTR-based automatic winner reevaluation
* Quick-start starter templates for common experiment layouts
* Experiment lifecycle actions for starting a new run or using the current winner as a fresh baseline
* Variant authoring tools for copying, swapping, comparing, and syncing structure
* Viewable impression and primary CTA click aggregation in WordPress
* Editor Diagnostics stats for the current block and shared experiment
* Browser events plus optional `window.kexpLayer`, `window.dataLayer`, and Clarity hooks
* Read-only WP-CLI commands for experiment and winner-state inspection

Not included:

* Admin menus or settings pages
* Reporting dashboards
* SaaS sync, accounts, payments, or AI generation

== Installation ==

1. Upload the plugin files to the `/wp-content/plugins/ab-test-block` directory, or install the plugin through the WordPress plugins screen.
2. Activate the plugin through the Plugins screen in WordPress.
3. Insert the `A/B Test` block in the editor and start editing variants.

== Setting Up Your First Test ==

1. Add the `A/B Test` block to a post or page.
2. Choose `A/B` or `A/B/C` in the `General` panel.
3. Add content to each Variant, or use a quick-start template while the block is empty.
4. Edit the heading, copy, image, button, or link in each Variant.
5. Select the button or link you care about and choose `Primary CTA`.
6. Keep the default 50/50 traffic split, or adjust weights in `Traffic Allocation`.
7. Publish the page. Viewable impressions and primary CTA clicks are counted automatically.
8. Open `Diagnostics` to review impressions, clicks, CTR, and winner status.
9. When you have enough data, choose a manual winner or switch `Winning Rules` to automatic.

== Screenshots ==

1. The front end shows only the chosen Variant while impressions and CTA clicks are tracked in the background.
2. The editor keeps the active Variant close to the front-end view while settings stay in the toolbar and inspector.

== Frequently Asked Questions ==

= Does this plugin add an admin report screen? =

No. Reporting stays out of scope so the plugin remains aligned with Block Directory expectations.

= How do I preview a specific variant? =

Use either a block-specific preview key such as `?ab_home_hero=b` or the global pattern `?abtest=home_hero:b`.

= How is automatic winner selection decided? =

This version uses CTR only. When every eligible variant reaches the minimum thresholds, the highest CTR wins. Diagnostics explains when there is still no winner because there is not enough data, the minimum data has not been reached, or the top CTR is tied. Use `Reevaluate now` in `Winning Rules` to refresh the automatic result, `Use candidate as manual winner` to keep the current candidate, or `Return to automatic winner` to remove the manual override.

= How do I mark a CTA? =

Select the CTA block in the editor and use the `Primary CTA` action from the block toolbar or the `Tracking` panel. If you are using custom markup, add the `data-abtest-cta` attribute instead. When no marker is present, the plugin falls back to links and buttons inside the active variant, and the editor tells you whether the current variant is using an explicit CTA or fallback tracking.

= How do I start a fresh experiment without deleting the old data? =

Use the `Experiment lifecycle` panel. `Start new experiment` rotates the tracking IDs and keeps the current content, while `Use current winner as new baseline` copies the resolved winner into every Variant before starting a new run.

= How do I start faster with a ready-made layout? =

Use the quick-start starter templates when the block is still empty, or open `More` and apply a starter template before you add custom content. Each template seeds every Variant with the same structure, variant-specific sample copy, and an initial primary CTA.

= How do I keep the Variant layouts aligned while editing different copy? =

Use the `Variant structure` panel. The active Variant is treated as the current structure source, the editor tells you when other Variants no longer match it, and `Sync now` aligns the other structures while keeping matching target content in place whenever the block type and order still line up. The `Compare variants` panel uses that same active baseline, summarizes changed blocks only, and lets you jump straight into `Edit Variant X` or `Sync structure now` when structure rows differ.

= When is an impression counted? =

An impression is counted only when the active variant stays at least 50% visible in the viewport for 1 second.

= How is sticky assignment stored? =

This version uses first-party cookies. By default the sticky key is scoped to the current page and block instance. You can optionally switch sticky scope to the shared Experiment ID so the same browser sees a consistent variant across multiple pages. Existing localStorage keys are treated as a one-release migration fallback and are promoted into cookies on the front end.

= How does the front end render inactive variants? =

By default the block uses `Only render chosen variant`, which maps to the internal `dom-prune` mode and renders only the active variant into the front-end HTML. If you need compatibility with integrations that expect every variant to exist in the DOM, switch to `Keep all variants in HTML`, which maps to the internal `css-hide` mode.

= Can the server inspect individual sticky visitors? =

No. The server stores aggregate experiment stats only. Sticky assignment is browser cookie state and is not individually queryable from the server.

= How can I disable tracking quickly? =

Add `define( 'AB_TEST_BLOCK_DISABLE_TRACKING', true );` to your site configuration to stop new tracking writes and browser-layer emits while keeping saved stats readable.

= What data does this plugin store or send? =

The plugin stores aggregate experiment stats in your WordPress database: variant impressions, primary CTA clicks, CTR, and last update times. Sticky assignment is stored in a first-party browser cookie so the same visitor can keep seeing the same variant. The plugin does not create accounts, sync to a SaaS service, or send experiment data to an external server by itself.

= How do the optional analytics hooks work? =

The optional browser event, `window.kexpLayer`, `window.dataLayer`, and Clarity hook outputs only emit to objects that already exist on the page or to normal browser events. The plugin does not load Google Tag Manager, Microsoft Clarity, or another analytics provider for you. Site owners should make sure their cookie and privacy notices match how they configure tracking.

= Where is the editable source code? =

The plugin ships with compiled build assets for WordPress, and the human-readable source is publicly maintained at https://github.com/imjlk/ab-test-block. The release package also includes the `src/` directory so the editor code, styles, and block sources remain reviewable.

== Changelog ==

= 0.4.0 =

* Added starter templates, compare cards, CTA visibility helpers, lifecycle actions, winner diagnostics, and structure sync tools for faster experiment authoring.
* Hardened release packaging and WordPress.org staging so versioned block metadata and staged payloads stay aligned with the tagged release.

Older release history is maintained at https://github.com/imjlk/ab-test-block/blob/main/CHANGELOG.md.
