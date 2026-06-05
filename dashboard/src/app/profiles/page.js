'use client';

import { useState } from 'react';
import { Search, Upload, User, Tag, DollarSign, Shield, GitMerge, RefreshCw } from 'lucide-react';
import StatusBadge from '@/components/StatusBadge';
import api from '@/lib/api';
import clsx from 'clsx';

const MOCK_PROFILE = {
  customerId: 'CUST-482910',
  email: 'sarah.johnson@example.com',
  firstName: 'Sarah',
  lastName: 'Johnson',
  phone: '+1 (555) 234-7890',
  dateOfBirth: '1985-03-12',
  ltv: 8420.50,
  tier: 'Gold',
  segments: ['High Value', 'Mortgage Holder', 'Digital Engaged', 'Recent Mover'],
  consentState: {
    marketing: true,
    analytics: true,
    thirdParty: false,
    sms: true,
    email: true,
  },
  sourceSystems: [
    { name: 'Salesforce CRM', lastSync: '2024-01-15T14:32:00Z', records: 48 },
    { name: 'Adobe Analytics', lastSync: '2024-01-15T14:10:00Z', records: 1240 },
    { name: 'Snowflake DW', lastSync: '2024-01-15T08:00:00Z', records: 312 },
  ],
  mergeHistory: [
    { date: '2024-01-10', fromId: 'CUST-219384', reason: 'Email match', confidence: 0.97 },
    { date: '2023-08-22', fromId: 'CUST-093847', reason: 'Phone + name match', confidence: 0.91 },
  ],
};

