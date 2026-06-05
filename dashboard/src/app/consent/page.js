'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Shield, UserX, Trash2, CheckCircle, AlertTriangle, Clock } from 'lucide-react';
import StatusBadge from '@/components/StatusBadge';
import SlaBar from '@/components/SlaBar';
import { fetcher, MOCK_CONSENT_REQUESTS } from '@/lib/api';
import api from '@/lib/api';
import clsx from 'clsx';

const AUDIT_LOG = [
  { ts: '2024-01-15 14:32', action: 'GDPR Erasure Submitted', user: 'admin@bank.com', subject: 'CUST-482910', status: 'completed' },
  { ts: '2024-01-15 13:15', action: 'CCPA Opt-Out Applied', user: 'system', subject: 'CUST-219834', status: 'completed' },
  { ts: '2024-01-15 12:48', action: 'Consent Updated', user: 'api-key-7', subject: 'CUST-094820', status: 'completed' },
  { ts: '2024-01-15 11:20', action: 'Data Access Request', user: 'admin@bank.com', subject: 'CUST-338291', status: 'pending' },
  { ts: '2024-01-15 09:45', action: 'Opt-Out Customer', user: 'admin@bank.com', subject: 'CUST-109382', status: 'completed' },
  { ts: '2024-01-14 17:30', action: 'GDPR Erasure Completed', user: 'system', subject: 'CUST-778920', status: 'completed' },
];

