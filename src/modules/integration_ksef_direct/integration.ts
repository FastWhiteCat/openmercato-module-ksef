import type { IntegrationDefinition } from '@open-mercato/shared/modules/integrations/types'

export const integration: IntegrationDefinition = {
  id: 'integration_ksef_direct',
  title: 'KSeF Direct',
  description: 'Direct integration with the Polish National e-Invoice System (KSeF) via official MF REST API v2 — no Exorigo/SmartKSeF middleware required.',
  category: 'fiscal',
  providerKey: 'ksef_direct',
  icon: 'file-text',
  package: '@fwc/om-integration-ksef-direct',
  version: '0.1.0',
  author: 'FastWhiteCat',
  company: 'FastWhiteCat',
  license: 'PROPRIETARY',
  tags: ['ksef', 'e-invoicing', 'poland', 'fiscal', 'tax-compliance', 'direct'],
  credentials: {
    fields: [
      {
        key: 'ksef_token',
        label: 'KSeF Token',
        type: 'secret',
        required: true,
      },
      {
        key: 'nip',
        label: 'NIP (Tax Identification Number)',
        type: 'text',
        required: true,
      },
      {
        key: 'environment',
        label: 'Environment',
        type: 'select',
        required: true,
        options: [
          { value: 'test', label: 'Test (api-test.ksef.mf.gov.pl)' },
          { value: 'production', label: 'Production (api.ksef.mf.gov.pl)' },
        ],
      },
    ],
  },
  healthCheck: {
    service: 'ksefDirectHealthChecker',
  },
  apiVersions: [
    {
      id: 'ksef-api-v2',
      label: 'KSeF MF API v2',
      status: 'stable',
      default: true,
      changelog: 'Direct MF KSeF API v2 — challenge/token auth flow',
    },
  ],
}