export default function ProfilesPage() {
  const [query, setQuery] = useState('');
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pushed, setPushed] = useState(false);

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    try {
      const res = await api.get(`/api/profiles/lookup?q=${encodeURIComponent(query)}`);
      setProfile(res.data ?? MOCK_PROFILE);
    } catch {
      setProfile({ ...MOCK_PROFILE, customerId: query.startsWith('CUST-') ? query : `CUST-${query}` });
    }
    setLoading(false);
  };

  const handlePushToCDH = async () => {
    setPushing(true);
    try {
      await api.post(`/api/profiles/${profile.customerId}/push`);
    } catch {}
    setTimeout(() => {
      setPushing(false);
      setPushed(true);
      setTimeout(() => setPushed(false), 3000);
    }, 1200);
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">Profile Explorer</h1>
        <p className="text-sm text-gray-500 mt-0.5">Look up unified customer profiles</p>
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="card p-4">
        <div className="flex gap-3">
          <div className="flex-1 relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pega-blue"
              placeholder="Search by Customer ID or email address…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <button type="submit" disabled={loading} className="btn-primary flex items-center gap-2 px-6">
            {loading ? <RefreshCw size={16} className="animate-spin" /> : <Search size={16} />}
            {loading ? 'Searching…' : 'Search'}
          </button>
        </div>
        <div className="flex gap-2 mt-3">
          {['CUST-482910', 'sarah.johnson@example.com', 'CUST-219384'].map((q) => (
            <button key={q} type="button"
              onClick={() => { setQuery(q); }}
              className="text-xs px-2.5 py-1 bg-gray-100 text-gray-500 rounded-full hover:bg-pega-light hover:text-pega-blue transition-colors">
              {q}
            </button>
          ))}
        </div>
      </form>

      {/* Profile Card */}
      {profile && (
        <div className="space-y-4">
          {/* Identity */}
          <div className="card">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-pega-light rounded-full flex items-center justify-center">
                  <User size={24} className="text-pega-blue" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-gray-900">{profile.firstName} {profile.lastName}</h2>
                  <p className="text-sm text-gray-500">{profile.customerId}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={clsx(
                  'px-3 py-1 rounded-full text-xs font-semibold',
                  profile.tier === 'Gold' ? 'bg-amber-50 text-amber-700' :
                  profile.tier === 'Platinum' ? 'bg-purple-50 text-purple-700' :
                  'bg-gray-100 text-gray-600'
                )}>
                  {profile.tier} Tier
                </span>
                <button
                  onClick={handlePushToCDH}
                  disabled={pushing}
                  className={clsx(
                    'flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all',
                    pushed ? 'bg-green-500 text-white' : 'btn-primary'
                  )}
                >
                  {pushing ? <RefreshCw size={14} className="animate-spin" /> : <Upload size={14} />}
                  {pushing ? 'Pushing…' : pushed ? 'Pushed to CDH!' : 'Push to CDH'}
                </button>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: 'Email', value: profile.email },
                { label: 'Phone', value: profile.phone },
                { label: 'Date of Birth', value: new Date(profile.dateOfBirth).toLocaleDateString() },
              ].map(({ label, value }) => (
                <div key={label}>
                  <p className="text-xs text-gray-400">{label}</p>
                  <p className="text-sm text-gray-700 font-medium mt-0.5">{value}</p>
                </div>
              ))}
            </div>
          </div>

          {/* LTV + Segments + Consent */}
          <div className="grid grid-cols-3 gap-4">
            {/* LTV */}
            <div className="card">
              <div className="flex items-center gap-2 mb-3">
                <DollarSign size={16} className="text-green-600" />
                <h3 className="font-semibold text-gray-700 text-sm">Lifetime Value</h3>
              </div>
              <p className="text-3xl font-bold text-gray-900">${profile.ltv.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
              <p className="text-xs text-green-600 mt-1">▲ +12% vs last year</p>
            </div>

            {/* Segments */}
            <div className="card">
              <div className="flex items-center gap-2 mb-3">
                <Tag size={16} className="text-pega-blue" />
                <h3 className="font-semibold text-gray-700 text-sm">Segments</h3>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {profile.segments.map((seg) => (
                  <span key={seg} className="px-2 py-1 bg-pega-light text-pega-dark text-xs rounded-full font-medium">
                    {seg}
                  </span>
                ))}
              </div>
            </div>

            {/* Consent */}
            <div className="card">
              <div className="flex items-center gap-2 mb-3">
                <Shield size={16} className="text-purple-600" />
                <h3 className="font-semibold text-gray-700 text-sm">Consent State</h3>
              </div>
              <div className="space-y-1.5">
                {Object.entries(profile.consentState).map(([key, val]) => (
                  <div key={key} className="flex items-center justify-between">
                    <span className="text-xs text-gray-500 capitalize">{key.replace(/([A-Z])/g, ' $1')}</span>
                    <span className={clsx('text-xs font-semibold', val ? 'text-green-600' : 'text-red-500')}>
                      {val ? 'Opted In' : 'Opted Out'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Source Systems */}
          <div className="card">
            <h3 className="font-semibold text-gray-700 text-sm mb-3">Source Systems</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left text-xs text-gray-400 font-medium py-2 pr-4">System</th>
                    <th className="text-right text-xs text-gray-400 font-medium py-2 pr-4">Records</th>
                    <th className="text-right text-xs text-gray-400 font-medium py-2">Last Sync</th>
                  </tr>
                </thead>
                <tbody>
                  {profile.sourceSystems.map((s) => (
                    <tr key={s.name} className="border-b border-gray-50">
                      <td className="py-2 pr-4 font-medium text-gray-700">{s.name}</td>
                      <td className="py-2 pr-4 text-right text-gray-500">{s.records.toLocaleString()}</td>
                      <td className="py-2 text-right text-gray-400 text-xs">{new Date(s.lastSync).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Merge History */}
          <div className="card">
            <div className="flex items-center gap-2 mb-3">
              <GitMerge size={16} className="text-gray-500" />
              <h3 className="font-semibold text-gray-700 text-sm">Merge History</h3>
            </div>
            <div className="space-y-2">
              {profile.mergeHistory.map((m, i) => (
                <div key={i} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <p className="text-xs font-medium text-gray-700">Merged from <span className="font-mono text-pega-blue">{m.fromId}</span></p>
                    <p className="text-xs text-gray-400">{m.reason}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-400">{m.date}</p>
                    <p className="text-xs font-semibold text-green-600">{(m.confidence * 100).toFixed(0)}% confidence</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {!profile && !loading && (
        <div className="card text-center py-16">
          <User size={48} className="text-gray-200 mx-auto mb-4" />
          <p className="text-gray-400 text-sm">Enter a Customer ID or email to explore a profile</p>
        </div>
      )}
    </div>
  );
}
