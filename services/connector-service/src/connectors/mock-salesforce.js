'use strict';

const BaseConnector = require('./base-connector');

// Realistic fake data arrays for mock generation
const FIRST_NAMES = ['James', 'Sarah', 'Michael', 'Emily', 'David', 'Jennifer', 'Robert', 'Jessica',
  'William', 'Ashley', 'John', 'Amanda', 'Christopher', 'Stephanie', 'Daniel', 'Nicole',
  'Matthew', 'Heather', 'Anthony', 'Elizabeth', 'Mark', 'Megan', 'Donald', 'Lauren',
  'Steven', 'Brittany', 'Paul', 'Kayla', 'Andrew', 'Samantha'];

const LAST_NAMES = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
  'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson',
  'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson',
  'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson'];

const DOMAINS = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com',
  'acme-corp.com', 'techcorp.io', 'enterprise.net', 'biz.co', 'company.org'];

const INDUSTRIES = ['Technology', 'Healthcare', 'Financial Services', 'Retail', 'Manufacturing',
  'Education', 'Real Estate', 'Media', 'Hospitality', 'Automotive'];

const LEAD_SOURCES = ['Web', 'Phone Inquiry', 'Partner Referral', 'Purchased List', 'Trade Show',
  'Advertisement', 'Organic Search', 'Email Campaign', 'Cold Call'];

const COMPANIES = ['Acme Corp', 'TechCorp Solutions', 'Enterprise Inc', 'Global Dynamics',
  'Innovative Systems', 'NextGen Ltd', 'Apex Industries', 'Summit Group',
  'Pinnacle Corp', 'Velocity Partners'];

const SEGMENTS = ['high-value', 'at-risk', 'champion', 'new-customer', 'dormant', 'enterprise',
  'smb', 'consumer', 'vip', 'trial'];

/**
 * Mock Salesforce Connector
 *
 * Generates 50 realistic fake customer profiles.
 * Used when MOCK_DATA=true or in development/demo mode.
 * Has the same interface as the real SalesforceConnector.
 */
class MockSalesforceConnector extends BaseConnector {
  constructor(config) {
    super({
      fieldMappings: [
        { source: 'External_ID__c', target: 'customerId' },
        { source: 'Email', target: 'email', transform: 'lowercase' },
        { source: 'Phone', target: 'phone' },
        { source: 'FirstName', target: 'firstName' },
        { source: 'LastName', target: 'lastName' },
        { source: 'Account.AnnualRevenue', target: 'ltv', transform: 'parseCurrency' },
        { source: 'Account.Industry', target: 'traits.industry' },
        { source: 'LeadSource', target: 'traits.leadSource' },
        { source: 'Account.Name', target: 'traits.company' }
      ],
      ...config
    });

    this._mockCount = config.mockCount || 50;
    this._mockDelay = config.mockDelay || 100; // ms to simulate latency
    this._seed = config.seed || 42;
    this._generatedProfiles = null;
  }

  async connect() {
    await new Promise(resolve => setTimeout(resolve, this._mockDelay));
    this.status = 'connected';
    this.logger.info('Mock Salesforce connector connected (MOCK_DATA mode)');
  }

  async disconnect() {
    this.status = 'disconnected';
  }

  async test() {
    const start = Date.now();
    await new Promise(resolve => setTimeout(resolve, this._mockDelay));
    return {
      success: true,
      recordCount: this._mockCount,
      latencyMs: Date.now() - start,
      warnings: ['This is a mock connector — no real Salesforce connection']
    };
  }

  /**
   * Deterministic pseudo-random number from seed + index.
   */
  _rand(seed, max) {
    const x = Math.sin(seed) * 10000;
    return Math.floor((x - Math.floor(x)) * max);
  }

  /**
   * Generate a single fake Salesforce Contact record.
   */
  _generateRecord(index) {
    const seed = this._seed + index * 1000;
    const firstName = FIRST_NAMES[this._rand(seed + 1, FIRST_NAMES.length)];
    const lastName = LAST_NAMES[this._rand(seed + 2, LAST_NAMES.length)];
    const domain = DOMAINS[this._rand(seed + 3, DOMAINS.length)];
    const company = COMPANIES[this._rand(seed + 4, COMPANIES.length)];
    const industry = INDUSTRIES[this._rand(seed + 5, INDUSTRIES.length)];
    const leadSource = LEAD_SOURCES[this._rand(seed + 6, LEAD_SOURCES.length)];
    const ltv = (this._rand(seed + 7, 50000) + 1000);
    const segment = SEGMENTS[this._rand(seed + 8, SEGMENTS.length)];
    const phoneArea = 200 + this._rand(seed + 9, 800);
    const phoneNum = 1000000 + this._rand(seed + 10, 9000000);

    return {
      Id: `003${String(index).padStart(15, '0')}`,
      External_ID__c: `sf-contact-${index + 1001}`,
      Email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@${domain}`,
      Phone: `+1-${phoneArea}-${String(phoneNum).substring(0, 3)}-${String(phoneNum).substring(3, 7)}`,
      FirstName: firstName,
      LastName: lastName,
      LeadSource: leadSource,
      SystemModstamp: new Date(Date.now() - this._rand(seed + 11, 86400000 * 30)).toISOString(),
      Account: {
        Name: company,
        AnnualRevenue: ltv * 100, // Company revenue derived from LTV
        Industry: industry
      },
      _segment: segment
    };
  }

  /**
   * Generate all mock records (cached after first call).
   */
  _generateAll() {
    if (!this._generatedProfiles) {
      this._generatedProfiles = [];
      for (let i = 0; i < this._mockCount; i++) {
        this._generatedProfiles.push(this._generateRecord(i));
      }
    }
    return this._generatedProfiles;
  }

  async fetchBatch(lastSync) {
    await new Promise(resolve => setTimeout(resolve, this._mockDelay));
    const all = this._generateAll();

    if (!lastSync) return all;

    // Filter records modified after lastSync
    const since = new Date(lastSync).getTime();
    return all.filter(r => new Date(r.SystemModstamp).getTime() > since);
  }

  async stream(onRecord) {
    const records = await this.fetchBatch(this.lastSync);
    for (const record of records) {
      await new Promise(resolve => setTimeout(resolve, 10)); // simulate streaming latency
      await onRecord(record);
    }
  }

  getStatus() {
    return {
      ...super.getStatus(),
      mockMode: true,
      mockCount: this._mockCount
    };
  }
}

module.exports = MockSalesforceConnector;
