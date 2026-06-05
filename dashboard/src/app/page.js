'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Users, Zap, Clock, TrendingUp, AlertTriangle } from 'lucide-react';
import KpiCard from '@/components/KpiCard';
import LiveFeed from '@/components/LiveFeed';
import StatusBadge from '@/components/StatusBadge';
import SlaBar from '@/components/SlaBar';
import { fetcher, MOCK_CONNECTORS, MOCK_LIFT_DATA, MOCK_EVENTS, MOCK_CONSENT_REQUESTS } from '@/lib/api';

const REFRESH = 3000;

function useMockFallback(swrData, mockData) {
  return swrData ?? mockData;
}

export default function DashboardPage() {
  const { data: profileStats } = useSWR('/api/profile-stats', fetcher, { refreshInterval: REFRESH });
  const { data: eventStats } = useSWR('/api/event-stats', fetcher, { refreshInterval: REFRESH });
  const { data: connectors } = useSWR('/api/connectors', fetcher, { refreshInterval: REFRESH });
  const { data: liftData } = useSWR('/api/lift/history', fetcher, { refreshInterval: 30000 });
  const { data: events } = useSWR('/api/events/recent', fetcher, { refreshInterval: REFRESH });
  const { data: consentRequests } = useSWR('/api/consent/requests', fetcher, { refreshInterval: 10000 });

  const connectorList = useMockFallback(connectors, MOCK_CONNECTORS);
  const liftHistory = useMockFallback(liftData, MOCK_LIFT_DATA);
  const eventList = useMockFallback(events, MOCK_EVENTS);
  const pendingConsent = useMockFallback(consentRequests, MOCK_CONSENT_REQUESTS);

  const totalProfiles = profileStats?.total ?? 2_847_392;
  const eventsPerSec = eventStats?.eventsPerSec ?? 342;
  const p99Latency = eventStats?.p99Ms ?? 87;
  const nbaLift = liftHistory?.at?.(-1)?.lift ?? 23;

  const healthyConnectors = connectorList?.filter((c) => c.status === 'healthy').length ?? 0;
  const totalConnectors = connectorList?.length ?? 15;
  const alertConnectors = connectorList?.filter((c) => c.status === 'error' || c.status === 'warning') ?? [];

  const pendingGdpr = pendingConsent?.filter((r) => r.status === 'pending' || r.status === 'in-progress') ?? [];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Command Centre</h1>
          <p className="text-sm text-gray-500 mt-0.5">Real-time CDH Bridge health & activity</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <span className="w-2 h-2 rounded-full bg-green-400 pulse-dot inline-block" />
          Live · refreshes every 3s
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4">
        <KpiCard
          title="Total Profiles"
          value={totalProfiles.toLocaleString()}
          delta={2.4}
          icon={Users}
          color="blue"
        />
        <KpiCard
          title="Events / sec"
          value={eventsPerSec.toLocaleString()}
          delta={12}
          icon={Zap}
          color="green"
        />
        <KpiCard
          title="CDH Latency p99"
          value={p99Latency}
          suffix="ms"
          delta={-5}
          icon={Clock}
          color="orange"
        />
        <KpiCard
          title="NBA Lift"
          value={`+${nbaLift}`}
          suffix="%"
          delta={3}
          icon={TrendingUp}
          color="purple"
        />
      </div>

      {/* Row 2: Connector Health + Live Feed */}
      <div className="grid grid-cols-5 gap-4">
        {/* Connector Health */}
        <div className="card col-span-3">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-800">Connector Health</h2>
            <span className="text-xs text-gray-500">{healthyConnectors}/{totalConnectors} healthy</span>
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: 280 }}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left text-xs text-gray-400 font-medium py-2 pr-3">Connector</th>
                  <th className="text-left text-xs text-gray-400 font-medium py-2 pr-3">Status</th>
                  <th className="text-right text-xs text-gray-400 font-medium py-2 pr-3">Throughput</th>
                  <th className="text-right text-xs text-gray-400 font-medium py-2">Last Sync</th>
                </tr>
              </thead>
              <tbody>
                {connectorList?.map((conn) => (
                  <tr key={conn.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2 pr-3 font-medium text-gray-700 text-xs">{conn.name}</td>
                    <td className="py-2 pr-3">
                      <StatusBadge status={conn.status} pulse={conn.status === 'healthy'} />
                    </td>
                    <td className="py-2 pr-3 text-right text-xs text-gray-500">
                      {conn.throughput?.toLocaleString()}/min
                    </td>
                    <td className="py-2 text-right text-xs text-gray-400">
                      {new Date(conn.lastSync).toLocaleTimeString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Live Activity Feed */}
        <div className="card col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-800">Live Activity</h2>
            <span className="flex items-center gap-1 text-xs text-green-600">
              <span className="w-1.5 h-1.5 bg-green-500 rounded-full pulse-dot" />
              streaming
            </span>
          </div>
          <LiveFeed events={eventList} />
        </div>
      </div>

      {/* Row 3: NBA Lift Chart + Consent Alerts */}
      <div className="grid grid-cols-5 gap-4">
        {/* NBA Lift Chart */}
        <div className="card col-span-3">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-800">NBA Lift — 14 Day</h2>
            <span className="text-xs font-semibold text-green-600 bg-green-50 px-2 py-1 rounded-full">
              +{nbaLift}% avg lift
            </span>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={liftHistory} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} unit="%" />
              <Tooltip
                contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', fontSize: 12 }}
                formatter={(val) => [`${val}%`, 'Lift']}
              />
              <Bar dataKey="lift" fill="#0063AB" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Consent Alerts */}
        <div className="card col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-800">Consent Alerts</h2>
            {pendingGdpr.length > 0 && (
              <span className="flex items-center gap-1 text-xs text-amber-700 bg-amber-50 px-2 py-1 rounded-full">
                <AlertTriangle size={12} />
                {pendingGdpr.length} pending
              </span>
            )}
          </div>
          <div className="space-y-3 overflow-y-auto" style={{ maxHeight: 230 }}>
            {pendingGdpr.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">No pending requests</p>
            ) : (
              pendingGdpr.map((req) => (
                <div key={req.id} className="p-3 bg-gray-50 rounded-lg">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <span className="text-xs font-semibold text-gray-700">{req.type}</span>
                      <p className="text-xs text-gray-400 font-mono">{req.customerId}</p>
                    </div>
                    <StatusBadge status={req.status} />
                  </div>
                  <SlaBar daysElapsed={req.daysElapsed} slaDays={req.slaDays} />
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Alerts Row */}
      {alertConnectors.length > 0 && (
        <div className="card border-amber-200 bg-amber-50">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={16} className="text-amber-600" />
            <h3 className="font-semibold text-amber-800 text-sm">Connector Alerts</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {alertConnectors.map((c) => (
              <div key={c.id} className="flex items-center gap-2 bg-white px-3 py-2 rounded-lg text-xs shadow-sm">
                <StatusBadge status={c.status} />
                <span className="text-gray-700 font-medium">{c.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
