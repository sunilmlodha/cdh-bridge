'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Link2, Search, CheckCircle, XCircle, RefreshCw, User, Mail,
  Phone, Cpu, Hash, GitMerge, Activity, BarChart2, Clock
} from 'lucide-react';
import KpiCard from '@/components/KpiCard';
import api from '@/lib/api';
import clsx from 'clsx';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';

// ── Mock data ────────────────────────────────────────────────────────────────

const MOCK_STATS = {
  totalUnified: 184320,
  matchRate: 78.4,
  pendingReview: 47,
  anonActive: 21830,
};

const MOCK_CLUSTER = {
  goldenRecord: { id: 'CUST-001', name: 'Sarah Johnson' },
  nodes: [
    { id: 'n1', type: 'email',  label: 'sarah.johnson@example.com', source: 'Salesforce', confidence: 0.99 },
    { id: 'n2', type: 'email',  label: 's.johnson@gmail.com',        source: 'Adobe',      confidence: 0.91 },
    { id: 'n3', type: 'phone',  label: '+1 (555) 234-7890',          source: 'CRM',        confidence: 0.97 },
    { id: 'n4', type: 'device', label: 'iPhone • UA-8821',           source: 'Analytics',  confidence: 0.84 },
    { id: 'n5', type: 'crm',   label: 'SF-00482910',                 source: 'Salesforce', confidence: 0.99 },
    { id: 'n6', type: 'cookie', label: 'ck_a3f9…d12e',              source: 'Web',        confidence: 0.76 },
  ],
};

const MOCK_QUEUE = [
  {
    id: 'rev-001',
    confidence: 72,
    matchRule: 'Email domain + Last name',
    profileA: { id: 'CUST-2841', email: 'j.smith@acme.com', name: 'James Smith' },
    profileB: { id: 'CUST-7193', email: 'james.smith@acme.com', name: 'J. Smith' },
    created: '2026-06-05T08:14:00Z',
  },
  {
    id: 'rev-002',
    confidence: 65,
    matchRule: 'Phone + Postcode',
    profileA: { id: 'CUST-3301', email: 'maria.g@email.com', name: 'Maria Garcia' },
    profileB: { id: 'CUST-0912', email: 'm.garcia@work.com', name: 'Maria G.' },
    created: '2026-06-05T07:52:00Z',
  },
  {
    id: 'rev-003',
    confidence: 58,
    matchRule: 'Name + DOB',
    profileA: { id: 'CUST-5519', email: 'tom.w@personal.net', name: 'Thomas White' },
    profileB: { id: 'CUST-6647', email: 'twhite@corp.io', name: 'Tom White' },
    created: '2026-06-05T06:31:00Z',
  },
];

const MOCK_STITCH_STATS = {
  last24h: 1284,
  avgSignalAdded: 6.3,
  recent: [
    { cookieId: 'ck_a3f9b2d1…e12e', customerId: 'CUST-482910', eventsAdded: 8,  segmentsAdded: 2, time: '2 min ago' },
    { cookieId: 'ck_7e81f0c3…9a4b', customerId: 'CUST-193847', eventsAdded: 3,  segmentsAdded: 0, time: '5 min ago' },
    { cookieId: 'ck_2c94d8a1…f30c', customerId: 'CUST-739201', eventsAdded: 14, segmentsAdded: 3, time: '9 min ago' },
    { cookieId: 'ck_b5120e7f…884d', customerId: 'CUST-028441', eventsAdded: 1,  segmentsAdded: 0, time: '12 min ago' },
    { cookieId: 'ck_90f3c2d8…1e7a', customerId: 'CUST-561930', eventsAdded: 7,  segmentsAdded: 1, time: '18 min ago' },
    { cookieId: 'ck_d4a17b3e…c09f', customerId: 'CUST-304812', eventsAdded: 5,  segmentsAdded: 2, time: '25 min ago' },
    { cookieId: 'ck_0e72f9a4…7b3d', customerId: 'CUST-812034', eventsAdded: 2,  segmentsAdded: 0, time: '31 min ago' },
    { cookieId: 'ck_c6180b5d…2f8e', customerId: 'CUST-047291', eventsAdded: 11, segmentsAdded: 2, time: '44 min ago' },
    { cookieId: 'ck_14a9e3c7…d50b', customerId: 'CUST-678345', eventsAdded: 4,  segmentsAdded: 1, time: '58 min ago' },
    { cookieId: 'ck_f82d0b1a…9c6e', customerId: 'CUST-234719', eventsAdded: 9,  segmentsAdded: 2, time: '1h 12m ago' },
  ],
};

