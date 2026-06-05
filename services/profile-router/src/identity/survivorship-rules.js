'use strict';

/**
 * SOURCE_PRIORITY — ordered list of trusted sources per field.
 * First source in array that has a non-null value wins.
 *
 * Special rules:
 *   'UNION'            => merge all values as a Set
 *   'MOST_RESTRICTIVE' => false/null beats true (consent fields)
 *   'LATEST'           => most recent updatedAt wins
 *   'HIGHEST'          => highest numeric value wins (ltv)
 */

const FIELD_RULES = {
  email:            { rule: 'SOURCE_PRIORITY', sources: ['Salesforce', 'SAP', 'Dynamics', 'manual'] },
  phone:            { rule: 'SOURCE_PRIORITY', sources: ['Genesys', 'Salesforce', 'SAP'] },
  firstName:        { rule: 'SOURCE_PRIORITY', sources: ['Salesforce', 'SAP', 'Dynamics'] },
  lastName:         { rule: 'SOURCE_PRIORITY', sources: ['Salesforce', 'SAP', 'Dynamics'] },
  dateOfBirth:      { rule: 'SOURCE_PRIORITY', sources: ['SAP', 'Salesforce'] },
  address:          { rule: 'SOURCE_PRIORITY', sources: ['SAP', 'Salesforce', 'Dynamics'] },
  postalCode:       { rule: 'SOURCE_PRIORITY', sources: ['SAP', 'Salesforce'] },
  ltv:              { rule: 'HIGHEST',          sources: ['Snowflake', 'Salesforce'] },
  churnScore:       { rule: 'LATEST',           sources: ['Snowflake'] },
  tier:             { rule: 'SOURCE_PRIORITY', sources: ['Salesforce', 'Snowflake'] },
  segments:         { rule: 'UNION' },
  sources:          { rule: 'UNION' },
  tags:             { rule: 'UNION' },
  preferredChannel: { rule: 'SOURCE_PRIORITY', sources: ['FeedbackLoop', 'Salesforce'] },
  consent:          { rule: 'MOST_RESTRICTIVE' },
  devices:          { rule: 'UNION' },
};

/**
 * Resolve the value for a SOURCE_PRIORITY field from a list of profiles.
 * Returns the value from the highest-priority source that provides a non-null value.
 *
 * @param {string} field
 * @param {object[]} profiles  — each profile must have a ._source field
 * @param {string[]} sources   — ordered priority list
 * @returns {*}
 */
function resolveSourcePriority(field, profiles, sources) {
  for (const source of sources) {
    for (const profile of profiles) {
      if (profile._source === source && profile[field] != null) {
        return profile[field];
      }
    }
  }
  // Fallback: first non-null value regardless of source
  for (const profile of profiles) {
    if (profile[field] != null) return profile[field];
  }
  return null;
}

/**
 * Resolve a UNION field — merge all values as a Set (deduped array).
 *
 * @param {string} field
 * @param {object[]} profiles
 * @returns {Array}
 */
function resolveUnion(field, profiles) {
  const result = new Set();
  for (const profile of profiles) {
    const val = profile[field];
    if (Array.isArray(val)) {
      val.forEach((v) => result.add(v));
    } else if (val != null) {
      result.add(val);
    }
  }
  return [...result];
}

/**
 * Resolve a MOST_RESTRICTIVE field (for consent objects).
 * false/null beats true across all profiles.
 *
 * @param {string} field
 * @param {object[]} profiles
 * @returns {object}
 */
function resolveMostRestrictive(field, profiles) {
  const merged = {};
  for (const profile of profiles) {
    const consent = profile[field];
    if (!consent || typeof consent !== 'object') continue;
    for (const [key, val] of Object.entries(consent)) {
      if (merged[key] === undefined) {
        merged[key] = val;
      } else {
        // false/null is more restrictive than true
        merged[key] = (merged[key] === false || val === false) ? false : val;
      }
    }
  }
  return merged;
}

/**
 * Resolve a HIGHEST field — return the maximum numeric value.
 *
 * @param {string} field
 * @param {object[]} profiles
 * @returns {number|null}
 */
function resolveHighest(field, profiles) {
  let highest = null;
  for (const profile of profiles) {
    const val = profile[field];
    if (val != null && !isNaN(Number(val))) {
      const num = Number(val);
      if (highest === null || num > highest) highest = num;
    }
  }
  return highest;
}

/**
 * Resolve a LATEST field — return the value from the profile with the most recent updatedAt.
 *
 * @param {string} field
 * @param {object[]} profiles
 * @returns {*}
 */
function resolveLatest(field, profiles) {
  let latestValue = null;
  let latestTs = null;

  for (const profile of profiles) {
    if (profile[field] == null) continue;
    const ts = profile.updatedAt ? new Date(profile.updatedAt).getTime() : 0;
    if (latestTs === null || ts > latestTs) {
      latestTs = ts;
      latestValue = profile[field];
    }
  }
  return latestValue;
}

/**
 * Apply survivorship rules across an array of profiles and produce a single golden record.
 *
 * Each profile is expected to have a ._source field identifying the connector/source system.
 *
 * @param {object[]} profiles
 * @returns {object} golden record
 */
function applySurvivorshipRules(profiles) {
  if (!profiles || profiles.length === 0) return {};
  if (profiles.length === 1) {
    const { _source, ...rest } = profiles[0]; // eslint-disable-line no-unused-vars
    return { ...rest };
  }

  const golden = {};

  // Apply rules for all defined fields
  for (const [field, config] of Object.entries(FIELD_RULES)) {
    switch (config.rule) {
      case 'SOURCE_PRIORITY':
        golden[field] = resolveSourcePriority(field, profiles, config.sources);
        break;
      case 'UNION':
        golden[field] = resolveUnion(field, profiles);
        break;
      case 'MOST_RESTRICTIVE':
        golden[field] = resolveMostRestrictive(field, profiles);
        break;
      case 'HIGHEST':
        golden[field] = resolveHighest(field, profiles);
        break;
      case 'LATEST':
        golden[field] = resolveLatest(field, profiles);
        break;
      default:
        break;
    }
  }

  // Pass through any fields not covered by FIELD_RULES
  // Using the first non-null value found (SOURCE_PRIORITY-like behaviour)
  const coveredFields = new Set(Object.keys(FIELD_RULES));
  const metaFields = new Set(['_source', 'customerId', 'updatedAt', 'createdAt', 'mergedIds', 'mergedAt', 'goldenId']);

  for (const profile of profiles) {
    for (const [key, val] of Object.entries(profile)) {
      if (coveredFields.has(key) || metaFields.has(key) || key.startsWith('_')) continue;
      if (golden[key] == null && val != null) {
        golden[key] = val;
      }
    }
  }

  // Metadata bookkeeping
  golden.sources = resolveUnion('_source', profiles.map((p) => ({ _source: [p._source].filter(Boolean) })));
  if (!golden.sources || golden.sources.length === 0) {
    golden.sources = resolveUnion('sources', profiles);
  }
  golden.updatedAt = new Date().toISOString();

  return golden;
}

module.exports = {
  applySurvivorshipRules,
  FIELD_RULES,
};
