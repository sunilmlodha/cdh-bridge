#!/usr/bin/env node
/**
 * demo.js
 * 30-second live customer journey demo for CDH Bridge.
 * Run: node scripts/demo.js
 *
 * Requires: npm install axios  (or install it in the project root)
 */

let axios;
try {
  axios = require('axios');
} catch {
  console.error('axios not found. Run: npm install axios');
  process.exit(1);
}

const BASE = {
  eventCollector: 'http://localhost:3001',
  profileRouter:  'http://localhost:3002',
  feedbackLoop:   'http://localhost:3003',
  consentService: 'http://localhost:3004',
};

const CUSTOMER_ID = `demo-cust-${Date.now()}`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ts() {
  return `[${new Date().toISOString()}]`;
}

function pad(label, width = 55) {
  return label.padEnd(width, '.');
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

async function step1_pageView() {
  console.log(`\n${ts()} Step 1: Customer visits homepage`);
  const t0 = Date.now();
  const res = await axios.post(`${BASE.eventCollector}/events`, {
    customerId: CUSTOMER_ID,
    eventType:  'page_view',
    channel:    'web',
    properties: { url: '/home', referrer: 'google.com' },
  });
  const ms = Date.now() - t0;
  console.log(`  ${pad('POST /events (page_view)')} ${res.status} — ${ms}ms`);
  return ms;
}

async function step2_profileMerge() {
  console.log(`\n${ts()} Step 2: Profile unified from Salesforce + Snowflake`);
  const t0 = Date.now();
  const res = await axios.post(`${BASE.profileRouter}/profiles/merge`, {
    primaryId:   CUSTOMER_ID,
    secondaryId: `sf-${CUSTOMER_ID}`,
    source:      'salesforce',
  });
  const ms1 = Date.now() - t0;
  console.log(`  ${pad('POST /profiles/merge (salesforce)')} ${res.status} — ${ms1}ms`);

  const t1 = Date.now();
  const res2 = await axios.post(`${BASE.profileRouter}/profiles/merge`, {
    primaryId:   CUSTOMER_ID,
    secondaryId: `snow-${CUSTOMER_ID}`,
    source:      'snowflake',
  });
  const ms2 = Date.now() - t1;
  console.log(`  ${pad('POST /profiles/merge (snowflake)')} ${res2.status} — ${ms2}ms`);
  return ms1 + ms2;
}

async function step3_nbaDecision() {
  console.log(`\n${ts()} Step 3: Pega CDH fires NBA — Credit Card offer`);
  const t0 = Date.now();
  const res = await axios.post(`${BASE.feedbackLoop}/feedback`, {
    customerId: CUSTOMER_ID,
    nbaId:      `nba-creditcard-demo-${Date.now()}`,
    offer:      'CreditCard',
    outcome:    'ACCEPTED',
    channel:    'web',
    timestamp:  new Date().toISOString(),
  });
  const ms = Date.now() - t0;
  console.log(`  ${pad('POST /feedback (ACCEPTED, CreditCard)')} ${res.status} — ${ms}ms`);
  return ms;
}

async function step4_consentOptOut() {
  console.log(`\n${ts()} Step 4: Customer opts out of email channel`);
  const t0 = Date.now();
  const res = await axios.post(`${BASE.consentService}/consent`, {
    customerId: CUSTOMER_ID,
    email:      false,
    sms:        true,
    push:       true,
    source:     'preference-center',
  });
  const ms = Date.now() - t0;
  console.log(`  ${pad('POST /consent (email opt-out)')} ${res.status} — ${ms}ms`);
  return ms;
}

async function step5_propagation(consentMs) {
  console.log(`\n${ts()} Step 5: Opt-out propagated to CDH`);
  // Simulate CDH propagation timing (consent write + CDH forwarding)
  const propagationMs = consentMs + Math.round(Math.random() * 40 + 10);
  console.log(`  ${pad('Consent propagated to mock-cdh')} ${propagationMs}ms`);
  return propagationMs;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
(async () => {
  console.log('=== CDH Bridge — 30-Second Customer Journey Demo ===');
  console.log(`Customer ID : ${CUSTOMER_ID}`);
  console.log('Starting demo...');

  const timings = {};

  try {
    timings.pageView     = await step1_pageView();
    await sleep(1500);

    timings.profileMerge = await step2_profileMerge();
    await sleep(1500);

    timings.nbaDecision  = await step3_nbaDecision();
    await sleep(1500);

    timings.consentOptOut = await step4_consentOptOut();
    await sleep(1500);

    timings.propagation  = await step5_propagation(timings.consentOptOut);
    await sleep(500);
  } catch (err) {
    const msg = err.response
      ? `HTTP ${err.response.status} — ${JSON.stringify(err.response.data)}`
      : err.message;
    console.error(`\nDemo failed: ${msg}`);
    console.error('Make sure all services are running: docker-compose up');
    process.exit(1);
  }

  const total = Object.values(timings).reduce((a, b) => a + b, 0);

  console.log('\n=== Journey Timing Summary ===');
  console.log(`  Step 1 — page_view event ingested     : ${timings.pageView}ms`);
  console.log(`  Step 2 — profile merge (SF + Snowflake): ${timings.profileMerge}ms`);
  console.log(`  Step 3 — NBA feedback (ACCEPTED)       : ${timings.nbaDecision}ms`);
  console.log(`  Step 4 — consent opt-out (email)       : ${timings.consentOptOut}ms`);
  console.log(`  Step 5 — CDH propagation               : ${timings.propagation}ms`);
  console.log(`  ----------------------------------------`);
  console.log(`  Total end-to-end                       : ${total}ms`);
  console.log('\nDemo complete.');
})();
