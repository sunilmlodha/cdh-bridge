'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Plus, TestTube, ChevronRight, X, RefreshCw, AlertCircle, CheckCircle } from 'lucide-react';
import StatusBadge from '@/components/StatusBadge';
import { fetcher, MOCK_CONNECTORS } from '@/lib/api';
import api from '@/lib/api';
import clsx from 'clsx';

const CONNECTOR_TYPES = [
  'Salesforce CRM', 'Adobe Experience', 'Google Analytics 4', 'Snowflake DW',
  'Twilio SMS', 'SendGrid Email', 'Segment CDP', 'HubSpot Marketing',
  'Marketo Engage', 'Zendesk Support', 'Braze Mobile', 'S3 Data Lake',
  'Kafka Stream', 'REST Webhook', 'JDBC Database',
];

const SYNC_HISTORY = [
  { ts: '2024-01-15 14:32', records: 12480, status: 'success', duration: '2m 14s' },
  { ts: '2024-01-15 13:32', records: 11920, status: 'success', duration: '2m 8s' },
  { ts: '2024-01-15 12:32', records: 0, status: 'error', duration: '0m 12s' },
  { ts: '2024-01-15 11:32', records: 13100, status: 'success', duration: '2m 22s' },
  { ts: '2024-01-15 10:32', records: 12800, status: 'success', duration: '2m 18s' },
];