const MOCK_RULE_PERF = [
  { rule: 'Email Exact',       autoMerged: 48200, reviewQueued: 310,  noMatch: 1200 },
  { rule: 'Phone Match',       autoMerged: 22100, reviewQueued: 1840, noMatch: 3200 },
  { rule: 'Name + DOB',        autoMerged: 8400,  reviewQueued: 3100, noMatch: 5900 },
  { rule: 'Device Fingerprint',autoMerged: 5200,  reviewQueued: 2800, noMatch: 9100 },
  { rule: 'CRM ID',            autoMerged: 31000, reviewQueued: 120,  noMatch: 400  },
  { rule: 'Cookie Stitch',     autoMerged: 18400, reviewQueued: 940,  noMatch: 6200 },
];

// ── Helper components ────────────────────────────────────────────────────────

const NODE_STYLES = {
  email:  { bg: 'bg-blue-50',   border: 'border-blue-200',  text: 'text-blue-700',  icon: Mail },
  phone:  { bg: 'bg-green-50',  border: 'border-green-200', text: 'text-green-700', icon: Phone },
  device: { bg: 'bg-purple-50', border: 'border-purple-200',text: 'text-purple-700',icon: Cpu },
  crm:    { bg: 'bg-amber-50',  border: 'border-amber-200', text: 'text-amber-700', icon: Hash },
  cookie: { bg: 'bg-gray-50',   border: 'border-gray-200',  text: 'text-gray-600',  icon: Activity },
};

function ConfidenceBadge({ value }) {
  const pct = Number(value);
  const color = pct >= 85 ? 'bg-green-100 text-green-700' : pct >= 65 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700';
  return <span className={clsx('px-2 py-0.5 rounded-full text-xs font-semibold', color)}>{pct}%</span>;
}

// ── Identity Graph Visualiser ─────────────────────────────────────────────────

