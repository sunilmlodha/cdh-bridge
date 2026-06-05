import axios from 'axios';

// Base axios instance – all requests go through Next.js rewrites
const api = axios.create({
  baseURL: typeof window !== 'undefined' ? '' : 'http://localhost:3000',
  timeout: 8000,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Swallow network errors gracefully so dashboard stays up
    if (error.code === 'ECONNREFUSED' || error.code === 'ERR_NETWORK') {
      return Promise.resolve({ data: null, _offline: true });
    }
    return Promise.reject(error);
  }
);

// SWR fetcher
export const fetcher = async (url) => {
  try {
    const res = await api.get(url);
    if (res._offline) return null;
    return res.data;
  } catch {
    return null;
  }
};

// --- Mock data for demo when backend is offline ---

export const MOCK_CONNECTORS = Array.from({ length: 15 }, (_, i) => ({
  id: `conn-${i + 1}`,
  name: [
    'Salesforce CRM', 'Adobe Experience', 'Google Analytics 4', 'Snowflake DW',
    'Twilio SMS', 'SendGrid Email', 'Segment CDP', 'HubSpot Marketing',
    'Marketo Engage', 'Zendesk Support', 'Braze Mobile', 'MoEngage Push',
    'S3 Data Lake', 'Kafka Stream', 'REST Webhook'
  ][i],
  type: ['crm', 'analytics', 'analytics', 'warehouse', 'sms', 'email', 'cdp', 'marketing',
    'marketing', 'support', 'mobile', 'push', 'storage', 'streaming', 'webhook'][i],
  status: ['healthy', 'healthy', 'healthy', 'warning', 'healthy', 'healthy', 'error',
    'healthy', 'healthy', 'warning', 'healthy', 'healthy', 'healthy', 'healthy', 'healthy'][i],
  throughput: Math.floor(Math.random() * 5000) + 100,
  lastSync: new Date(Date.now() - Math.random() * 300000).toISOString(),
  errorRate: Math.random() * 0.05,
  fieldMappings: 12 + i,
}));

export const MOCK_LIFT_DATA = Array.from({ length: 14 }, (_, i) => ({
  date: new Date(Date.now() - (13 - i) * 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  lift: 15 + Math.floor(Math.random() * 15),
  acceptance: 0.3 + Math.random() * 0.3,
}));

export const MOCK_EVENTS = Array.from({ length: 50 }, (_, i) => ({
  id: `evt-${Date.now()}-${i}`,
  timestamp: new Date(Date.now() - i * 12000).toISOString(),
  customerId: `CUST-${Math.floor(Math.random() * 900000) + 100000}`,
  eventType: ['PageView', 'Purchase', 'AddToCart', 'FormSubmit', 'Login', 'Search', 'OfferClick'][Math.floor(Math.random() * 7)],
  channel: ['Web', 'Mobile', 'Email', 'SMS', 'Call Centre'][Math.floor(Math.random() * 5)],
  cdhType: ['web-page-view', 'purchase-event', 'cart-update', 'lead-capture', 'auth-event', 'search-event', 'offer-response'][Math.floor(Math.random() * 7)],
  status: Math.random() > 0.05 ? 'mapped' : 'error',
}));

export const MOCK_NBA_DECISIONS = Array.from({ length: 20 }, (_, i) => ({
  id: `nba-${i}`,
  timestamp: new Date(Date.now() - i * 45000).toISOString(),
  customerId: `CUST-${Math.floor(Math.random() * 900000) + 100000}`,
  offer: ['Premium Upgrade', 'Loyalty Reward', 'Cross-sell Insurance', 'Retention Offer', 'Credit Limit Increase'][Math.floor(Math.random() * 5)],
  channel: ['Email', 'Mobile App', 'Web', 'SMS', 'Call Centre'][Math.floor(Math.random() * 5)],
  outcome: Math.random() > 0.35 ? 'accepted' : Math.random() > 0.5 ? 'rejected' : 'pending',
  propensity: (0.4 + Math.random() * 0.55).toFixed(2),
}));

export const MOCK_CONSENT_REQUESTS = Array.from({ length: 8 }, (_, i) => ({
  id: `req-${i + 1}`,
  type: i % 3 === 0 ? 'GDPR Erasure' : i % 3 === 1 ? 'CCPA Opt-Out' : 'Data Access',
  customerId: `CUST-${Math.floor(Math.random() * 900000) + 100000}`,
  email: `customer${i + 1}@example.com`,
  submittedAt: new Date(Date.now() - (i + 1) * 86400000 * 2).toISOString(),
  slaDays: i % 3 === 0 ? 30 : 15,
  daysElapsed: Math.floor(Math.random() * 20) + 1,
  status: ['pending', 'in-progress', 'pending', 'in-progress', 'escalated', 'pending', 'in-progress', 'pending'][i],
}));

export default api;
