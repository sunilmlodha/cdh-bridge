'use strict'

/**
 * @fileoverview Mock Pega CDH REST API server.
 *
 * Implements a faithful-enough mock of the Pega CDH gateway endpoints used by
 * CDH Bridge so that the full stack can run locally without a real Pega licence.
 *
 * Endpoints:
 *   POST /dataflow/events              — accept CDH events
 *   POST /customerprofile              — upsert customer profile
 *   PUT  /customerprofile/:id/consent  — suppress / update consent
 *   GET  /nba/decisions/:customerId    — return mock NBA decisions
 *   GET  /health                       — liveness + counters
 *   GET  /profiles                     — all stored profiles (dashboard use)
 *   GET  /events                       — last 100 events (dashboard use)
 *   WS   /ws                           — live event stream (WebSocket)
 */

const express = require('express')
const http = require('http')
const { WebSocketServer } = require('ws')
const { v4: uuidv4 } = require('uuid')
const { createLogger, format, transports } = require('winston')

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(format.timestamp(), format.errors({ stack: true }), format.json()),
  transports: [
    new transports.Console({
      format: format.combine(format.colorize(), format.simple())
    })
  ]
})

// ---------------------------------------------------------------------------
// In-memory stores
// Max 1 000 profiles, 10 000 events (circular / trimming approach)
// ---------------------------------------------------------------------------

const MAX_PROFILES = 1000
const MAX_EVENTS = 10000

/** @type {Map<string, object>} customerId → profile */
const profileStore = new Map()

/** @type {object[]} ring buffer of events */
const eventStore = []

/** @type {Map<string, object>} customerId → consent record */
const consentStore = new Map()

/** @type {Map<string, object[]>} customerId → NBA decisions (pre-generated) */
const nbaStore = new Map()

// Counters for /health
const counters = {
  events: 0,
  profiles: 0,
  consent: 0,
  nbaRequests: 0
}

// ---------------------------------------------------------------------------
// Seeded NBA decision templates
// ---------------------------------------------------------------------------

const NBA_ACTIONS = [
  { action: 'RetentionOffer', treatment: '10PctDiscount', channel: 'email' },
  { action: 'UpgradePush', treatment: 'PremiumTrial30', channel: 'mobile' },
  { action: 'WinbackEmail', treatment: 'PersonalisedOffer', channel: 'email' },
  { action: 'CrossSell', treatment: 'InsuranceBundleA', channel: 'web' },
  { action: 'LoyaltyReward', treatment: 'DoublePoints', channel: 'sms' }
]