function IdentityGraph({ cluster }) {
  const { goldenRecord, nodes } = cluster;
  return (
    <div className="relative min-h-[320px] flex items-center justify-center bg-gray-50 rounded-xl border border-gray-100 overflow-hidden p-6">
      {/* Decorative radial lines */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 0 }}>
        {nodes.map((_, i) => {
          const total = nodes.length;
          const angle = (i / total) * 2 * Math.PI - Math.PI / 2;
          const cx = 50, cy = 50;
          const r = 36;
          const x2 = cx + r * Math.cos(angle);
          const y2 = cy + r * Math.sin(angle);
          return (
            <line
              key={i}
              x1={`${cx}%`} y1={`${cy}%`}
              x2={`${x2}%`} y2={`${y2}%`}
              stroke="#e2e8f0" strokeWidth="1.5"
            />
          );
        })}
      </svg>

      {/* Golden record centre */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
        <div className="flex flex-col items-center gap-1.5">
          <div className="w-16 h-16 bg-pega-blue rounded-full flex items-center justify-center shadow-lg ring-4 ring-white">
            <User size={28} className="text-white" />
          </div>
          <div className="text-center bg-white rounded-lg px-3 py-1.5 shadow-sm border border-gray-100">
            <p className="text-xs font-bold text-gray-900">{goldenRecord.name}</p>
            <p className="text-[10px] font-mono text-pega-blue">{goldenRecord.id}</p>
            <span className="text-[9px] uppercase tracking-wide text-amber-600 font-semibold">Golden Record</span>
          </div>
        </div>
      </div>

      {/* Surrounding nodes */}
      {nodes.map((node, i) => {
        const total = nodes.length;
        const angle = (i / total) * 2 * Math.PI - Math.PI / 2;
        const r = 36;
        const x = 50 + r * Math.cos(angle);
        const y = 50 + r * Math.sin(angle);
        const style = NODE_STYLES[node.type] ?? NODE_STYLES.cookie;
        const NodeIcon = style.icon;
        return (
          <div
            key={node.id}
            className="absolute z-10"
            style={{ left: `${x}%`, top: `${y}%`, transform: 'translate(-50%, -50%)' }}
          >
            <div className={clsx(
              'flex flex-col items-center gap-1 px-2 py-1.5 rounded-lg border shadow-sm bg-white w-36 text-center',
              style.border
            )}>
              <div className={clsx('p-1 rounded-full', style.bg)}>
                <NodeIcon size={12} className={style.text} />
              </div>
              <p className="text-[10px] font-medium text-gray-700 truncate w-full">{node.label}</p>
              <div className="flex items-center gap-1">
                <span className="text-[9px] text-gray-400">{node.source}</span>
                <span className={clsx('text-[9px] font-semibold', style.text)}>{Math.round(node.confidence * 100)}%</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Review Queue ──────────────────────────────────────────────────────────────

function ReviewQueue() {
  const [queue, setQueue] = useState(MOCK_QUEUE);
  const [acting, setActing] = useState({});

  const fetchQueue = useCallback(async () => {
    try {
      const res = await api.get('/api/identity/review/queue');
      if (res.data?.length) setQueue(res.data);
    } catch {
      // keep mock
    }
  }, []);

  useEffect(() => {
    fetchQueue();
    const t = setInterval(fetchQueue, 10000);
    return () => clearInterval(t);
  }, [fetchQueue]);

  const act = async (id, action) => {
    setActing((prev) => ({ ...prev, [id]: action }));
    try {
      await api.post(`/api/identity/review/${id}/${action}`);
    } catch {}
    setTimeout(() => {
      setQueue((prev) => prev.filter((r) => r.id !== id));
      setActing((prev) => { const n = { ...prev }; delete n[id]; return n; });
    }, 600);
  };

  if (!queue.length) {
    return (
      <div className="text-center py-12">
        <CheckCircle size={40} className="text-green-300 mx-auto mb-3" />
        <p className="text-gray-400 text-sm">No pending reviews — all matches resolved automatically</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100">
            {['Confidence', 'Match Rule', 'Profile A', 'Profile B', 'Created', 'Actions'].map((h) => (
              <th key={h} className="text-left text-xs text-gray-400 font-medium py-2 pr-4 last:pr-0">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {queue.map((row) => (
            <tr key={row.id} className={clsx('border-b border-gray-50 transition-opacity', acting[row.id] && 'opacity-40')}>
              <td className="py-3 pr-4"><ConfidenceBadge value={row.confidence} /></td>
              <td className="py-3 pr-4 text-gray-600 text-xs max-w-[140px]">{row.matchRule}</td>
              <td className="py-3 pr-4">
                <p className="font-mono text-xs text-pega-blue">{row.profileA.id}</p>
                <p className="text-xs text-gray-500 truncate max-w-[140px]">{row.profileA.name}</p>
              </td>
              <td className="py-3 pr-4">
                <p className="font-mono text-xs text-pega-blue">{row.profileB.id}</p>
                <p className="text-xs text-gray-500 truncate max-w-[140px]">{row.profileB.name}</p>
              </td>
              <td className="py-3 pr-4 text-xs text-gray-400">
                {new Date(row.created).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </td>
              <td className="py-3">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => act(row.id, 'approve')}
                    disabled={!!acting[row.id]}
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-green-50 hover:bg-green-100 text-green-700 text-xs font-medium rounded-lg transition-colors"
                  >
                    <CheckCircle size={13} /> Approve
                  </button>
                  <button
                    onClick={() => act(row.id, 'reject')}
                    disabled={!!acting[row.id]}
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-medium rounded-lg transition-colors"
                  >
                    <XCircle size={13} /> Reject
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function IdentityPage() {
  const [stats, setStats] = useState(MOCK_STATS);
  const [statsLoading, setStatsLoading] = useState(true);

  const [searchQuery, setSearchQuery] = useState('');
  const [cluster, setCluster] = useState(null);
  const [clusterLoading, setClusterLoading] = useState(false);

  const [stitchStats, setStitchStats] = useState(MOCK_STITCH_STATS);

  // Load KPI stats
  useEffect(() => {
    const load = async () => {
      try {
        const [profileRes, reviewRes, anonRes] = await Promise.allSettled([
          api.get('/api/profile-stats'),
          api.get('/api/identity/review/stats'),
          api.get('/api/identity/anon/count'),
        ]);
        setStats({
          totalUnified: profileRes.value?.data?.totalUnified ?? MOCK_STATS.totalUnified,
          matchRate:    profileRes.value?.data?.matchRate    ?? MOCK_STATS.matchRate,
          pendingReview: reviewRes.value?.data?.pending      ?? MOCK_STATS.pendingReview,
          anonActive:   anonRes.value?.data?.count           ?? MOCK_STATS.anonActive,
        });
      } catch {}
      setStatsLoading(false);
    };
    load();
  }, []);

  // Load stitch stats
  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.get('/api/identity/stitch/stats');
        if (res.data) setStitchStats(res.data);
      } catch {}
    };
    load();
  }, []);

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setClusterLoading(true);
    try {
      const res = await api.get(`/api/identity/cluster/${encodeURIComponent(searchQuery)}`);
      setCluster(res.data ?? MOCK_CLUSTER);
    } catch {
      setCluster(MOCK_CLUSTER);
    }
    setClusterLoading(false);
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">Identity Resolution Centre</h1>
        <p className="text-sm text-gray-500 mt-0.5">Manage profile stitching, merge decisions, and identity graph</p>
      </div>

      {/* ── KPI Row ── */}
      <div className="grid grid-cols-4 gap-4">
        <KpiCard
          title="Total Profiles Unified"
          value={stats.totalUnified.toLocaleString()}
          delta={3.2}
          icon={GitMerge}
          loading={statsLoading}
          color="blue"
        />
        <KpiCard
          title="Match Rate"
          value={stats.matchRate.toFixed(1)}
          suffix="%"
          delta={1.4}
          icon={CheckCircle}
          loading={statsLoading}
          color="green"
        />
        <KpiCard
          title="Pending Review"
          value={stats.pendingReview}
          delta={stats.pendingReview > 50 ? 5 : -8}
          icon={Clock}
          loading={statsLoading}
          color="orange"
        />
        <KpiCard
          title="Anon Profiles Active"
          value={stats.anonActive.toLocaleString()}
          delta={-2.1}
          icon={User}
          loading={statsLoading}
          color="purple"
        />
      </div>

      {/* ── Identity Graph Visualiser ── */}
      <div className="card space-y-4">
        <div className="flex items-center gap-2">
          <Link2 size={18} className="text-pega-blue" />
          <h2 className="font-semibold text-gray-800">Identity Graph Visualiser</h2>
        </div>

        <form onSubmit={handleSearch} className="flex gap-3">
          <div className="flex-1 relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pega-blue"
              placeholder="Enter email, phone, or customer ID…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <button type="submit" disabled={clusterLoading} className="btn-primary flex items-center gap-2 px-5">
            {clusterLoading ? <RefreshCw size={15} className="animate-spin" /> : <Search size={15} />}
            {clusterLoading ? 'Resolving…' : 'Resolve'}
          </button>
        </form>

        {/* Shortcut hints */}
        <div className="flex gap-2 flex-wrap">
          {['CUST-001', 'sarah.johnson@example.com', '+1 (555) 234-7890'].map((q) => (
            <button key={q} type="button"
              onClick={() => setSearchQuery(q)}
              className="text-xs px-2.5 py-1 bg-gray-100 text-gray-500 rounded-full hover:bg-pega-light hover:text-pega-blue transition-colors">
              {q}
            </button>
          ))}
        </div>

        {cluster ? (
          <IdentityGraph cluster={cluster} />
        ) : (
          <div className="flex items-center justify-center h-48 bg-gray-50 rounded-xl border border-dashed border-gray-200">
            <div className="text-center">
              <Link2 size={32} className="text-gray-200 mx-auto mb-2" />
              <p className="text-sm text-gray-400">Search to visualise an identity cluster</p>
            </div>
          </div>
        )}

        {/* Node type legend */}
        <div className="flex flex-wrap gap-3 pt-1">
          {Object.entries(NODE_STYLES).map(([type, style]) => {
            const NodeIcon = style.icon;
            return (
              <div key={type} className="flex items-center gap-1.5">
                <div className={clsx('p-1 rounded-full', style.bg)}>
                  <NodeIcon size={10} className={style.text} />
                </div>
                <span className="text-xs text-gray-500 capitalize">{type}</span>
              </div>
            );
          })}
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 bg-pega-blue rounded-full flex items-center justify-center">
              <User size={9} className="text-white" />
            </div>
            <span className="text-xs text-gray-500">Golden Record</span>
          </div>
        </div>
      </div>

      {/* ── Review Queue ── */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Clock size={18} className="text-amber-500" />
            <h2 className="font-semibold text-gray-800">Review Queue</h2>
          </div>
          <span className="text-xs text-gray-400 flex items-center gap-1">
            <RefreshCw size={11} /> Auto-refreshes every 10s
          </span>
        </div>
        <ReviewQueue />
      </div>

      {/* ── Recent Stitches + Match Rule Performance ── */}
      <div className="grid grid-cols-2 gap-4">

        {/* Recent Stitches */}
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <Activity size={18} className="text-green-600" />
            <h2 className="font-semibold text-gray-800">Recent Stitches</h2>
          </div>

          {/* Summary row */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="p-3 bg-green-50 rounded-lg">
              <p className="text-xs text-green-600 font-medium">Stitches (last 24h)</p>
              <p className="text-2xl font-bold text-gray-900 mt-0.5">{stitchStats.last24h.toLocaleString()}</p>
            </div>
            <div className="p-3 bg-blue-50 rounded-lg">
              <p className="text-xs text-blue-600 font-medium">Avg Signal Added</p>
              <p className="text-2xl font-bold text-gray-900 mt-0.5">{stitchStats.avgSignalAdded} <span className="text-sm font-normal text-gray-500">events</span></p>
            </div>
          </div>

          {/* Last 10 stitches */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-100">
                  {['Cookie ID', 'Customer', 'Events', 'Segments', 'When'].map((h) => (
                    <th key={h} className="text-left text-gray-400 font-medium py-1.5 pr-3 last:pr-0">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stitchStats.recent.map((row, i) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td className="py-1.5 pr-3 font-mono text-gray-500">{row.cookieId}</td>
                    <td className="py-1.5 pr-3 text-pega-blue font-medium">{row.customerId}</td>
                    <td className="py-1.5 pr-3 text-gray-700">+{row.eventsAdded}</td>
                    <td className="py-1.5 pr-3 text-gray-700">+{row.segmentsAdded}</td>
                    <td className="py-1.5 text-gray-400">{row.time}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Match Rule Performance */}
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <BarChart2 size={18} className="text-pega-blue" />
            <h2 className="font-semibold text-gray-800">Match Rule Performance</h2>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={MOCK_RULE_PERF} layout="vertical" margin={{ left: 10, right: 10 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
              <YAxis type="category" dataKey="rule" tick={{ fontSize: 10 }} width={110} />
              <Tooltip
                formatter={(value, name) => [value.toLocaleString(), name]}
                contentStyle={{ fontSize: 12 }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="autoMerged"   name="Auto-Merged"    fill="#22c55e" stackId="a" radius={[0, 0, 0, 0]} />
              <Bar dataKey="reviewQueued" name="Review Queued"  fill="#f59e0b" stackId="a" />
              <Bar dataKey="noMatch"      name="No Match"       fill="#9ca3af" stackId="a" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
