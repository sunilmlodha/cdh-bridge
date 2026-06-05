'use strict';

const { v4: uuidv4 } = require('uuid');

/**
 * Mapping of incoming eventType strings to Pega CDH IH event type codes.
 * Unknown types fall back to IH.CustomEvent with the original type preserved.
 */
const EVENT_TYPE_MAP = {
  page_view:    'IH.WebBrowse',
  product_view: 'IH.ProductView',
  app_open:     'IH.AppSession',
  form_submit:  'IH.Interaction',
  purchase:     'IH.Conversion',
  call_start:   'IH.CallStart',
  chat_init:    'IH.ChatStart',
  email_open:   'IH.EmailOpen',
  offer_accept: 'IH.OfferAccepted',
  offer_reject: 'IH.OfferRejected',
  login:        'IH.Login',
  logout:       'IH.Logout',
};

/**
 * Mapping of incoming channel values to CDH IH channel codes.
 */
const CHANNEL_MAP = {
  web:         'WEB',
  mobile:      'MOB',
  app:         'APP',
  server:      'API',
  api:         'API',
  email:       'EMAIL',
  sms:         'SMS',
  call_center: 'PHONE',
  chat:        'CHAT',
  other:       'OTHER',
};

/**
 * Convert a properties object into flat IHPropName / IHPropValue arrays
 * that CDH Interaction History expects.
 *
 * @param {object} properties
 * @returns {{ IHPropName: string[], IHPropValue: string[] }}
 */
function flattenProperties(properties) {
  const names = [];
  const values = [];

  if (!properties || typeof properties !== 'object') {
    return { IHPropName: names, IHPropValue: values };
  }

  for (const [key, val] of Object.entries(properties)) {
    names.push(String(key));
    if (Array.isArray(val)) {
      values.push(val.join(','));
    } else if (val === null || val === undefined) {
      values.push('');
    } else {
      values.push(String(val));
    }
  }

  return { IHPropName: names, IHPropValue: values };
}

/**
 * Resolve and normalise the event timestamp to an ISO-8601 string.
 * Accepts: ISO string, Unix epoch (ms), Date object, or falls back to now.
 *
 * @param {string|number|Date|undefined} timestamp
 * @returns {string} ISO-8601 timestamp
 */
function resolveTimestamp(timestamp) {
  if (!timestamp) return new Date().toISOString();

  if (timestamp instanceof Date) return timestamp.toISOString();

  if (typeof timestamp === 'number') {
    // Accept both seconds and milliseconds epoch values
    const ms = timestamp > 1e12 ? timestamp : timestamp * 1000;
    return new Date(ms).toISOString();
  }

  const d = new Date(timestamp);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/**
 * Map a normalised incoming event to the Pega CDH Interaction History schema.
 *
 * Input shape:
 *   {
 *     customerId: string,
 *     eventType:  string,
 *     channel:    string,
 *     properties: object,
 *     timestamp:  string|number|Date (optional),
 *     sessionId:  string (optional),
 *     deviceId:   string (optional),
 *     ipAddress:  string (optional),
 *     userAgent:  string (optional),
 *   }
 *
 * Output (CDH IH) shape:
 *   {
 *     CustomerID:    string,
 *     IHEventType:   string,   // e.g. "IH.WebBrowse"
 *     IHChannel:     string,   // e.g. "WEB"
 *     IHTxnDateTime: string,   // ISO-8601
 *     IHPropName:    string[], // parallel arrays for key/value pairs
 *     IHPropValue:   string[],
 *     IHContext:     object,   // extra operational metadata
 *   }
 *
 * @param {object} incomingEvent
 * @returns {object} CDH IH formatted event
 */
function mapToCDHSchema(incomingEvent) {
  const {
    customerId,
    eventType,
    channel = 'web',
    properties = {},
    timestamp,
    sessionId,
    deviceId,
    ipAddress,
    userAgent,
  } = incomingEvent;

  // Resolve IH event type; unknown types become IH.CustomEvent
  const isKnownType = Object.prototype.hasOwnProperty.call(EVENT_TYPE_MAP, eventType);
  const ihEventType = isKnownType ? EVENT_TYPE_MAP[eventType] : 'IH.CustomEvent';

  // Merge custom type into properties for unknown events so it isn't lost
  const effectiveProperties = isKnownType
    ? { ...properties }
    : { ...properties, originalEventType: eventType };

  const ihChannel = CHANNEL_MAP[channel] || 'OTHER';
  const { IHPropName, IHPropValue } = flattenProperties(effectiveProperties);

  return {
    CustomerID:    String(customerId),
    IHEventType:   ihEventType,
    IHChannel:     ihChannel,
    IHTxnDateTime: resolveTimestamp(timestamp),
    IHPropName,
    IHPropValue,
    IHContext: {
      correlationId: uuidv4(),
      sessionId:     sessionId  || null,
      deviceId:      deviceId   || null,
      ipAddress:     ipAddress  || null,
      userAgent:     userAgent  || null,
      collectedAt:   new Date().toISOString(),
      schemaVersion: '1.0',
    },
  };
}

/**
 * Map an array of incoming events to CDH IH schema.
 *
 * @param {object[]} events
 * @returns {object[]}
 */
function mapBatchToCDHSchema(events) {
  return events.map(mapToCDHSchema);
}

/**
 * Returns a human-readable reference of all supported CDH IH field mappings.
 * Used by the GET /v1/events/schema endpoint.
 *
 * @returns {object}
 */
function getSchemaMappingReference() {
  return {
    description: 'Pega CDH Interaction History field mapping reference',
    inputFields: {
      customerId: 'Required. Customer identifier string.',
      eventType:  'Required. Semantic event type (see eventTypeMappings).',
      channel:    'Optional. Origin channel (see channelMappings). Defaults to "web".',
      properties: 'Optional. Key/value property bag (max 50 keys).',
      timestamp:  'Optional. ISO-8601 string or Unix epoch. Defaults to server time.',
      sessionId:  'Optional. Browser/app session identifier.',
      deviceId:   'Optional. Device identifier.',
      ipAddress:  'Optional. Client IP address.',
      userAgent:  'Optional. HTTP User-Agent string.',
    },
    outputFields: {
      CustomerID:    'Maps from customerId.',
      IHEventType:   'CDH IH event type code (see eventTypeMappings).',
      IHChannel:     'CDH IH channel code (see channelMappings).',
      IHTxnDateTime: 'ISO-8601 transaction datetime.',
      IHPropName:    'Parallel array of property names.',
      IHPropValue:   'Parallel array of property values (stringified).',
      IHContext:     'Operational metadata: correlationId, sessionId, deviceId, ipAddress, userAgent, collectedAt, schemaVersion.',
    },
    eventTypeMappings: EVENT_TYPE_MAP,
    channelMappings:   CHANNEL_MAP,
    notes: [
      'Unknown eventType values are mapped to IH.CustomEvent with the original type stored in IHPropName/IHPropValue as "originalEventType".',
      'Unknown channel values are mapped to "OTHER".',
      'IHPropName and IHPropValue are parallel arrays; index N in IHPropName corresponds to index N in IHPropValue.',
    ],
  };
}

module.exports = { mapToCDHSchema, mapBatchToCDHSchema, getSchemaMappingReference };
