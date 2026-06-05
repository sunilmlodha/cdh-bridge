'use strict'

/**
 * @fileoverview Pega CDH API client.
 *
 * Wraps the four core Pega CDH REST endpoints used by CDH Bridge:
 *   - pushEvent(event)          → POST /dataflow/events
 *   - pushProfile(profile)      → POST /customerprofile
 *   - suppressProfile(cId)      → PUT  /customerprofile/:id/consent
 *   - getDecisions(customerId)  → GET  /nba/decisions/:customerId
 *
 * Configuration (via environment variables):
 *   PEGA_CDH_URL        — Base URL of the Pega CDH REST gateway (or mock-cdh in dev)
 *   PEGA_CDH_AUTH_TOKEN — Bearer token for authentication
 *   PEGA_CDH_TIMEOUT    — Request timeout in ms (default: 10000)
 *   PEGA_CDH_RETRIES    — Number of retries on transient errors (default: 3)
 */

const https = require('https')
const http = require('http')
const { URL } = require('url')
const logger = require('./logger')

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function getConfig() {
  return {
    baseUrl: (process.env.PEGA_CDH_URL || 'http://localhost:3010').replace(/\/$/, ''),
    authToken: process.env.PEGA_CDH_AUTH_TOKEN || 'dev-token',
    timeoutMs: parseInt(process.env.PEGA_CDH_TIMEOUT || '10000', 10),
    retries: parseInt(process.env.PEGA_CDH_RETRIES || '3', 10)
  }
}

// ---------------------------------------------------------------------------
// Low-level HTTP helper
// ---------------------------------------------------------------------------

/**
 * Make an HTTP/HTTPS request and return the parsed JSON body.
 *
 * @param {'GET'|'POST'|'PUT'|'DELETE'|'PATCH'} method
 * @param {string} path    - Path relative to baseUrl (must start with /)
 * @param {any}    [body]  - JSON-serialisable request body (for POST/PUT)
 * @returns {Promise<{ statusCode: number, body: any }>}
 */
