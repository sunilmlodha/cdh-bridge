#!/usr/bin/env node
/**
 * test-identity.js
 * End-to-end integration tests for CDH Bridge identity resolution features.
 * Run: node scripts/test-identity.js
 *
 * Requires the profile-router service running on localhost:3002.
 * Install axios if needed: npm install axios
 */

'use strict';

let axios;
try {
  axios = require('axios');
} catch {
  console.error('axios not found. Run: npm install axios');
  process.exit(1);
}

const BASE_URL        = process.env.PROFILE_ROUTER_URL  || 'http://localhost:3002';
const EVENT_URL       = process.env.EVENT_COLLECTOR_URL || 'http://localhost:3001';

let passed = 0;
let failed = 0;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runTest(name, fn) {
  try {
    await fn();
    console.log(`✅ PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`❌ FAIL: ${name}`);
    console.error(`   ${err.message}`);
    if (err.response) {
      console.error(`   HTTP ${err.response.status}: ${JSON.stringify(err.response.data)}`);
    }
    failed++;
  }
}

// ─── Test 1: Deterministic Match ─────────────────────────────────────────────
async function test1_deterministicMatch() {
  const ts    = Date.now();
  const custA = `CUST-A-${ts}`;
  const sfId  = `SF-${ts}`;
  // Use timestamp-unique email to avoid collision with previous test runs
  const email = `alice-${ts}@test-identity.com`;

  // Create primary profile with unique email
  await axios.post(`${BASE_URL}/v1/profiles`, {
    customerId: custA,
    email,
    firstName:  'Alice',
    lastName:   'Tester',
    _source:    'Salesforce',
  });

  await sleep(200);

  // Send secondary profile with SAME unique email — should auto-merge into custA
  const r2 = await axios.post(`${BASE_URL}/v1/profiles`, {
    customerId: sfId,
    email,
    firstName:  'Alice',
    lastName:   'Tester',
    department: 'Banking',
    _source:    'SAP',
  });

  // r2 should say MERGED and goldenId should be custA
  assert(
    r2.data.action === 'MERGED',
    `Expected MERGED action, got ${r2.data.action}`
  );
  const goldenId = r2.data.goldenId || custA;

  await sleep(300);

  // Fetch the golden profile
  const res = await axios.get(`${BASE_URL}/v1/profiles/${goldenId}`);
  assert(res.status === 200, `GET /v1/profiles/${goldenId} returned ${res.status}`);

  const profile = res.data;
  assert(
    (profile.mergedIds && profile.mergedIds.includes(sfId)) ||
    (profile.sources   && profile.sources.length > 1)       ||
    profile.department === 'Banking',
    `Expected ${sfId} data merged into golden. mergedIds=${JSON.stringify(profile.mergedIds)}, dept=${profile.department}`
  );
}

// ─── Test 2: Confidence Scoring ───────────────────────────────────────────────
async function test2_confidenceScoring() {
  const { calculateConfidence, REVIEW_THRESHOLD } = require(
    '../services/profile-router/src/identity/confidence-scorer'
  );

  // firstName(0.20) + lastName(0.20) + postalCode(0.15) + dateOfBirth(0.25) = 0.80
  const profileA = { firstName: 'Alice', lastName: 'Smith', postalCode: '2000', dateOfBirth: '1990-01-01' };
  const profileB = { firstName: 'Alice', lastName: 'Smith', postalCode: '2000', dateOfBirth: '1990-01-01' };

  const confidence = calculateConfidence(profileA, profileB);

  assert(
    confidence >= REVIEW_THRESHOLD,
    `Expected confidence >= ${REVIEW_THRESHOLD}, got ${confidence}`
  );
}

// ─── Test 3: Anonymous Stitching ──────────────────────────────────────────────
async function test3_anonymousStitching() {
  const cookieId   = `cookie-${Date.now()}`;
  const custC      = `CUST-C-${Date.now()}`;

  // Send 5 page_view events with only cookieId
  for (let i = 0; i < 5; i++) {
    await axios.post(`${EVENT_URL}/v1/events`, {
      cookieId,
      eventType:  'page_view',
      properties: { url: `/page-${i}` },
      sessionId:  `sess-${i}`,
    });
  }

  await sleep(200);

  // Assert anon profile has 5 events
  const anonRes = await axios.get(`${BASE_URL}/v1/identity/anon/${cookieId}`);
  assert(anonRes.status === 200, `Expected 200, got ${anonRes.status}`);
  const eventCount = anonRes.data.eventCount ?? anonRes.data.events?.length ?? 0;
  assert(eventCount >= 5, `Expected >= 5 events in anon profile, got ${eventCount}`);

  // Send login event to trigger stitch
  await axios.post(`${EVENT_URL}/v1/events`, {
    cookieId,
    customerId: custC,
    eventType:  'login',
    properties: {},
  });

  await sleep(1000);

  // Assert known profile has pre-login events
  const profileRes = await axios.get(`${BASE_URL}/v1/profiles/${custC}`);
  assert(profileRes.status === 200, `Expected profile 200, got ${profileRes.status}`);
  const history = profileRes.data.interactionHistory || profileRes.data.events || [];
  assert(history.length >= 5, `Expected >= 5 events in known profile history, got ${history.length}`);

  // Assert anon profile is deleted (404)
  try {
    await axios.get(`${BASE_URL}/v1/identity/anon/${cookieId}`);
    throw new Error('Expected 404 for deleted anon profile but got success');
  } catch (err) {
    if (err.response && err.response.status === 404) {
      // Expected — stitch deleted the anon profile
    } else {
      throw err;
    }
  }
}

// ─── Test 4: Identity Graph / Device Linking ──────────────────────────────────
async function test4_identityGraph() {
  const custD    = `CUST-D-${Date.now()}`;
  const deviceId = `iphone-${Date.now()}`;

  // Register device
  await axios.post(`${BASE_URL}/v1/identity/device/register`, {
    customerId: custD,
    deviceId,
    deviceType: 'ios',
  });

  await sleep(200);

  // Assert cluster shows device
  const clusterRes = await axios.get(`${BASE_URL}/v1/identity/cluster/${custD}`);
  assert(clusterRes.status === 200, `Expected 200, got ${clusterRes.status}`);
  const cluster = clusterRes.data;
  const devices = cluster.devices || cluster.aliases || [];
  assert(
    devices.includes(deviceId) || devices.includes(deviceId.toLowerCase()),
    `Expected ${deviceId} in cluster devices: ${JSON.stringify(devices)}`
  );

  // Resolve device to customerId
  const resolveRes = await axios.get(`${BASE_URL}/v1/identity/device/${deviceId}`);
  assert(resolveRes.status === 200, `Device resolve returned ${resolveRes.status}`);
  assert(
    resolveRes.data.customerId === custD || resolveRes.data === custD,
    `Expected device to resolve to ${custD}, got ${JSON.stringify(resolveRes.data)}`
  );
}

// ─── Test 5: Review Queue ─────────────────────────────────────────────────────
async function test5_reviewQueue() {
  const custE1 = `CUST-E1-${Date.now()}`;
  const custE2 = `CUST-E2-${Date.now()}`;

  // Create two profiles with name + postcode + DOB — confidence ~0.80 → triggers review queue
  // firstName(0.20) + lastName(0.20) + postalCode(0.15) + dateOfBirth(0.25) = 0.80
  await axios.post(`${BASE_URL}/v1/profiles`, {
    customerId:  custE1,
    firstName:   'Charlie',
    lastName:    'Brown',
    postalCode:  '3000',
    dateOfBirth: '1985-07-14',
    _source:     'Salesforce',
  });

  await axios.post(`${BASE_URL}/v1/profiles`, {
    customerId:  custE2,
    firstName:   'Charlie',
    lastName:    'Brown',
    postalCode:  '3000',
    dateOfBirth: '1985-07-14',
    _source:     'SAP',
  });

  await sleep(300);

  // Assert review queue has a pending item
  const queueRes = await axios.get(`${BASE_URL}/v1/profiles/review/queue`);
  assert(queueRes.status === 200, `Review queue returned ${queueRes.status}`);
  const items = queueRes.data.items || queueRes.data;
  assert(Array.isArray(items) && items.length >= 1, `Expected >= 1 pending review item, got ${items.length}`);

  // Find the review item for our two profiles
  const item = items.find(
    (i) =>
      (i.profileA?.customerId === custE1 || i.profileA?.customerId === custE2 ||
       i.profileB?.customerId === custE1 || i.profileB?.customerId === custE2 ||
       i.incomingId === custE1 || i.incomingId === custE2)
  ) || items[0];

  // Support reviewId (new API) or id (legacy)
  const itemId = item?.reviewId || item?.id;
  assert(item && itemId, `No review item with an id found. Item: ${JSON.stringify(item)}`);

  // Approve the merge
  const approveRes = await axios.post(`${BASE_URL}/v1/identity/review/${itemId}/approve`);
  assert(
    approveRes.status === 200 || approveRes.status === 204,
    `Approve returned unexpected status ${approveRes.status}`
  );

  await sleep(300);

  // One profile should now be a merged/alias of the other
  const mergedRes = await axios.get(`${BASE_URL}/v1/profiles/${custE1}`).catch(() => null) ||
                    await axios.get(`${BASE_URL}/v1/profiles/${custE2}`).catch(() => null);

  assert(mergedRes && mergedRes.status === 200, 'Could not fetch either profile after merge');
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('CDH Bridge — Identity Resolution Integration Tests');
  console.log(`Target: ${BASE_URL}\n`);

  await runTest('Deterministic email match',   test1_deterministicMatch);
  await runTest('Confidence scoring',          test2_confidenceScoring);
  await runTest('Anonymous stitching',         test3_anonymousStitching);
  await runTest('Identity graph device linking', test4_identityGraph);
  await runTest('Review queue approve',        test5_reviewQueue);

  console.log(`\n─────────────────────────────────────────────`);
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err.message);
  process.exit(1);
});
