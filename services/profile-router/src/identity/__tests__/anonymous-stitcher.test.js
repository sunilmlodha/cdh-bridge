'use strict';

/**
 * Unit tests for anonymous-stitcher with mocked Redis.
 * We mock the profile-store (which exposes getClient) and cdh-push.
 */

// ─── Inline Redis mock ────────────────────────────────────────────────────────
const store = {};
const redisData = {};
const redisTtl  = {};

const mockClient = {
  get:     jest.fn(async (k)          => redisData[k] ?? null),
  setex:   jest.fn(async (k, ttl, v)  => { redisData[k] = v; redisTtl[k] = ttl; }),
  del:     jest.fn(async (...keys)    => { keys.flat().forEach((k) => delete redisData[k]); }),
  zadd:    jest.fn(async ()           => 1),
  expire:  jest.fn(async ()           => 1),
  zcard:   jest.fn(async ()           => 0),
  lpush:   jest.fn(async ()           => 1),
  ltrim:   jest.fn(async ()           => 'OK'),
  keys:    jest.fn(async (pattern)    => Object.keys(redisData).filter((k) => {
    // Very basic glob: replace * with .*
    const re = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    return re.test(k);
  })),
};

jest.mock('../../../profile-store', () => ({
  getClient: () => mockClient,
  get: jest.fn(async (id) => {
    const raw = redisData[`profile:${id}`];
    return raw ? JSON.parse(raw) : null;
  }),
  set: jest.fn(async (id, data) => {
    redisData[`profile:${id}`] = JSON.stringify(data);
  }),
  emailIndexKey: (e) => `idx:email:${e}`,
  phoneIndexKey: (p) => `idx:phone:${p}`,
}), { virtual: true });

jest.mock('../../../cdh-push', () => ({
  pushToCdh: jest.fn(async () => {}),
}), { virtual: true });

jest.mock('../../../logger', () => ({
  info:  jest.fn(),
  debug: jest.fn(),
  warn:  jest.fn(),
  error: jest.fn(),
}), { virtual: true });

// ─── Subject under test ───────────────────────────────────────────────────────
const {
  trackAnonEvent,
  getOrCreateAnon,
  stitchToKnown,
} = require('../anonymous-stitcher');

// ─── Helpers ──────────────────────────────────────────────────────────────────
function clearRedis() {
  Object.keys(redisData).forEach((k) => delete redisData[k]);
  jest.clearAllMocks();
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('anonymous-stitcher', () => {
  beforeEach(clearRedis);

  // 1. trackAnonEvent adds event to anon profile
  test('trackAnonEvent adds an event to the anonymous profile', async () => {
    const cookie = 'ck-test-001';
    const event  = { eventType: 'page_view', url: '/home', sessionId: 'sess-1' };

    const profile = await trackAnonEvent(cookie, event);

    expect(profile.events).toHaveLength(1);
    expect(profile.events[0].eventType).toBe('page_view');
    expect(profile.cookieId).toBe(cookie);
  });

  // 2. 3+ product_view same category → BrowsingHomeLoan segment auto-added
  test('3+ product_view events for same category auto-adds BrowsingHomeLoan segment', async () => {
    const cookie = 'ck-test-002';
    for (let i = 0; i < 3; i++) {
      await trackAnonEvent(cookie, {
        eventType: 'product_view',
        category:  'home loan',
        sessionId: `sess-${i}`,
      });
    }
    const profile = await getOrCreateAnon(cookie);
    expect(profile.segments).toContain('BrowsingHomeLoan');
  });

  // 3. stitchToKnown merges anon events into known profile
  test('stitchToKnown merges anon events into known profile', async () => {
    const cookie     = 'ck-test-003';
    const customerId = 'CUST-TEST-003';

    // Build anon profile with 2 events
    await trackAnonEvent(cookie, { eventType: 'page_view',    url: '/loans' });
    await trackAnonEvent(cookie, { eventType: 'product_view', category: 'savings' });

    const result = await stitchToKnown(cookie, customerId, 'login');

    expect(result.stitched).toBe(true);
    expect(result.signalAdded.events).toBe(2);
  });

  // 4. After stitch, anon profile is deleted
  test('anon profile is deleted from Redis after stitch', async () => {
    const cookie     = 'ck-test-004';
    const customerId = 'CUST-TEST-004';

    await trackAnonEvent(cookie, { eventType: 'page_view', url: '/home' });
    await stitchToKnown(cookie, customerId, 'login');

    // anon profile key should be gone
    const anonRaw = redisData[`anon:profile:${cookie}`];
    expect(anonRaw).toBeUndefined();
  });

  // 5. Stitch returns signalAdded stats
  test('stitchToKnown returns signalAdded stats', async () => {
    const cookie     = 'ck-test-005';
    const customerId = 'CUST-TEST-005';

    for (let i = 0; i < 4; i++) {
      await trackAnonEvent(cookie, {
        eventType: 'page_view',
        url:       `/page-${i}`,
        sessionId: `sess-${i}`,
      });
    }
    // Also trigger a segment
    await trackAnonEvent(cookie, { eventType: 'product_view', category: 'home loan', sessionId: 'sess-pl' });
    await trackAnonEvent(cookie, { eventType: 'product_view', category: 'home loan', sessionId: 'sess-pl2' });
    await trackAnonEvent(cookie, { eventType: 'product_view', category: 'home loan', sessionId: 'sess-pl3' });

    const result = await stitchToKnown(cookie, customerId, 'login-event');

    expect(result.stitched).toBe(true);
    expect(result.customerId).toBe(customerId);
    expect(result.cookieId).toBe(cookie);
    expect(result.signalAdded).toBeDefined();
    expect(result.signalAdded.events).toBeGreaterThan(0);
    expect(Array.isArray(result.signalAdded.segments)).toBe(true);
  });
});
