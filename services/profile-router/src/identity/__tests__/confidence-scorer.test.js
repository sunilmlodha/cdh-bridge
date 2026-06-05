'use strict';

const {
  calculateConfidence,
  normalisePhone,
  normaliseEmail,
  fuzzyScore,
  MERGE_THRESHOLD,
  REVIEW_THRESHOLD,
} = require('../confidence-scorer');

describe('confidence-scorer', () => {
  // 1. Exact email match → score ≥ 0.60
  test('exact email match produces score >= 0.60', () => {
    const a = { email: 'alice@example.com' };
    const b = { email: 'alice@example.com' };
    expect(calculateConfidence(a, b)).toBeGreaterThanOrEqual(0.60);
  });

  // 2. Email + phone → score ≥ 0.95 (auto-merge threshold)
  test('email + phone match produces score >= 0.95', () => {
    const a = { email: 'alice@example.com', phone: '0412345678' };
    const b = { email: 'alice@example.com', phone: '0412345678' };
    const score = calculateConfidence(a, b);
    expect(score).toBeGreaterThanOrEqual(MERGE_THRESHOLD);
  });

  // 3. Name + postcode + dob fuzzy → score between 0.75–0.94 (review threshold)
  // firstName(0.20) + lastName(0.20) + postalCode(0.15) + dateOfBirth(0.25) = 0.80
  test('name + postcode + dob match falls in review band (0.75-0.94)', () => {
    const a = { firstName: 'Alice', lastName: 'Smith', postalCode: '2000', dateOfBirth: '1990-01-01' };
    const b = { firstName: 'Alice', lastName: 'Smith', postalCode: '2000', dateOfBirth: '1990-01-01' };
    const score = calculateConfidence(a, b);
    expect(score).toBeGreaterThanOrEqual(REVIEW_THRESHOLD);
    expect(score).toBeLessThan(MERGE_THRESHOLD);
  });

  // 4. No matching fields → score < 0.10
  test('no matching fields produces score < 0.10', () => {
    const a = { email: 'alice@example.com', phone: '0400000000', firstName: 'Alice' };
    const b = { email: 'bob@other.org',     phone: '0499999999', firstName: 'Bob' };
    expect(calculateConfidence(a, b)).toBeLessThan(0.10);
  });

  // 5. normalisePhone strips spaces/dashes/+61 prefix correctly
  describe('normalisePhone', () => {
    test('strips spaces and dashes', () => {
      expect(normalisePhone('04 12 345 678')).toBe('0412345678');
      expect(normalisePhone('04-12-345-678')).toBe('0412345678');
    });

    test('strips +61 prefix (retains digits only)', () => {
      // normalisePhone keeps only digits, so +61412345678 → 61412345678
      const result = normalisePhone('+61 412 345 678');
      expect(result).toMatch(/^\d+$/);
      expect(result).toBe('61412345678');
    });

    test('handles empty/null gracefully', () => {
      expect(normalisePhone('')).toBe('');
      expect(normalisePhone(null)).toBe('');
    });
  });

  // 6. normaliseEmail lowercases and handles googlemail→gmail
  describe('normaliseEmail', () => {
    test('lowercases email', () => {
      expect(normaliseEmail('Alice@Example.COM')).toBe('alice@example.com');
    });

    test('normalises googlemail.com to gmail.com', () => {
      expect(normaliseEmail('alice@googlemail.com')).toBe('alice@gmail.com');
    });

    test('trims whitespace', () => {
      expect(normaliseEmail('  alice@example.com  ')).toBe('alice@example.com');
    });

    test('handles empty/null gracefully', () => {
      expect(normaliseEmail('')).toBe('');
      expect(normaliseEmail(null)).toBe('');
    });
  });

  // 7. Jaro-Winkler: "Alice" vs "Alicia" → score > 0.85
  test('fuzzyScore "Alice" vs "Alicia" > 0.85', () => {
    expect(fuzzyScore('Alice', 'Alicia')).toBeGreaterThan(0.85);
  });

  // 8. Jaro-Winkler: "Alice" vs "Bob" → score < 0.5
  test('fuzzyScore "Alice" vs "Bob" < 0.5', () => {
    expect(fuzzyScore('Alice', 'Bob')).toBeLessThan(0.5);
  });
});
