'use strict';

/**
 * Source system field name translation tables.
 * Maps source-system field names to canonical profile field names.
 */
const FIELD_MAP = {
  // Salesforce → canonical
  salesforce: {
    Email: 'email',
    Phone: 'phone',
    MobilePhone: 'phone',
    FirstName: 'firstName',
    LastName: 'lastName',
    Birthdate: 'dateOfBirth',
    MailingCity: 'city',
    MailingState: 'state',
    MailingCountry: 'country',
    MailingPostalCode: 'postalCode',
    MailingStreet: 'address',
    LTV__c: 'ltv',
    Customer_Tier__c: 'tier',
    Language__c: 'language',
    Currency_Preference__c: 'currency',
    Segment__c: 'segments',
    HasOptedOutOfEmail: '_emailOptOut',
    HasOptedOutOfFax: '_faxOptOut',
  },

  // SAP → canonical
  sap: {
    SMTP_ADDR: 'email',
    TEL1_NUMBR: 'phone',
    NAME_FIRST: 'firstName',
    NAME_LAST: 'lastName',
    BIRTHDT: 'dateOfBirth',
    CITY1: 'city',
    REGIO: 'state',
    LAND1: 'country',
    POST_CODE1: 'postalCode',
    STREET: 'address',
    LIFETIME_VALUE: 'ltv',
    CUSTOMER_CLASS: 'tier',
    LANGU: 'language',
    WAERS: 'currency',
    SALES_SEGMENT: 'segments',
  },

  // Snowflake → canonical
  snowflake: {
    customer_email: 'email',
    customer_phone: 'phone',
    first_name: 'firstName',
    last_name: 'lastName',
    birth_date: 'dateOfBirth',
    city: 'city',
    state_province: 'state',
    country_code: 'country',
    postal_code: 'postalCode',
    street_address: 'address',
    lifetime_value_usd: 'ltv',
    customer_tier: 'tier',
    preferred_language: 'language',
    preferred_currency: 'currency',
    segment_list: 'segments',
    email_opt_in: '_emailOptIn',
    sms_opt_in: '_smsOptIn',
  },
};

/**
 * Translate a source-system record to canonical field names.
 */
function translateFields(source, record) {
  const map = FIELD_MAP[source.toLowerCase()];
  if (!map) {
    // No translation table — return as-is
    return { ...record };
  }
  const canonical = {};
  for (const [srcField, value] of Object.entries(record)) {
    const canonicalField = map[srcField] || srcField;
    canonical[canonicalField] = value;
  }
  return canonical;
}

/**
 * Normalize email address: lowercase, trim.
 */
function normalizeEmail(email) {
  if (!email || typeof email !== 'string') return null;
  return email.trim().toLowerCase();
}

/**
 * Normalize phone number: strip non-digits, optionally format.
 * Returns E.164-style (digits only, no +) or null.
 */
function normalizePhone(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length < 7) return null;
  // If 10 digits, assume US and prefix with 1
  if (digits.length === 10) return `1${digits}`;
  return digits;
}

/**
 * Normalize segments: ensure array of non-empty strings, deduped, uppercased.
 */
function normalizeSegments(segments) {
  if (!segments) return [];
  const arr = Array.isArray(segments)
    ? segments
    : String(segments).split(/[,;|]/).map((s) => s.trim());
  return [...new Set(arr.filter(Boolean).map((s) => s.toUpperCase()))];
}

/**
 * Normalize LTV: coerce to float, clamp to >= 0.
 */
function normalizeLtv(ltv) {
  const val = parseFloat(ltv);
  if (isNaN(val)) return null;
  return Math.max(0, val);
}

/**
 * Normalize a full profile object, translating source-system field names
 * and applying field-level normalization.
 */
function normalizeProfile(source, rawProfile) {
  const canonical = translateFields(source, rawProfile);

  // Apply field-level normalizers
  if (canonical.email !== undefined) canonical.email = normalizeEmail(canonical.email);
  if (canonical.phone !== undefined) canonical.phone = normalizePhone(canonical.phone);
  if (canonical.segments !== undefined) canonical.segments = normalizeSegments(canonical.segments);
  if (canonical.ltv !== undefined) canonical.ltv = normalizeLtv(canonical.ltv);

  // Handle opt-in/opt-out → consent object
  canonical.consent = canonical.consent || {};
  if (canonical._emailOptOut !== undefined) {
    canonical.consent.email = !canonical._emailOptOut;
    delete canonical._emailOptOut;
  }
  if (canonical._emailOptIn !== undefined) {
    canonical.consent.email = Boolean(canonical._emailOptIn);
    delete canonical._emailOptIn;
  }
  if (canonical._smsOptIn !== undefined) {
    canonical.consent.sms = Boolean(canonical._smsOptIn);
    delete canonical._smsOptIn;
  }

  // Tag the source system
  if (!canonical.sources) canonical.sources = [];
  if (!canonical.sources.includes(source)) canonical.sources.push(source);

  return canonical;
}

module.exports = {
  translateFields,
  normalizeEmail,
  normalizePhone,
  normalizeSegments,
  normalizeLtv,
  normalizeProfile,
  FIELD_MAP,
};