export default function ConsentPage() {
  const { data: requests } = useSWR('/api/consent/requests', fetcher, { refreshInterval: 15000 });
  const pendingRequests = requests ?? MOCK_CONSENT_REQUESTS;

  const [optOutForm, setOptOutForm] = useState({ customerId: '', channel: 'all', reason: '' });
  const [erasureForm, setErasureForm] = useState({ customerId: '', email: '', verification: '' });
  const [optOutStatus, setOptOutStatus] = useState(null);
  const [erasureStatus, setErasureStatus] = useState(null);

  const handleOptOut = async (e) => {
    e.preventDefault();
    setOptOutStatus('loading');
    try {
      await api.post('/api/consent/opt-out', optOutForm);
    } catch {}
    setTimeout(() => {
      setOptOutStatus('success');
      setOptOutForm({ customerId: '', channel: 'all', reason: '' });
      setTimeout(() => setOptOutStatus(null), 4000);
    }, 1000);
  };

  const handleErasure = async (e) => {
    e.preventDefault();
    setErasureStatus('loading');
    try {
      await api.post('/api/consent/erasure', erasureForm);
    } catch {}
    setTimeout(() => {
      setErasureStatus('success');
      setErasureForm({ customerId: '', email: '', verification: '' });
      setTimeout(() => setErasureStatus(null), 4000);
    }, 1200);
  };

  const stats = {
    optOutsThisMonth: 234,
    avgPropagationMin: 2.4,
    slaHitRate: 98.1,
    pendingCount: pendingRequests.filter((r) => r.status === 'pending').length,
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Consent & Compliance</h1>
        <p className="text-sm text-gray-500 mt-0.5">GDPR / CCPA request management and opt-out controls</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Opt-outs This Month', value: stats.optOutsThisMonth, icon: UserX, color: 'text-orange-600 bg-orange-50' },
          { label: 'Avg Propagation', value: `${stats.avgPropagationMin}m`, icon: Clock, color: 'text-blue-600 bg-blue-50' },
          { label: 'SLA Hit Rate', value: `${stats.slaHitRate}%`, icon: CheckCircle, color: 'text-green-600 bg-green-50' },
          { label: 'Pending Requests', value: stats.pendingCount, icon: AlertTriangle, color: 'text-amber-600 bg-amber-50' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="card flex items-center gap-3">
            <div className={clsx('p-2.5 rounded-lg', color.split(' ')[1])}>
              <Icon size={18} className={color.split(' ')[0]} />
            </div>
            <div>
              <p className="text-xs text-gray-400">{label}</p>
              <p className="text-xl font-bold text-gray-900 mt-0.5">{value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Pending Requests */}
      <div className="card">
        <h2 className="font-semibold text-gray-800 mb-4">Pending Requests</h2>
        <div className="space-y-3">
          {pendingRequests.map((req) => (
            <div key={req.id} className="border border-gray-100 rounded-xl p-4 hover:border-gray-200 transition-colors">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={clsx(
                      'text-xs font-semibold px-2 py-0.5 rounded',
                      req.type.startsWith('GDPR') ? 'bg-red-50 text-red-700' :
                      req.type.startsWith('CCPA') ? 'bg-blue-50 text-blue-700' :
                      'bg-gray-100 text-gray-600'
                    )}>{req.type}</span>
                    <StatusBadge status={req.status} />
                  </div>
                  <p className="text-sm font-medium text-gray-700 mt-1">{req.email}</p>
                  <p className="text-xs text-gray-400 font-mono">{req.customerId}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-400">{new Date(req.submittedAt).toLocaleDateString()}</p>
                  <p className="text-xs text-gray-500 mt-0.5">SLA: {req.slaDays} days</p>
                </div>
              </div>
              <SlaBar daysElapsed={req.daysElapsed} slaDays={req.slaDays} />
            </div>
          ))}
        </div>
      </div>

      {/* Forms Row */}
      <div className="grid grid-cols-2 gap-4">
        {/* Opt-Out Form */}
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <UserX size={16} className="text-orange-500" />
            <h2 className="font-semibold text-gray-800">Opt-Out Customer</h2>
          </div>
          <form onSubmit={handleOptOut} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Customer ID</label>
              <input
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pega-blue"
                placeholder="CUST-000000"
                value={optOutForm.customerId}
                onChange={(e) => setOptOutForm({ ...optOutForm, customerId: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Opt-Out Scope</label>
              <select
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pega-blue"
                value={optOutForm.channel}
                onChange={(e) => setOptOutForm({ ...optOutForm, channel: e.target.value })}
              >
                <option value="all">All Channels</option>
                <option value="email">Email Only</option>
                <option value="sms">SMS Only</option>
                <option value="marketing">Marketing Only</option>
                <option value="thirdParty">Third-Party Only</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Reason</label>
              <input
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pega-blue"
                placeholder="Customer request via phone"
                value={optOutForm.reason}
                onChange={(e) => setOptOutForm({ ...optOutForm, reason: e.target.value })}
              />
            </div>
            <button
              type="submit"
              disabled={optOutStatus === 'loading'}
              className={clsx(
                'w-full py-2 rounded-lg text-sm font-medium transition-all',
                optOutStatus === 'success' ? 'bg-green-500 text-white' : 'btn-primary'
              )}
            >
              {optOutStatus === 'loading' ? 'Processing…' : optOutStatus === 'success' ? 'Opt-Out Applied' : 'Apply Opt-Out'}
            </button>
          </form>
        </div>

        {/* GDPR Erasure Form */}
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <Trash2 size={16} className="text-red-500" />
            <h2 className="font-semibold text-gray-800">Submit GDPR Erasure</h2>
          </div>
          <form onSubmit={handleErasure} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Customer ID</label>
              <input
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pega-blue"
                placeholder="CUST-000000"
                value={erasureForm.customerId}
                onChange={(e) => setErasureForm({ ...erasureForm, customerId: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Email Address (verification)</label>
              <input
                type="email"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pega-blue"
                placeholder="customer@example.com"
                value={erasureForm.email}
                onChange={(e) => setErasureForm({ ...erasureForm, email: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Verification Token</label>
              <input
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pega-blue"
                placeholder="Token from customer email"
                value={erasureForm.verification}
                onChange={(e) => setErasureForm({ ...erasureForm, verification: e.target.value })}
              />
            </div>
            <div className="p-3 bg-red-50 rounded-lg text-xs text-red-700">
              <strong>Warning:</strong> This will permanently delete all customer data across all connected systems within 30 days.
            </div>
            <button
              type="submit"
              disabled={erasureStatus === 'loading'}
              className={clsx(
                'w-full py-2 rounded-lg text-sm font-medium transition-all',
                erasureStatus === 'success' ? 'bg-green-500 text-white' :
                'bg-red-600 hover:bg-red-700 text-white'
              )}
            >
              {erasureStatus === 'loading' ? 'Submitting…' : erasureStatus === 'success' ? 'Erasure Request Submitted' : 'Submit Erasure Request'}
            </button>
          </form>
        </div>
      </div>

      {/* Audit Log */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Shield size={16} className="text-gray-500" />
          <h2 className="font-semibold text-gray-800">Audit Log</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                {['Timestamp', 'Action', 'User', 'Subject', 'Status'].map((h) => (
                  <th key={h} className="text-left text-xs text-gray-400 font-medium py-2 pr-4">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {AUDIT_LOG.map((entry, i) => (
                <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-2 pr-4 text-xs text-gray-400 font-mono">{entry.ts}</td>
                  <td className="py-2 pr-4 text-sm text-gray-700 font-medium">{entry.action}</td>
                  <td className="py-2 pr-4 text-xs text-gray-500 font-mono">{entry.user}</td>
                  <td className="py-2 pr-4 text-xs font-mono text-pega-blue">{entry.subject}</td>
                  <td className="py-2">
                    <StatusBadge status={entry.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
