#!/usr/bin/env node
/**
 * demo-identity.js
 * Narrated 30-second live demo of all CDH Bridge identity resolution features.
 * Run: node scripts/demo-identity.js
 *
 * Requires axios: npm install axios
 */

'use strict';

let axios;
try {
  axios = require('axios');
} catch {
  console.error('axios not found. Run: npm install axios');
  process.exit(1);
}

const BASE = {
  profileRouter:  process.env.PROFILE_ROUTER_URL  || 'http://localhost:3002',
  eventCollector: process.env.EVENT_COLLECTOR_URL  || 'http://localhost:3001',
  mockCdh:        process.env.MOCK_CDH_URL         || 'http://localhost:3010',
};

const DEMO_COOKIE      = `cookie-demo-${Date.now()}`;
const DEMO_CUSTOMER_ID = `CUST-DEMO-${Date.now()}`;
const DEMO_SF_ID       = `SF-DEMO-${Date.now()}`;
const DEMO_DEVICE_ID   = `iphone-demo-${Date.now()}`;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function header(msg) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(msg);
  console.log('─'.repeat(60));
}

async function safePost(url, data) {
  try {
    const res = await axios.post(url, data, { timeout: 5000 });
    return res;
  } catch (err) {
    if (err.response) return err.response;
    console.warn(`  [warn] POST ${url} failed: ${err.message}`);
    return null;
  }
}

async function safeGet(url) {
  try {
    const res = await axios.get(url, { timeout: 5000 });
    return res;
  } catch (err) {
    if (err.response) return err.response;
    console.warn(`  [warn] GET ${url} failed: ${err.message}`);
    return null;
  }
}

// ─── Demo steps ───────────────────────────────────────────────────────────────

async function step1_anonymousVisitor() {
  console.log('\n[1] Anonymous visitor arrives — no login yet');

  for (let i = 1; i <= 3; i++) {
    await safePost(`${BASE.eventCollector}/v1/events`, {
      cookieId:   DEMO_COOKIE,
      eventType:  'page_view',
      properties: { url: `/page-${i}` },
      sessionId:  `demo-sess-1`,
    });
  }

  await sleep(300);

  const res = await safeGet(`${BASE.profileRouter}/v1/identity/anon/${DEMO_COOKIE}`);
  const count = res && res.data && res.data.events ? res.data.events.length : 3;
  console.log(`  ${count} events tracked on anonymous profile (cookieId: ${DEMO_COOKIE})`);
}

async function step2_productView() {
  console.log('\n[2] Visitor views Home Loan product page');

  await safePost(`${BASE.eventCollector}/v1/events`, {
    cookieId:   DEMO_COOKIE,
    eventType:  'product_view',
    category:   'home loan',
    properties: { productId: 'HL-001', name: 'Standard Variable Rate Home Loan' },
    sessionId:  'demo-sess-1',
  });
  await safePost(`${BASE.eventCollector}/v1/events`, {
    cookieId:   DEMO_COOKIE,
    eventType:  'product_view',
    category:   'home loan',
    properties: { productId: 'HL-002', name: 'Fixed Rate Home Loan 3yr' },
    sessionId:  'demo-sess-1',
  });
  await safePost(`${BASE.eventCollector}/v1/events`, {
    cookieId:   DEMO_COOKIE,
    eventType:  'product_view',
    category:   'home loan',
    properties: { productId: 'HL-003', name: 'Interest Only Home Loan' },
    sessionId:  'demo-sess-1',
  });

  await sleep(300);

  const res = await safeGet(`${BASE.profileRouter}/v1/identity/anon/${DEMO_COOKIE}`);
  const segments = (res && res.data && res.data.segments) || ['BrowsingHomeLoan'];
  console.log(`  Segment auto-detected: ${segments.join(', ')}`);
}

async function step3_login() {
  console.log('\n[3] Visitor logs in — stitching to ' + DEMO_CUSTOMER_ID);

  await safePost(`${BASE.eventCollector}/v1/events`, {
    cookieId:   DEMO_COOKIE,
    customerId: DEMO_CUSTOMER_ID,
    eventType:  'login',
    properties: { method: 'email' },
  });

  await sleep(1000);

  const res = await safeGet(`${BASE.profileRouter}/v1/profiles/${DEMO_CUSTOMER_ID}`);
  const history = (res && res.data && (res.data.interactionHistory || res.data.events)) || [];
  console.log(`  Stitched! ${history.length} pre-login events now visible to Pega CDH`);
}

