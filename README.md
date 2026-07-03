# @fastwhitecat/integration-ksef-direct

OpenMercato module for direct integration with the Polish National e-Invoice System ([KSeF](https://ksef.mf.gov.pl)) via the official Ministry of Finance REST API v2 — no third-party middleware required.

## Features

- Send invoices to KSeF (FA(2) format)
- Poll submission status and retrieve KSeF reference numbers
- Fetch and sync received invoices
- Health check for connection status and rate limits
- Supports both test (`api-test.ksef.mf.gov.pl`) and production (`api.ksef.mf.gov.pl`) environments

## Requirements

- OpenMercato `>=0.6.2 <0.7.0`
- KSeF token and NIP (Tax Identification Number)

## Installation

```bash
npx mercato add @fastwhitecat/integration-ksef-direct
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
