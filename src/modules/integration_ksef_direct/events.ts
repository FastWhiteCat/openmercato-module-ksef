import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'ksef_direct.connection.connected', label: 'KSeF Direct Connection Established', entity: 'ksef_direct_connection', category: 'lifecycle' },
  { id: 'ksef_direct.connection.failed', label: 'KSeF Direct Connection Failed', entity: 'ksef_direct_connection', category: 'lifecycle' },
  { id: 'ksef_direct.connection.checked', label: 'KSeF Direct Connection Checked', entity: 'ksef_direct_connection', category: 'lifecycle' },
  { id: 'ksef_direct.document.created', label: 'KSeF Direct Document Created', entity: 'ksef_direct_document', category: 'lifecycle' },
  { id: 'ksef_direct.document.queued', label: 'KSeF Direct Document Queued', entity: 'ksef_direct_document', category: 'lifecycle' },
  { id: 'ksef_direct.document.sent', label: 'KSeF Direct Document Sent', entity: 'ksef_direct_document', category: 'lifecycle' },
  { id: 'ksef_direct.document.failed', label: 'KSeF Direct Document Failed', entity: 'ksef_direct_document', category: 'lifecycle' },
] as const

export const eventsConfig = createModuleEvents({ moduleId: 'integration_ksef_direct', events })
export const emitKsefDirectEvent = eventsConfig.emit
export type KsefDirectEventId = typeof events[number]['id']
export default eventsConfig
