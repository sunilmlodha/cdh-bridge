#!/usr/bin/env node
/**
 * seed-data.js — Seeds CDH Bridge with realistic demo data
 * Run: node scripts/seed-data.js
 */
'use strict'

const http = require('http')

const SVC = {
  events:    'http://localhost:3001',
  profiles:  'http://localhost:3002',
  feedback:  'http://localhost:3003',
  consent:   'http://localhost:3004',
  mockCdh:   'http://localhost:3010',
}

function post(url, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const u = new URL(url)
    const req = http.request({
      hostname: u.hostname, port: u.port || 80, path: u.pathname + u.search,
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }, res => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(data) }) } catch { resolve({ status: res.statusCode, body: data }) } })
    })
    req.on('error', reject)
    req.write(payload); req.end()
  })
}

function put(url, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const u = new URL(url)
    const req = http.request({
      hostname: u.hostname, port: u.port || 80, path: u.pathname + u.search,
      method: 'PUT', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }, res => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(data) }) } catch { resolve({ status: res.statusCode, body: data }) } })
    })
    req.on('error', reject)
    req.write(payload); req.end()
  })
}

const FIRST_NAMES = ['Alice','Bob','Carlos','Diana','Ethan','Fiona','George','Hannah','Ivan','Julia','Kevin','Laura','Michael','Nina','Oscar']
const LAST_NAMES  = ['Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis','Wilson','Moore','Taylor','Anderson','Thomas','Jackson','White']
const SEGMENTS    = [['HighValue','MortgageHolder'],['ChurnRisk','Savings'],['NewCustomer'],['Premium','InvestmentAccount'],['HighValue','CreditCard'],['Dormant'],['YoungProfessional','Savings'],['SME','BusinessBanking']]
const CHANNELS    = ['web','mobile','email','call_center','sms']
const EVENT_TYPES = ['page_view','product_view','form_submit','offer_accept','offer_reject','login','app_open']
const OFFERS      = ['CreditCardUpgrade','HomeLoanOffer','TermDeposit','InsuranceBundle','InvestmentPlatform','PersonalLoan']

