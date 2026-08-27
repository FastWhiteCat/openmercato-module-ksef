# @fastwhitecat/integration-ksef-direct

OpenMercato module for direct integration with the Polish National e-Invoice System ([KSeF](https://ksef.mf.gov.pl)) via the official Ministry of Finance REST API v2 — no third-party middleware required.

## Features

- Send invoices to KSeF (FA(2) format)
- Poll submission status and retrieve KSeF reference numbers
- Fetch and sync received invoices
- Health check for connection status and rate limits
- Supports both test (`api-test.ksef.mf.gov.pl`) and production (`api.ksef.mf.gov.pl`) environments

## Requirements

- OpenMercato `>=0.7.0 <0.8.0`
- The `integrations` module enabled in your app
- KSeF token and NIP (Tax Identification Number)

## Installation

This is a third-party module, so install it with your package manager — the built-in
`mercato module add` command only accepts official `@open-mercato/*` packages.

**1. Add the package to your app**

```bash
npm install @fastwhitecat/integration-ksef-direct
# or, in a yarn-workspaces monorepo:
yarn workspace <your-app> add @fastwhitecat/integration-ksef-direct
```

> If your app is still on `awilix@12`, npm may report an `ERESOLVE` peer conflict.
> Install with `--legacy-peer-deps` to proceed — the module only uses the stable
> `asValue` API, so it works with awilix 12 and 13 alike.

> `@open-mercato/queue@0.7.0` itself ships an internally inconsistent peer range on
> `bullmq-otel` (`^1.3.0`, while its own `bullmq` peer needs `>=2.0.0`), so a plain
> `npm install` may report an `ERESOLVE` on `bullmq-otel` even in apps that never
> touch this module. This module's own `overrides` entry only takes effect when
> *this repo* is the install root (its own `npm ci`/CI) — npm ignores a dependency's
> `overrides` field, so it does **not** propagate into your app's install. If you hit
> this, add your own top-level override (npm `overrides` / yarn `resolutions`) pinning
> `bullmq-otel` to `^2.0.0`, or use `--legacy-peer-deps`. Worth reporting upstream to
> `open-mercato/open-mercato`.

**2. Register the module in your app's `modules.ts`**

```ts
export default [
  // ...existing modules
  { id: 'integration_ksef_direct', from: '@fastwhitecat/integration-ksef-direct' },
]
```

**3. Generate module artifacts and run migrations**

```bash
npx mercato generate all
npx mercato db migrate
```

## Configuration

After installation, go to **Settings → Integrations → KSeF Direct** and provide:

| Field | Description |
|-------|-------------|
| KSeF Token | Authorization token issued by KSeF |
| NIP | Your company's tax identification number |
| Environment | `test` or `production` |

## License

Proprietary — © FastWhiteCat
