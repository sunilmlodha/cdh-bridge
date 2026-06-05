'use strict';

/**
 * Calculates a confidence score (0–1) that two profile fragments
 * belong to the same real-world person.
 *
 * Scoring matrix:
 *  email exact match          +0.60
 *  phone exact match          +0.50
 *  crmId exact match          +0.70
 *  deviceId exact match       +0.40
 *  firstName fuzzy >= 0.9     +0.20
 *  lastName  fuzzy >= 0.9     +0.20
 *  postalCode exact           +0.15
 *  dateOfBirth exact          +0.25
 *  emailDomain match          +0.05   (same domain, different local)
 *
 * Score clamped to 1.0.
 * MERGE_THRESHOLD  = 0.95  => auto merge
 * REVIEW_THRESHOLD = 0.75  => queue for human review
 * Below 0.75               => no match
 */

const MERGE_THRESHOLD  = 0.95;
const REVIEW_THRESHOLD = 0.75;

/**
 * Normalise a phone number by stripping all non-digit characters.
 * @param {string} phone
 * @returns {string}
 */
function normalisePhone(phone) {
  if (!phone) return '';
  return String(phone).replace(/\D/g, '');
}

/**
 * Normalise an email address:
 *  - lowercase and trim
 *  - expand googlemail.com -> gmail.com
 * @param {string} email
 * @returns {string}
 */
function normaliseEmail(email) {
  if (!email) return '';
  let e = String(email).toLowerCase().trim();
  // Expand googlemail.com to gmail.com
  e = e.replace(/@googlemail\.com$/, '@gmail.com');
  return e;
}

/**
 * Jaro similarity between two strings.
 * @param {string} s1
 * @param {string} s2
 * @returns {number} 0–1
 */
function jaro(s1, s2) {
  if (s1 === s2) return 1;
  const len1 = s1.length;
  const len2 = s2.length;
  if (len1 === 0 || len2 === 0) return 0;

  const matchWindow = Math.max(Math.floor(Math.max(len1, len2) / 2) - 1, 0);

  const s1Matches = new Array(len1).fill(false);
  const s2Matches = new Array(len2).fill(false);

  let matches = 0;
  let transpositions = 0;

  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchWindow);
    const end   = Math.min(i + matchWindow + 1, len2);
    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;

  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  return (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3;
}

/**
 * Jaro-Winkler similarity. Gives extra weight to strings that share a common prefix.
 * @param {string} a
 * @param {string} b
 * @returns {number} 0–1
 */
function fuzzyScore(a, b) {
  if (!a || !b) return 0;
  const s1 = String(a).toLowerCase();
  const s2 = String(b).toLowerCase();
  if (s1 === s2) return 1;

  const jaroSim = jaro(s1, s2);

  // Common prefix length (max 4)
  let prefixLen = 0;
  const maxPrefix = Math.min(4, Math.min(s1.length, s2.length));
  while (prefixLen < maxPrefix && s1[prefixLen] === s2[prefixLen]) {
    prefixLen++;
  }

  // Jaro-Winkler scaling factor p = 0.1
  return jaroSim + prefixLen * 0.1 * (1 - jaroSim);
}

/**
 * Extract email domain from a normalised email address.
 * @param {string} email
 * @returns {string}
 */
function emailDomain(email) {
  const idx = email.indexOf('@');
  return idx >= 0 ? email.slice(idx + 1) : '';
}

/**
 * Calculate a confidence score that profileA and profileB represent the same person.
 *
 * @param {object} profileA
 * @param {object} profileB
 * @returns {number} 0–1
 */
function calculateConfidence(profileA, profileB) {
  if (!profileA || !profileB) return 0;

  let score = 0;

  // --- crmId exact match (+0.70) ---
  if (profileA.crmId && profileB.crmId) {
    if (String(profileA.crmId) === String(profileB.crmId)) {
      score += 0.70;
    }
  }

  // --- email exact match (+0.60) / domain match (+0.05) ---
  const emailA = normaliseEmail(profileA.email || '');
  const emailB = normaliseEmail(profileB.email || '');
  if (emailA && emailB) {
    if (emailA === emailB) {
      score += 0.60;
    } else {
      const domA = emailDomain(emailA);
      const domB = emailDomain(emailB);
      if (domA && domA === domB) {
        score += 0.05;
      }
    }
  }

  // --- phone exact match (+0.50) ---
  const phoneA = normalisePhone(profileA.phone || '');
  const phoneB = normalisePhone(profileB.phone || '');
  if (phoneA && phoneB && phoneA === phoneB) {
    score += 0.50;
  }

  // --- deviceId exact match (+0.40) ---
  const devA = profileA.deviceId || (Array.isArray(profileA.devices) ? profileA.devices[0] : null);
  const devB = profileB.deviceId || (Array.isArray(profileB.devices) ? profileB.devices[0] : null);
  if (devA && devB && String(devA) === String(devB)) {
    score += 0.40;
  } else if (Array.isArray(profileA.devices) && Array.isArray(profileB.devices)) {
    // Check if any device IDs overlap
    const setA = new Set(profileA.devices.map(String));
    const overlap = profileB.devices.some((d) => setA.has(String(d)));
    if (overlap) score += 0.40;
  }

  // --- dateOfBirth exact match (+0.25) ---
  if (profileA.dateOfBirth && profileB.dateOfBirth) {
    const dobA = String(profileA.dateOfBirth).trim();
    const dobB = String(profileB.dateOfBirth).trim();
    if (dobA === dobB) score += 0.25;
  }

  // --- firstName fuzzy >= 0.9 (+0.20) ---
  if (profileA.firstName && profileB.firstName) {
    const fnSim = fuzzyScore(profileA.firstName, profileB.firstName);
    if (fnSim >= 0.9) score += 0.20;
  }

  // --- lastName fuzzy >= 0.9 (+0.20) ---
  if (profileA.lastName && profileB.lastName) {
    const lnSim = fuzzyScore(profileA.lastName, profileB.lastName);
    if (lnSim >= 0.9) score += 0.20;
  }

  // --- postalCode exact match (+0.15) ---
  if (profileA.postalCode && profileB.postalCode) {
    const pcA = String(profileA.postalCode).replace(/\s/g, '').toLowerCase();
    const pcB = String(profileB.postalCode).replace(/\s/g, '').toLowerCase();
    if (pcA === pcB) score += 0.15;
  }

  return Math.min(score, 1.0);
}

module.exports = {
  calculateConfidence,
  normalisePhone,
  normaliseEmail,
  fuzzyScore,
  MERGE_THRESHOLD,
  REVIEW_THRESHOLD,
};
