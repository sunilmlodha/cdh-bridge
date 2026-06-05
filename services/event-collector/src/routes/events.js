'use strict';

const express = require('express');
const router = express.Router();

const { validateSingleEvent, validateBatchEvents } = require('../validators');
const { mapToCDHSchema, mapBatchToCDHSchema, getSchemaMappingReference } = require('../schema-mapper');
const { publishEvent, publishBatch } = require('../kafka-producer');
const { isOptedOut } = require('../consent-check');
const logger = require('../logger');

// ---------------------------------------------------------------------------
// Helper: build a standardised error response
// ---------------------------------------------------------------------------
function errorResponse(res, status, code, message, details) {
  return res.status(status).json({
    success: false,
    error: { code, message, ...(details ? { details } : {}) },
  });
}

// ---------------------------------------------------------------------------
// POST /v1/events — ingest a single event
// ---------------------------------------------------------------------------
router.post('/', async (req, res) => {
  // 1. Validate input
  const { value: event, error: validationError } = validateSingleEvent(req.body);
  if (validationError) {
    return errorResponse(res, 400, 'VALIDATION_ERROR', 'Invalid event payload', {
      fields: validationError.details.map((d) => ({ field: d.path.join('.'), message: d.message })),
    });
  }

  // 2. Consent / opt-out check
  const optedOut = await isOptedOut(event.customerId);
  if (optedOut) {
    // Return 202 Accepted — we acknowledge receipt but silently discard
    return res.status(202).json({
      success:  true,
      accepted: false,
      reason:   'OPT_OUT',
      message:  'Event discarded: customer has opted out of data collection.',
    });
  }

  // 3. Map to CDH IH schema
  const cdhEvent = mapToCDHSchema(event);

  // 4. Publish to Kafka
  let kafkaMeta;
  try {
    kafkaMeta = await publishEvent(cdhEvent);
  } catch (err) {
    logger.error('Failed to publish event to Kafka', {
      customerId: event.customerId,
      eventType:  event.eventType,
      error:      err.message,
    });
    return errorResponse(res, 502, 'KAFKA_ERROR', 'Failed to publish event to message broker.');
  }

  return res.status(201).json({
    success:       true,
    accepted:      true,
    correlationId: cdhEvent.IHContext.correlationId,
    ihEventType:   cdhEvent.IHEventType,
    kafka: {
      topic:     process.env.KAFKA_TOPIC || 'cdh-events',
      partition: kafkaMeta?.partition,
      offset:    kafkaMeta?.baseOffset,
    },
  });
});

// ---------------------------------------------------------------------------
// POST /v1/events/batch — ingest up to 100 events
// ---------------------------------------------------------------------------
router.post('/batch', async (req, res) => {
  // 1. Validate input
  const { value: body, error: validationError } = validateBatchEvents(req.body);
  if (validationError) {
    return errorResponse(res, 400, 'VALIDATION_ERROR', 'Invalid batch payload', {
      fields: validationError.details.map((d) => ({ field: d.path.join('.'), message: d.message })),
    });
  }

  const { events } = body;

  // 2. Consent check — run in parallel for all events
  const consentChecks = await Promise.all(
    events.map((e) => isOptedOut(e.customerId))
  );

  const allowed  = [];
  const rejected = [];

  events.forEach((e, idx) => {
    if (consentChecks[idx]) {
      rejected.push({ index: idx, customerId: e.customerId, reason: 'OPT_OUT' });
    } else {
      allowed.push({ event: e, originalIndex: idx });
    }
  });

  if (allowed.length === 0) {
    return res.status(202).json({
      success:  true,
      accepted: 0,
      rejected: rejected.length,
      message:  'All events discarded: all customers have opted out.',
      details:  { rejected },
    });
  }

  // 3. Map allowed events to CDH IH schema
  const cdhEvents = mapBatchToCDHSchema(allowed.map((a) => a.event));

  // 4. Publish batch to Kafka
  let kafkaMeta;
  try {
    kafkaMeta = await publishBatch(cdhEvents);
  } catch (err) {
    logger.error('Failed to publish batch to Kafka', {
      count: cdhEvents.length,
      error: err.message,
    });
    return errorResponse(res, 502, 'KAFKA_ERROR', 'Failed to publish events to message broker.');
  }

  return res.status(201).json({
    success:  true,
    accepted: allowed.length,
    rejected: rejected.length,
    events: allowed.map((a, i) => ({
      index:         a.originalIndex,
      correlationId: cdhEvents[i].IHContext.correlationId,
      ihEventType:   cdhEvents[i].IHEventType,
      customerId:    cdhEvents[i].CustomerID,
    })),
    ...(rejected.length > 0 ? { rejectedDetails: rejected } : {}),
    kafka: kafkaMeta,
  });
});

// ---------------------------------------------------------------------------
// GET /v1/events/schema — CDH IH field mapping reference
// ---------------------------------------------------------------------------
router.get('/schema', (req, res) => {
  return res.status(200).json({
    success: true,
    schema:  getSchemaMappingReference(),
  });
});

module.exports = router;