function generateDecisions(customerId) {
  const count = 1 + Math.floor(Math.random() * 3)
  const decisions = []
  const used = new Set()
  for (let i = 0; i < count; i++) {
    let template
    do {
      template = NBA_ACTIONS[Math.floor(Math.random() * NBA_ACTIONS.length)]
    } while (used.has(template.action))
    used.add(template.action)
    decisions.push({
      decisionId: uuidv4(),
      customerId,
      action: template.action,
      treatment: template.treatment,
      outcome: 'pending',
      channel: template.channel,
      timestamp: new Date().toISOString(),
      rank: i + 1,
      propensity: parseFloat((0.4 + Math.random() * 0.5).toFixed(4))
    })
  }
  return decisions
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express()
app.use(express.json({ limit: '5mb' }))

// Request logger middleware
app.use((req, res, next) => {
  const start = Date.now()
  res.on('finish', () => {
    logger.info({
      msg: 'mock-cdh request',
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Date.now() - start
    })
  })
  next()
})

// ---------------------------------------------------------------------------
// POST /dataflow/events
// Accepts a single CDH event or an array of events.
// ---------------------------------------------------------------------------

app.post('/dataflow/events', (req, res) => {
  const body = req.body
  const events = Array.isArray(body) ? body : [body]

  const accepted = []
  const rejected = []

  for (const evt of events) {
    if (!evt || !evt.customerId) {
      rejected.push({ reason: 'missing customerId', event: evt })
      continue
    }

    const enriched = {
      eventId: evt.eventId || uuidv4(),
      customerId: evt.customerId,
      eventType: evt.eventType || 'Unknown',
      channel: evt.channel || 'unknown',
      timestamp: evt.timestamp || new Date().toISOString(),
      properties: evt.properties || {},
      ihmapping: evt.ihmapping || {},
      receivedAt: new Date().toISOString()
    }

    // Trim circular buffer
    if (eventStore.length >= MAX_EVENTS) {
      eventStore.splice(0, Math.ceil(MAX_EVENTS * 0.1)) // drop oldest 10%
    }
    eventStore.push(enriched)
    counters.events++
    accepted.push(enriched.eventId)

    // Broadcast to WebSocket subscribers
    broadcastEvent(enriched)
  }

  logger.debug({ msg: 'events accepted', count: accepted.length, rejected: rejected.length })

  res.status(202).json({
    accepted: accepted.length,
    rejected: rejected.length,
    acceptedIds: accepted,
    rejectedItems: rejected
  })
})

// ---------------------------------------------------------------------------
// POST /customerprofile
// Upsert a customer profile. Merges with any existing profile.
// ---------------------------------------------------------------------------

app.post('/customerprofile', (req, res) => {
  const profile = req.body

  if (!profile || !profile.customerId) {
    return res.status(400).json({ error: 'customerId is required' })
  }

  const existing = profileStore.get(profile.customerId) || {}
  const merged = {
    ...existing,
    ...profile,
    updatedAt: new Date().toISOString(),
    _source: 'mock-cdh'
  }

  // Enforce store limit (evict oldest by insertion order)
  if (!profileStore.has(profile.customerId) && profileStore.size >= MAX_PROFILES) {
    const firstKey = profileStore.keys().next().value
    profileStore.delete(firstKey)
    logger.warn({ msg: 'mock-cdh profile store full, evicted oldest', evicted: firstKey })
  }

  profileStore.set(profile.customerId, merged)
  counters.profiles++

  // Pre-generate NBA decisions for this customer if not already done
  if (!nbaStore.has(profile.customerId)) {
    nbaStore.set(profile.customerId, generateDecisions(profile.customerId))
  }

  logger.debug({ msg: 'profile upserted', customerId: profile.customerId, totalProfiles: profileStore.size })

  res.status(200).json({
    customerId: profile.customerId,
    status: 'upserted',
    updatedAt: merged.updatedAt
  })
})

// ---------------------------------------------------------------------------
// PUT /customerprofile/:id/consent
// Update consent flags for a customer profile.
// ---------------------------------------------------------------------------

app.put('/customerprofile/:id/consent', (req, res) => {
  const { id } = req.params
  const update = req.body || {}

  const existing = profileStore.get(id) || {}
  const consentRecord = {
    customerId: id,
    suppress: update.suppress || false,
    suppressedAt: update.suppress ? (update.suppressedAt || new Date().toISOString()) : null,
    reason: update.reason || 'api',
    optOutEmail: update.optOutEmail !== undefined ? update.optOutEmail : (existing.consent?.optOutEmail || false),
    optOutSms: update.optOutSms !== undefined ? update.optOutSms : (existing.consent?.optOutSms || false),
    optOutPush: update.optOutPush !== undefined ? update.optOutPush : (existing.consent?.optOutPush || false),
    gdprErasure: update.gdprErasure !== undefined ? update.gdprErasure : false,
    ccpaDoNotSell: update.ccpaDoNotSell !== undefined ? update.ccpaDoNotSell : false,
    updatedAt: new Date().toISOString()
  }

  consentStore.set(id, consentRecord)
  counters.consent++

  // If suppress/erasure, remove profile data (keep tombstone)
  if (update.suppress || update.gdprErasure) {
    profileStore.set(id, {
      customerId: id,
      _suppressed: true,
      _suppressedAt: consentRecord.suppressedAt || new Date().toISOString(),
      consent: consentRecord
    })
    logger.info({ msg: 'mock-cdh profile suppressed', customerId: id, reason: update.reason })
  } else {
    // Merge consent into existing profile
    if (existing.customerId) {
      profileStore.set(id, { ...existing, consent: consentRecord, updatedAt: consentRecord.updatedAt })
    }
  }

  res.status(200).json({
    customerId: id,
    status: 'consent_updated',
    consent: consentRecord
  })
})

// ---------------------------------------------------------------------------
// GET /nba/decisions/:customerId
// Return pre-generated (or freshly generated) NBA decisions.
// ---------------------------------------------------------------------------

app.get('/nba/decisions/:customerId', (req, res) => {
  const { customerId } = req.params
  counters.nbaRequests++

  // 404 if profile explicitly suppressed
  const profile = profileStore.get(customerId)
  if (profile && profile._suppressed) {
    return res.status(404).json({ error: 'no_decisions', reason: 'profile_suppressed' })
  }

  // Return existing or generate on-the-fly
  let decisions = nbaStore.get(customerId)
  if (!decisions || decisions.length === 0) {
    decisions = generateDecisions(customerId)
    nbaStore.set(customerId, decisions)
  }

  // Refresh timestamps to simulate a real-time response
  const fresh = decisions.map(d => ({ ...d, timestamp: new Date().toISOString() }))

  logger.debug({ msg: 'nba decisions returned', customerId, count: fresh.length })

  res.status(200).json(fresh)
})

// ---------------------------------------------------------------------------
// GET /health
// ---------------------------------------------------------------------------

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'mock-cdh',
    version: '0.1.0',
    uptime: Math.floor(process.uptime()),
    profileCount: profileStore.size,
    eventCount: eventStore.length,
    consentCount: consentStore.size,
    nbaCount: nbaStore.size,
    counters,
    timestamp: new Date().toISOString()
  })
})

