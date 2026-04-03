=== A/B Test Block ===
Contributors: imjlk
Tags: ab test, experiment, split test, marketing, block
Requires at least: 6.9
Tested up to: 6.9
Requires PHP: 7.4
Stable tag: 0.3.2
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Create A/B and A/B/C experiments directly inside the block editor with weighted traffic allocation, sticky assignment, and winner rules.

== Description ==

A/B Test Block is a pure block plugin for the WordPress Block Directory.

Build one experiment block, author up to three content variants, and let the front end choose which variant to show based on preview overrides, winner rules, sticky assignment, and weighted random delivery.

Features included in this version:

* One top-level `A/B Test` block with an internal `Variant` child block
* A/B and A/B/C authoring flows
* Weighted traffic allocation with normalize and equalize controls
* Query-string preview overrides
* Sticky visitor assignment using browser localStorage
* Optional shared-experiment sticky scope by Experiment ID
* Manual winner selection
* CTR-based automatic winner reevaluation
* Viewable impression and primary CTA click aggregation
* Browser events plus optional `window.kexpLayer`, `window.dataLayer`, and Clarity hooks
* Editor Debug stats for both the current block and shared experiment
* Read-only WP-CLI commands for experiment and winner-state inspection

Not included:

* Admin menus or settings pages
* Reporting dashboards
* SaaS sync, accounts, payments, or AI generation

== Installation ==

1. Upload the plugin files to the `/wp-content/plugins/ab-test-block` directory, or install the plugin through the WordPress plugins screen.
2. Activate the plugin through the Plugins screen in WordPress.
3. Insert the `A/B Test` block in the editor and start editing variants.

== Screenshots ==

1. The front end shows one active Variant at a time while impressions and CTA clicks are tracked in the background.
2. The editor keeps the same shell styling so the active Variant stays close to the front-end presentation.

== Frequently Asked Questions ==

= Does this plugin add an admin report screen? =

No. This plugin keeps reporting out of scope so it stays aligned with Block Directory expectations.

= How do I preview a specific variant? =

Use either a block-specific preview key such as `?ab_home_hero=b` or the global pattern `?abtest=home_hero:b`.

= How is automatic winner selection decided? =

This version uses CTR only. When every eligible variant meets the minimum thresholds, the variant with the highest CTR wins. Ties do not produce a winner.

= How do I mark a CTA? =

Add the Additional CSS class `abtest-cta` to the button or link you want to count as the primary CTA. If you are using custom markup, add the `data-abtest-cta` attribute instead. When no marker is present, the plugin falls back to links and buttons inside the active variant.

= When is an impression counted? =

An impression is counted only when the active variant stays at least 50% visible in the viewport for 1 second.

= How is sticky assignment stored? =

This version uses browser localStorage only. By default the sticky key is scoped to the current page and block instance. You can optionally switch sticky scope to the shared Experiment ID so the same browser sees a consistent variant across multiple pages.

= Can the server inspect individual sticky visitors? =

No. The server stores aggregate experiment stats only. Sticky assignment is browser localStorage state and is not individually queryable from the server.

= How can I disable tracking quickly? =

Add `define( 'AB_TEST_BLOCK_DISABLE_TRACKING', true );` to your site configuration to stop new tracking writes and browser-layer emits while keeping saved stats readable.

== Changelog ==

= 0.3.2 =

* Polished Block Directory submission assets and synchronized the editor and front-end shell styling.
* Added visual parity baselines so screenshot and Playground fixtures stay aligned with the live block UI.

= 0.3.1 =

* Refined the editor so the A/B Test parent block stays lightweight and the active Variant remains the focus.
* Added stats readback in the editor Debug panel plus read-only WP-CLI inspection commands.
* Added optional shared-experiment sticky scope, release zip smoke checks, and a site-wide tracking kill switch.

= 0.3.0 =

* Added editor and browser stats surfaces, shared experiment aggregation, and improved debug visibility.
* Added Playground blueprints, preview links, and release automation hardening.

= 0.2.0 =

* Rebuilt the starter scaffold as a pure A/B testing block plugin
* Added parent/child block structure for variants
* Added weighted delivery, sticky assignment, and query preview overrides
* Added manual winner and automatic winner reevaluation
* Added first-party event aggregation through REST and a custom stats table
* Refined tracking so impressions are viewable and clicks prefer explicit CTA markers
