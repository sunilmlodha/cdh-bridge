'use strict';

/**
 * Universal Field Mapper
 *
 * fieldMappings: Array of { source, target, transform? }
 * Transforms: uppercase, lowercase, parseDate, parseCurrency, lookup(table), trim, toNumber, toBoolean
 */

const BUILT_IN_TRANSFORMS = {
  uppercase: (val) => (typeof val === 'string' ? val.toUpperCase() : val),
  lowercase: (val) => (typeof val === 'string' ? val.toLowerCase() : val),
  trim: (val) => (typeof val === 'string' ? val.trim() : val),
  toNumber: (val) => {
    const n = Number(val);
    return isNaN(n) ? null : n;
  },
  toBoolean: (val) => {
    if (typeof val === 'boolean') return val;
    if (typeof val === 'string') return ['true', '1', 'yes'].includes(val.toLowerCase());
    return Boolean(val);
  },
  parseDate: (val) => {
    if (!val) return null;
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d.toISOString();
  },
  parseCurrency: (val) => {
    if (val == null) return null;
    const str = String(val).replace(/[^0-9.-]/g, '');
    const n = parseFloat(str);
    return isNaN(n) ? null : n;
  }
};

/**
 * Get a nested value from an object using dot notation.
 */
function getNestedValue(obj, path) {
  return path.split('.').reduce((current, key) => {
    if (current == null) return undefined;
    return current[key];
  }, obj);
}

/**
 * Set a nested value on an object using dot notation.
 */
function setNestedValue(obj, path, value) {
  const keys = path.split('.');
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (current[keys[i]] == null || typeof current[keys[i]] !== 'object') {
      current[keys[i]] = {};
    }
    current = current[keys[i]];
  }
  current[keys[keys.length - 1]] = value;
}

/**
 * Apply a transform to a value.
 * transform can be:
 *   - string: built-in transform name
 *   - { type: 'lookup', table: { key: value } }
 *   - { type: 'prefix', value: 'PREFIX_' }
 *   - { type: 'suffix', value: '_SUFFIX' }
 *   - { type: 'default', value: defaultValue }
 *   - function (not serializable, for programmatic use)
 */
function applyTransform(value, transform) {
  if (!transform) return value;

  if (typeof transform === 'function') {
    return transform(value);
  }

  if (typeof transform === 'string') {
    const fn = BUILT_IN_TRANSFORMS[transform];
    if (!fn) throw new Error(`Unknown transform: ${transform}`);
    return fn(value);
  }

  if (typeof transform === 'object') {
    switch (transform.type) {
      case 'lookup': {
        const table = transform.table || {};
        return table[value] !== undefined ? table[value] : (transform.default !== undefined ? transform.default : value);
      }
      case 'prefix':
        return `${transform.value}${value}`;
      case 'suffix':
        return `${value}${transform.value}`;
      case 'default':
        return value != null && value !== '' ? value : transform.value;
      case 'chain': {
        let v = value;
        for (const t of (transform.transforms || [])) {
          v = applyTransform(v, t);
        }
        return v;
      }
      default:
        throw new Error(`Unknown transform type: ${transform.type}`);
    }
  }

  return value;
}

/**
 * Map a raw record to a target object using fieldMappings.
 *
 * @param {Object} raw - Source record
 * @param {Array} fieldMappings - Array of { source, target, transform?, required?, defaultValue? }
 * @param {Object} [baseTarget={}] - Base target object to merge into
 * @returns {Object} Mapped object
 */
function mapFields(raw, fieldMappings, baseTarget = {}) {
  const result = { ...baseTarget };

  for (const mapping of fieldMappings) {
    const { source, target, transform, required, defaultValue } = mapping;

    let value = getNestedValue(raw, source);

    if (value == null && defaultValue !== undefined) {
      value = defaultValue;
    }

    if (required && (value == null || value === '')) {
      throw new Error(`Required field missing: ${source}`);
    }

    if (value != null) {
      const transformed = applyTransform(value, transform);
      setNestedValue(result, target, transformed);
    }
  }

  return result;
}

/**
 * Build a CustomerProfile from a raw record using field mappings.
 * Always includes standard CDH fields.
 */
function toCustomerProfile(raw, fieldMappings, connectorId, sourceType) {
  const profile = mapFields(raw, fieldMappings, {
    customerId: null,
    email: null,
    phone: null,
    firstName: null,
    lastName: null,
    ltv: null,
    segments: [],
    traits: {},
    sourceType: sourceType || connectorId,
    connectorId,
    ingestedAt: new Date().toISOString()
  });

  // Ensure customerId falls back to email if not mapped
  if (!profile.customerId && profile.email) {
    profile.customerId = `${connectorId}:${profile.email}`;
  }

  return profile;
}

module.exports = { mapFields, toCustomerProfile, applyTransform, getNestedValue, setNestedValue };