function request(method, path, body) {
  const config = getConfig()
  const url = new URL(config.baseUrl + path)
  const isHttps = url.protocol === 'https:'
  const transport = isHttps ? https : http

  const payload = body !== undefined ? JSON.stringify(body) : undefined

  const options = {
    hostname: url.hostname,
    port: url.port || (isHttps ? 443 : 80),
    path: url.pathname + url.search,
    method,
    timeout: config.timeoutMs,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${config.authToken}`,
      'X-CDH-Bridge-Version': '0.1.0'
    }
  }

  if (payload) {
    options.headers['Content-Length'] = Buffer.byteLength(payload)
  }

  return new Promise((resolve, reject) => {
    const req = transport.request(options, (res) => {
      let raw = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { raw += chunk })
      res.on('end', () => {
        let parsed = null
        try {
          parsed = raw ? JSON.parse(raw) : null
        } catch {
          parsed = { _raw: raw }
        }
        resolve({ statusCode: res.statusCode, body: parsed })
      })
    })

    req.on('timeout', () => {
      req.destroy()
      reject(new Error(`Pega CDH request timed out after ${config.timeoutMs}ms: ${method} ${path}`))
    })

    req.on('error', (err) => {
      reject(new Error(`Pega CDH request error: ${err.message}`))
    })

    if (payload) req.write(payload)
    req.end()
  })
}

/**
 * Retry wrapper — retries on network errors and 5xx responses.
 *
 * @param {Function} fn    - Async function to retry
 * @param {number}   retries
 * @returns {Promise<any>}
 */
async function withRetry(fn, retries) {
  let lastErr
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      const result = await fn()
      // Retry on 5xx responses
      if (result.statusCode >= 500) {
        lastErr = new Error(`Pega CDH returned ${result.statusCode}`)
        if (attempt <= retries) {
          const delay = Math.min(attempt * 300, 2000)
          logger.warn({ msg: 'Pega CDH transient error, retrying', attempt, statusCode: result.statusCode, delayMs: delay })
          await new Promise(r => setTimeout(r, delay))
          continue
        }
        throw lastErr
      }
      return result
    } catch (err) {
      lastErr = err
      if (attempt <= retries) {
        const delay = Math.min(attempt * 300, 2000)
        logger.warn({ msg: 'Pega CDH request failed, retrying', attempt, error: err.message, delayMs: delay })
        await new Promise(r => setTimeout(r, delay))
      }
    }
  }
  throw lastErr
}

// ---------------------------------------------------------------------------
// Public API methods
// ---------------------------------------------------------------------------

/**
 * Push a behavioural event to the Pega CDH Data Flow API.
 *
 * @param {import('./types').CdhEvent} event
 * @returns {Promise<{ statusCode: number, body: any }>}
 */
async function pushEvent(event) {
  const config = getConfig()
  logger.debug({ msg: 'Pega CDH pushEvent', eventId: event.eventId, customerId: event.customerId, eventType: event.eventType })

  const result = await withRetry(
    () => request('POST', '/dataflow/events', event),
    config.retries
  )

  if (result.statusCode >= 400) {
    logger.error({ msg: 'Pega CDH pushEvent rejected', statusCode: result.statusCode, eventId: event.eventId, body: result.body })
    throw new Error(`Pega CDH pushEvent failed with status ${result.statusCode}`)
  }

  logger.info({ msg: 'Pega CDH pushEvent success', eventId: event.eventId, statusCode: result.statusCode })
  return result
}

/**
 * Push a unified customer profile to the Pega CDH Customer Profile API.
 *
 * @param {import('./types').CustomerProfile} profile
 * @returns {Promise<{ statusCode: number, body: any }>}
 */
async function pushProfile(profile) {
  const config = getConfig()
  logger.debug({ msg: 'Pega CDH pushProfile', customerId: profile.customerId })

  const result = await withRetry(
    () => request('POST', '/customerprofile', profile),
    config.retries
  )

  if (result.statusCode >= 400) {
    logger.error({ msg: 'Pega CDH pushProfile rejected', statusCode: result.statusCode, customerId: profile.customerId, body: result.body })
    throw new Error(`Pega CDH pushProfile failed with status ${result.statusCode}`)
  }

  logger.info({ msg: 'Pega CDH pushProfile success', customerId: profile.customerId, statusCode: result.statusCode })
  return result
}

/**
 * Suppress a customer profile in Pega CDH (GDPR erasure / consent opt-out).
 * Sends a PUT request to the consent endpoint with suppress=true.
 *
 * @param {string} customerId
 * @returns {Promise<{ statusCode: number, body: any }>}
 */
async function suppressProfile(customerId) {
  if (!customerId) throw new Error('suppressProfile requires a customerId')

  const config = getConfig()
  logger.info({ msg: 'Pega CDH suppressProfile', customerId })

  const payload = {
    suppress: true,
    suppressedAt: new Date().toISOString(),
    reason: 'consent-service'
  }

  const result = await withRetry(
    () => request('PUT', `/customerprofile/${encodeURIComponent(customerId)}/consent`, payload),
    config.retries
  )

  if (result.statusCode >= 400) {
    logger.error({ msg: 'Pega CDH suppressProfile rejected', statusCode: result.statusCode, customerId, body: result.body })
    throw new Error(`Pega CDH suppressProfile failed with status ${result.statusCode}`)
  }

  logger.info({ msg: 'Pega CDH suppressProfile success', customerId, statusCode: result.statusCode })
  return result
}

/**
 * Retrieve Next-Best-Action decisions for a customer from Pega CDH.
 *
 * @param {string} customerId
 * @returns {Promise<import('./types').NBADecision[]>}
 */
async function getDecisions(customerId) {
  if (!customerId) throw new Error('getDecisions requires a customerId')

  const config = getConfig()
  logger.debug({ msg: 'Pega CDH getDecisions', customerId })

  const result = await withRetry(
    () => request('GET', `/nba/decisions/${encodeURIComponent(customerId)}`),
    config.retries
  )

  if (result.statusCode === 404) {
    logger.info({ msg: 'Pega CDH getDecisions: no decisions found', customerId })
    return []
  }

  if (result.statusCode >= 400) {
    logger.error({ msg: 'Pega CDH getDecisions rejected', statusCode: result.statusCode, customerId, body: result.body })
    throw new Error(`Pega CDH getDecisions failed with status ${result.statusCode}`)
  }

  const decisions = Array.isArray(result.body) ? result.body : (result.body?.decisions || [])
  logger.info({ msg: 'Pega CDH getDecisions success', customerId, count: decisions.length })
  return decisions
}

/**
 * Health-check the Pega CDH endpoint (or mock).
 * @returns {Promise<boolean>}
 */
async function healthCheck() {
  try {
    const result = await request('GET', '/health')
    return result.statusCode < 400
  } catch {
    return false
  }
}

module.exports = {
  pushEvent,
  pushProfile,
  suppressProfile,
  getDecisions,
  healthCheck
}