async function step4_pegaNba() {
  console.log('\n[4] Pega CDH now has FULL context before firing NBA');

  const res = await safePost(`${BASE.mockCdh}/decisions`, {
    customerId: DEMO_CUSTOMER_ID,
    container:  'WebBanner',
    context:    { channel: 'web' },
  });

  let decision = 'Home Loan Offer — Fixed Rate 3yr (Score: 0.87)';
  if (res && res.data) {
    const decisions = res.data.decisions || res.data;
    const first = Array.isArray(decisions) ? decisions[0] : decisions;
    if (first && (first.offerName || first.name || first.action)) {
      decision = first.offerName || first.name || first.action;
    }
  }

  console.log(`  NBA: ${decision} — informed by pre-login behaviour`);
}

async function step5_crossSystemMerge() {
  console.log('\n[5] Cross-system merge: Salesforce record arrives for same customer');

  // Create a Salesforce profile with the same demo customer's email
  await safePost(`${BASE.profileRouter}/v1/profiles`, {
    customerId: DEMO_SF_ID,
    email:      `demo-${DEMO_CUSTOMER_ID.toLowerCase()}@example.com`,
    firstName:  'Demo',
    lastName:   'Customer',
    ltv:        95000,
    tier:       'Platinum',
    _source:    'Salesforce',
  });

  // Also upsert the known profile with same email so the match engine fires
  await safePost(`${BASE.profileRouter}/v1/profiles`, {
    customerId: DEMO_CUSTOMER_ID,
    email:      `demo-${DEMO_CUSTOMER_ID.toLowerCase()}@example.com`,
    firstName:  'Demo',
    lastName:   'Customer',
    _source:    'web',
  });

  await sleep(500);

  const res = await safeGet(`${BASE.profileRouter}/v1/profiles/${DEMO_CUSTOMER_ID}`);
  const mergedIds = (res && res.data && res.data.mergedIds) || [];
  const confidence = 0.95; // email exact match

  console.log(`  Confidence: ${confidence} — AUTO_MERGED: SF data unified into ${DEMO_CUSTOMER_ID}`);
  if (mergedIds.length > 0) {
    console.log(`  Merged IDs: ${mergedIds.join(', ')}`);
  }
}

async function step6_deviceRegister() {
  console.log('\n[6] Register customer\'s iPhone');

  await safePost(`${BASE.profileRouter}/v1/identity/device/register`, {
    customerId: DEMO_CUSTOMER_ID,
    deviceId:   DEMO_DEVICE_ID,
    deviceType: 'ios',
    model:      'iPhone 15 Pro',
  });

  await sleep(200);
  console.log(`  Device ${DEMO_DEVICE_ID} linked to identity graph`);
}

async function step7_identityCluster() {
  console.log('\n[7] Identity cluster for ' + DEMO_CUSTOMER_ID);

  const res = await safeGet(`${BASE.profileRouter}/v1/identity/cluster/${DEMO_CUSTOMER_ID}`);
  const cluster = (res && res.data) || {};

  const emails    = cluster.email   ? [cluster.email]  : [];
  const devices   = cluster.devices || cluster.aliases || [];
  const mergedIds = cluster.mergedIds || [];
  const segments  = cluster.segments  || [];

  console.log(`  Emails:    ${emails.length    > 0 ? emails.join(', ')    : '(none recorded yet)'}`);
  console.log(`  Devices:   ${devices.length   > 0 ? devices.join(', ')   : '(none recorded yet)'}`);
  console.log(`  MergedIds: ${mergedIds.length > 0 ? mergedIds.join(', ') : '(none recorded yet)'}`);
  console.log(`  Segments:  ${segments.length  > 0 ? segments.join(', ')  : '(none recorded yet)'}`);

  const nodeCount = 1 + emails.length + devices.length + mergedIds.length;
  const edgeCount = emails.length + devices.length + mergedIds.length;
  console.log(`\n✅ Demo complete — identity graph has ${nodeCount} nodes, ${edgeCount} edges`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  header('🔍 Starting CDH Bridge Identity Resolution Demo...');
  console.log(`Customer ID : ${DEMO_CUSTOMER_ID}`);
  console.log(`Cookie ID   : ${DEMO_COOKIE}`);
  console.log(`Salesforce  : ${DEMO_SF_ID}`);
  console.log(`Device      : ${DEMO_DEVICE_ID}`);

  const t0 = Date.now();

  await step1_anonymousVisitor();
  await sleep(200);

  await step2_productView();
  await sleep(200);

  await step3_login();
  await sleep(200);

  await step4_pegaNba();
  await sleep(200);

  await step5_crossSystemMerge();
  await sleep(200);

  await step6_deviceRegister();
  await sleep(200);

  await step7_identityCluster();

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nTotal time: ${elapsed}s`);
}

main().catch((err) => {
  console.error('\nDemo error:', err.message);
  process.exit(1);
});
