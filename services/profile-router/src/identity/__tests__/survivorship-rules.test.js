'use strict';

const { applySurvivorshipRules, FIELD_RULES } = require('../survivorship-rules');

describe('survivorship-rules', () => {
  // 1. SOURCE_PRIORITY: Salesforce email wins over SAP email
  test('SOURCE_PRIORITY: Salesforce email wins over SAP email', () => {
    const profiles = [
      { _source: 'SAP',        email: 'sap@corp.com' },
      { _source: 'Salesforce', email: 'sf@corp.com'  },
    ];
    const golden = applySurvivorshipRules(profiles);
    expect(golden.email).toBe('sf@corp.com');
  });

  // 2. UNION: segments from both profiles merged as Set
  test('UNION: segments from both profiles are merged and deduplicated', () => {
    const profiles = [
      { _source: 'Snowflake',  segments: ['HighLTV', 'HomeLoan'] },
      { _source: 'Salesforce', segments: ['HomeLoan', 'OfferSensitive'] },
    ];
    const golden = applySurvivorshipRules(profiles);
    expect(new Set(golden.segments)).toEqual(new Set(['HighLTV', 'HomeLoan', 'OfferSensitive']));
    // No duplicates
    expect(golden.segments.length).toBe(3);
  });

  // 3. MOST_RESTRICTIVE: consent false from either source → result false
  test('MOST_RESTRICTIVE: false consent from either source wins', () => {
    const profiles = [
      { _source: 'Salesforce', consent: { marketing: true,  sms: false } },
      { _source: 'SAP',        consent: { marketing: false, sms: true  } },
    ];
    const golden = applySurvivorshipRules(profiles);
    expect(golden.consent.marketing).toBe(false);
    expect(golden.consent.sms).toBe(false);
  });

  // 4. HIGHEST: larger LTV value wins
  test('HIGHEST: largest LTV value wins', () => {
    const profiles = [
      { _source: 'Snowflake',  ltv: 5000 },
      { _source: 'Salesforce', ltv: 12000 },
    ];
    const golden = applySurvivorshipRules(profiles);
    expect(golden.ltv).toBe(12000);
  });

  // 5. LATEST: most recent churnScore wins
  test('LATEST: most recent churnScore wins', () => {
    const profiles = [
      { _source: 'Snowflake', churnScore: 0.8, updatedAt: '2024-01-01T00:00:00Z' },
      { _source: 'Snowflake', churnScore: 0.3, updatedAt: '2024-06-01T00:00:00Z' },
    ];
    const golden = applySurvivorshipRules(profiles);
    expect(golden.churnScore).toBe(0.3);
  });

  // 6. Missing source field gracefully falls back
  test('SOURCE_PRIORITY: gracefully falls back when highest-priority source has no value', () => {
    const profiles = [
      { _source: 'SAP',        email: 'fallback@sap.com' },
      // Salesforce has no email
      { _source: 'Salesforce', firstName: 'Alice' },
    ];
    const golden = applySurvivorshipRules(profiles);
    // Should fall back to SAP email since Salesforce has none
    expect(golden.email).toBe('fallback@sap.com');
  });
});
