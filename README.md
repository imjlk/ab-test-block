# Ab Test Block

A persistence-aware WordPress block with Typia validation, typed REST contracts, and selectable public or authenticated write policies

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