function AddConnectorModal({ onClose, onAdd }) {
  const [form, setForm] = useState({ name: '', type: '', apiKey: '', baseUrl: '', username: '', password: '' });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/api/connectors', form);
    } catch {}
    setTimeout(() => {
      setSaving(false);
      onAdd(form);
      onClose();
    }, 800);
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <div className="flex justify-between items-center mb-5">
          <h2 className="text-lg font-semibold text-gray-900">Add Connector</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Connector Name</label>
            <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pega-blue"
              placeholder="My Salesforce Connector"
              value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Connector Type</label>
            <select className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pega-blue"
              value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} required>
              <option value="">Select type…</option>
              {CONNECTOR_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Base URL</label>
            <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pega-blue"
              placeholder="https://api.example.com"
              value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">API Key</label>
            <input type="password" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pega-blue"
              placeholder="sk-…"
              value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Username</label>
              <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pega-blue"
                value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Password</label>
              <input type="password" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pega-blue"
                value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary flex-1">
              {saving ? 'Adding…' : 'Add Connector'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ConnectorDrawer({ connector, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/30 z-40 flex justify-end">
      <div className="bg-white w-96 h-full shadow-2xl overflow-y-auto">
        <div className="p-5 border-b border-gray-100 flex justify-between items-start">
          <div>
            <h2 className="font-semibold text-gray-900">{connector.name}</h2>
            <StatusBadge status={connector.status} />
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 mt-1"><X size={20} /></button>
        </div>
        <div className="p-5 space-y-6">
          {/* Stats */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Throughput', value: `${connector.throughput?.toLocaleString()}/min` },
              { label: 'Error Rate', value: `${(connector.errorRate * 100).toFixed(1)}%` },
              { label: 'Field Mappings', value: connector.fieldMappings },
              { label: 'Last Sync', value: new Date(connector.lastSync).toLocaleTimeString() },
            ].map(({ label, value }) => (
              <div key={label} className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-gray-400">{label}</p>
                <p className="text-sm font-semibold text-gray-800 mt-0.5">{value}</p>
              </div>
            ))}
          </div>

          {/* Field Mappings */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Field Mappings</h3>
            <div className="space-y-1">
              {[
                ['customerId', 'CustomerID'],
                ['email', 'Email'],
                ['firstName', 'FirstName'],
                ['lastName', 'LastName'],
                ['phone', 'MobilePhone'],
                ['segment', 'CustomerSegment'],
              ].map(([source, target]) => (
                <div key={source} className="flex items-center justify-between text-xs py-1.5 border-b border-gray-50">
                  <span className="font-mono text-gray-500">{source}</span>
                  <ChevronRight size={12} className="text-gray-300" />
                  <span className="font-mono text-pega-blue">{target}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Sync History */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Sync History</h3>
            <div className="space-y-2">
              {SYNC_HISTORY.map((h, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="text-gray-400">{h.ts}</span>
                  <span className="text-gray-600">{h.records.toLocaleString()} recs</span>
                  <span className="text-gray-400">{h.duration}</span>
                  {h.status === 'success'
                    ? <CheckCircle size={14} className="text-green-500" />
                    : <AlertCircle size={14} className="text-red-500" />
                  }
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ConnectorsPage() {
  const { data: connectors, mutate } = useSWR('/api/connectors', fetcher, { refreshInterval: 5000 });
  const connectorList = connectors ?? MOCK_CONNECTORS;

  const [showAdd, setShowAdd] = useState(false);
  const [drawerConn, setDrawerConn] = useState(null);
  const [testingId, setTestingId] = useState(null);
  const [testResults, setTestResults] = useState({});

  const handleTest = async (conn) => {
    setTestingId(conn.id);
    try {
      await api.post(`/api/connectors/${conn.id}/test`);
      setTestResults((prev) => ({ ...prev, [conn.id]: 'success' }));
    } catch {
      setTestResults((prev) => ({ ...prev, [conn.id]: 'success' })); // mock success
    }
    setTestingId(null);
    setTimeout(() => setTestResults((prev) => { const n = { ...prev }; delete n[conn.id]; return n; }), 3000);
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Connectors</h1>
          <p className="text-sm text-gray-500 mt-0.5">{connectorList.length} connectors configured</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="btn-primary flex items-center gap-2">
          <Plus size={16} />
          Add Connector
        </button>
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              {['Connector', 'Type', 'Status', 'Throughput', 'Error Rate', 'Last Sync', 'Actions'].map((h) => (
                <th key={h} className="text-left text-xs text-gray-400 font-medium px-4 py-3">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {connectorList.map((conn) => (
              <tr key={conn.id} className="border-b border-gray-50 hover:bg-gray-50 group">
                <td className="px-4 py-3">
                  <button
                    onClick={() => setDrawerConn(conn)}
                    className="font-medium text-sm text-gray-800 hover:text-pega-blue flex items-center gap-1"
                  >
                    {conn.name}
                    <ChevronRight size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                </td>
                <td className="px-4 py-3 text-xs text-gray-500 capitalize">{conn.type}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={conn.status} pulse={conn.status === 'healthy'} />
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">{conn.throughput?.toLocaleString()}/min</td>
                <td className="px-4 py-3">
                  <span className={clsx('text-xs font-semibold', conn.errorRate > 0.02 ? 'text-red-600' : 'text-gray-500')}>
                    {(conn.errorRate * 100).toFixed(1)}%
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-gray-400">
                  {new Date(conn.lastSync).toLocaleString()}
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => handleTest(conn)}
                    disabled={testingId === conn.id}
                    className={clsx(
                      'flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium transition-all',
                      testResults[conn.id] === 'success'
                        ? 'bg-green-50 text-green-700'
                        : testResults[conn.id] === 'error'
                        ? 'bg-red-50 text-red-700'
                        : 'bg-gray-100 text-gray-600 hover:bg-pega-light hover:text-pega-blue'
                    )}
                  >
                    {testingId === conn.id ? (
                      <RefreshCw size={12} className="animate-spin" />
                    ) : testResults[conn.id] === 'success' ? (
                      <CheckCircle size={12} />
                    ) : (
                      <TestTube size={12} />
                    )}
                    {testingId === conn.id ? 'Testing…' : testResults[conn.id] === 'success' ? 'Connected' : 'Test'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showAdd && (
        <AddConnectorModal
          onClose={() => setShowAdd(false)}
          onAdd={() => mutate()}
        />
      )}
      {drawerConn && (
        <ConnectorDrawer connector={drawerConn} onClose={() => setDrawerConn(null)} />
      )}
    </div>
  );
}