async function main() {
  console.log('\n╔════════════════════════════════════╗')
  console.log('║   CDH Bridge — Seeding Demo Data   ║')
  console.log('╚════════════════════════════════════╝\n')

  let ok = { profiles: 0, events: 0, decisions: 0, consent: 0 }
  const customerIds = []

  // ── 1. Push 20 profiles to Mock CDH + Profile Router ──────────────────────
  process.stdout.write('[1/4] Seeding 20 customer profiles...')
  for (let i = 1; i <= 20; i++) {
    const id    = `CUST-${String(i).padStart(4,'0')}`
    const fname = FIRST_NAMES[(i-1) % FIRST_NAMES.length]
    const lname = LAST_NAMES[(i-1) % LAST_NAMES.length]
    const profile = {
      customerId: id,
      email:      `${fname.toLowerCase()}.${lname.toLowerCase()}@demobank.com`,
      phone:      `+61 4${Math.floor(10000000+Math.random()*89999999)}`,
      firstName:  fname,
      lastName:   lname,
      ltv:        Math.floor(5000 + Math.random() * 95000),
      segments:   SEGMENTS[i % SEGMENTS.length],
      sources:    ['Salesforce','Snowflake'],
      consent:    { emailOptOut: false, smsOptOut: false, gdprErasure: false }
    }
    // Push to mock CDH
    const r = await post(`${SVC.mockCdh}/customerprofile`, profile)
    if (r.status === 200 || r.status === 201) { ok.profiles++; process.stdout.write('.') }
    else process.stdout.write('x')
    customerIds.push(id)
  }
  console.log(`  ✓ ${ok.profiles}/20 profiles seeded to Mock Pega CDH`)

  // ── 2. Send 50 events via Event Collector ─────────────────────────────────
  process.stdout.write('[2/4] Ingesting 50 behavioural events...')
  for (let i = 0; i < 50; i++) {
    const customerId = customerIds[i % customerIds.length]
    const eventType  = EVENT_TYPES[i % EVENT_TYPES.length]
    const channel    = CHANNELS[i % CHANNELS.length]
    const r = await post(`${SVC.events}/v1/events`, {
      customerId, eventType, channel,
      timestamp:  new Date(Date.now() - Math.random() * 3600000).toISOString(),
      properties: { page: '/product/home-loan', value: Math.floor(Math.random()*1000), session: `sess-${i}` }
    })
    if ((r.status === 200 || r.status === 201) && r.body?.success) { ok.events++; process.stdout.write('.') }
    else process.stdout.write('x')
  }
  console.log(`  ✓ ${ok.events}/50 events ingested → Kafka → CDH IH`)

  // ── 3. Record 10 NBA feedback decisions ──────────────────────────────────
  process.stdout.write('[3/4] Recording NBA decision outcomes...')
  const outcomes = ['ACCEPTED','REJECTED','IGNORED','ACCEPTED','CONVERTED','ACCEPTED','REJECTED','ACCEPTED','ACCEPTED','ACCEPTED']
  for (let i = 0; i < 10; i++) {
    const customerId = customerIds[i % customerIds.length]
    const r = await post(`${SVC.feedback}/v1/feedback`, {
      customerId,
      decisionId:     `decision-seed-${i+1}`,
      action:         OFFERS[i % OFFERS.length],
      treatment:      `Treatment-${String.fromCharCode(65 + (i%4))}`,
      outcome:        outcomes[i],
      channel:        CHANNELS[i % CHANNELS.length],
      propensityScore: +(0.3 + Math.random() * 0.6).toFixed(2),
      timestamp:      new Date(Date.now() - Math.random() * 86400000).toISOString()
    })
    if (r.status === 200 || r.status === 201 || r.status === 202) { ok.decisions++; process.stdout.write('.') }
    else process.stdout.write(`x(${r.status})`)
  }
  console.log(`  ✓ ${ok.decisions}/10 NBA decisions recorded (lift tracking active)`)

  // ── 4. Create 2 consent records ──────────────────────────────────────────
  process.stdout.write('[4/4] Creating consent records...')
  const c1 = await post(`${SVC.consent}/v1/consent/optout`, {
    customerId: customerIds[0], channels: ['email'], source: 'preference-centre',
    timestamp: new Date().toISOString()
  })
  if (c1.status <= 201) { ok.consent++; process.stdout.write('.') }

  const c2 = await post(`${SVC.consent}/v1/consent/gdpr-erasure`, {
    customerId: customerIds[1], requestId: `gdpr-seed-001`,
    requestedAt: new Date().toISOString(), verificationToken: 'verified'
  })
  if (c2.status <= 201) { ok.consent++; process.stdout.write('.') }
  console.log(`  ✓ ${ok.consent}/2 consent requests created`)

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n╔══════════════════════════════════════╗')
  console.log('║           Seed Summary               ║')
  console.log('╠══════════════════════════════════════╣')
  console.log(`║  Profiles → Mock Pega CDH : ${String(ok.profiles).padStart(2)}/20     ║`)
  console.log(`║  Events   → Kafka → CDH IH: ${String(ok.events).padStart(2)}/50     ║`)
  console.log(`║  NBA Decisions recorded   : ${String(ok.decisions).padStart(2)}/10     ║`)
  console.log(`║  Consent records created  :  ${String(ok.consent).padStart(1)}/2      ║`)
  console.log('╚══════════════════════════════════════╝')

  // Verify mock-cdh state
  const cdh = await new Promise(res => http.get(`${SVC.mockCdh}/health`, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>res(JSON.parse(d))) }))
  console.log(`\nMock Pega CDH state: ${cdh.profileCount} profiles · ${cdh.eventCount} events · ${cdh.nbaCount} NBA decisions`)
  console.log('\n→ Open http://localhost:3000 for the live dashboard')
  console.log('→ Run node scripts/demo.js for a 30-second live journey\n')
}

main().catch(err => { console.error('Seed failed:', err.message); process.exit(1) })