// ---------------------------------------------------------------------------
// GET /profiles  — all stored profiles (for dashboard consumption)
// ---------------------------------------------------------------------------

app.get('/profiles', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '100', 10), MAX_PROFILES)
  const offset = parseInt(req.query.offset || '0', 10)
  const all = Array.from(profileStore.values())
  const page = all.slice(offset, offset + limit)
  res.status(200).json({
    total: all.length,
    limit,
    offset,
    profiles: page
  })
})

// ---------------------------------------------------------------------------
// GET /events  — last 100 events (for dashboard consumption)
// ---------------------------------------------------------------------------

app.get('/events', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '100', 10), 500)
  const recent = eventStore.slice(-limit).reverse()
  res.status(200).json({
    total: eventStore.length,
    limit,
    events: recent
  })
})

// ---------------------------------------------------------------------------
// 404 handler
// ---------------------------------------------------------------------------

app.use((req, res) => {
  res.status(404).json({ error: 'not_found', path: req.path, method: req.method })
})

// ---------------------------------------------------------------------------
// Error handler
// ---------------------------------------------------------------------------

app.use((err, req, res, _next) => {
  logger.error({ msg: 'mock-cdh unhandled error', error: err.message, stack: err.stack })
  res.status(500).json({ error: 'internal_server_error', message: err.message })
})

// ---------------------------------------------------------------------------
// HTTP server + WebSocket server
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT || '3010', 10)
const server = http.createServer(app)

// WebSocket server attached to the same HTTP server, on path /ws
const wss = new WebSocketServer({ server, path: '/ws' })

/** @type {Set<import('ws').WebSocket>} */
const wsClients = new Set()

wss.on('connection', (ws, req) => {
  wsClients.add(ws)
  logger.info({ msg: 'mock-cdh WebSocket client connected', totalClients: wsClients.size, ip: req.socket.remoteAddress })

  // Send a welcome message with current stats
  ws.send(JSON.stringify({
    type: 'connected',
    stats: {
      profileCount: profileStore.size,
      eventCount: eventStore.length
    },
    timestamp: new Date().toISOString()
  }))

  ws.on('close', () => {
    wsClients.delete(ws)
    logger.info({ msg: 'mock-cdh WebSocket client disconnected', totalClients: wsClients.size })
  })

  ws.on('error', (err) => {
    logger.warn({ msg: 'mock-cdh WebSocket error', error: err.message })
    wsClients.delete(ws)
  })

  // Pong on ping
  ws.on('ping', () => ws.pong())
})

/**
 * Broadcast a new event to all connected WebSocket clients.
 * @param {object} event
 */
function broadcastEvent(event) {
  if (wsClients.size === 0) return

  const payload = JSON.stringify({
    type: 'event',
    event,
    stats: {
      profileCount: profileStore.size,
      eventCount: eventStore.length
    },
    timestamp: new Date().toISOString()
  })

  for (const client of wsClients) {
    try {
      if (client.readyState === client.OPEN) {
        client.send(payload)
      }
    } catch (err) {
      logger.warn({ msg: 'mock-cdh WebSocket send error', error: err.message })
      wsClients.delete(client)
    }
  }
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

function shutdown(signal) {
  logger.info({ msg: `mock-cdh received ${signal}, shutting down gracefully` })
  server.close(() => {
    logger.info({ msg: 'mock-cdh HTTP server closed' })
    process.exit(0)
  })
  // Force exit after 10 s
  setTimeout(() => {
    logger.warn({ msg: 'mock-cdh forcing exit after timeout' })
    process.exit(1)
  }, 10000)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

server.listen(PORT, () => {
  logger.info({
    msg: 'mock-cdh started',
    port: PORT,
    endpoints: [
      'POST /dataflow/events',
      'POST /customerprofile',
      'PUT  /customerprofile/:id/consent',
      'GET  /nba/decisions/:customerId',
      'GET  /health',
      'GET  /profiles',
      'GET  /events',
      'WS   /ws'
    ]
  })
})

module.exports = { app, server, wss } // exported for testing
