# Ab Test Block

A/B test block starter built on the `wp-typia` persistence scaffold.

## Current Baseline

This project still runs the persistence starter's sample counter so the generated REST and interactivity wiring stay intact while the block is refactored.

## A/B Experiment Groundwork

- `src/types.ts` now includes spec-aligned experiment contracts for parent attributes, variant attributes, runtime config, and winner evaluation snapshots.
- `src/api-types.ts` now includes the next REST payloads for event ingestion, aggregate rows, and winner reevaluation.
- PHP prefixes stay snake_case for WordPress internals, while the package name and text domain use kebab-case.

## Template

persistence

## Development

```bash
bun install
bun run start
```

## Build

```bash
bun run build
```

## Type Sync

```bash
bun run sync-types
```

`src/types.ts` remains the source of truth for `block.json` and `typia.manifest.json`.

## Next Steps

1. Replace the sample counter attributes in `src/types.ts` with the real parent block attributes once the editor UI starts moving to the A/B experiment model.
2. Add the hidden `Variant` child block and switch the editor to `InnerBlocks`-based parent/child composition.
3. Replace the starter counter endpoint with `/event` and `/reevaluate` routes backed by the experiment stats table.
