'use client';

import { useState, useEffect } from 'react';
import useSWR from 'swr';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Legend
} from 'recharts';
import { TrendingUp } from 'lucide-react';
import StatusBadge from '@/components/StatusBadge';
import { fetcher, MOCK_LIFT_DATA, MOCK_NBA_DECISIONS } from '@/lib/api';

// 30-day acceptance rate mock data
const ACCEPTANCE_DATA = Array.from({ length: 30 }, (_, i) => ({
  date: new Date(Date.now() - (29 - i) * 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  acceptance: 40 + Math.floor(Math.random() * 25),
  baseline: 32,
}));

const CHANNEL_BREAKDOWN = [
  { channel: 'Email', lift: 28, acceptance: 62 },
  { channel: 'Mobile App', lift: 31, acceptance: 58 },
  { channel: 'Web', lift: 19, acceptance: 44 },
  { channel: 'SMS', lift: 22, acceptance: 51 },
  { channel: 'Call Centre', lift: 15, acceptance: 38 },
];

const OFFER_BREAKDOWN = [
  { offer: 'Premium Upgrade', lift: 35, count: 892 },
  { offer: 'Loyalty Reward', lift: 28, count: 1240 },
  { offer: 'Cross-sell', lift: 21, count: 678 },
  { offer: 'Retention', lift: 18, count: 432 },
  { offer: 'Credit Increase', lift: 14, count: 310 },
];

function AnimatedCounter({ target, duration = 1500 }) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    let start = 0;
    const step = target / (duration / 16);
    const timer = setInterval(() => {
      start += step;
      if (start >= target) { setValue(target); clearInterval(timer); }
      else setValue(Math.floor(start));
    }, 16);
    return () => clearInterval(timer);
  }, [target, duration]);
  return <span>{value}</span>;
}

export default function FeedbackPage() {
  const { data: liftData } = useSWR('/api/lift/history', fetcher, { refreshInterval: 30000 });
  const { data: decisions } = useSWR('/api/feedback/decisions', fetcher, { refreshInterval: 10000 });

  const liftHistory = liftData ?? MOCK_LIFT_DATA;
  const nbaDecisions = decisions ?? MOCK_NBA_DECISIONS;
  const currentLift = liftHistory.at(-1)?.lift ?? 23;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">NBA Feedback Loop</h1>
        <p className="text-sm text-gray-500 mt-0.5">Next Best Action performance & acceptance analytics</p>
      </div>

      {/* Big lift number */}
      <div className="grid grid-cols-4 gap-4">
        <div className="card col-span-1 flex flex-col items-center justify-center py-8">
          <div className="flex items-center gap-1 text-green-600 mb-1">
            <TrendingUp size={20} />
            <span className="text-xs font-medium">NBA Lift</span>
          </div>
          <div className="text-5xl font-black text-gray-900">
            +<AnimatedCounter target={currentLift} />%
          </div>
          <p className="text-xs text-gray-400 mt-2">vs. random baseline</p>
        </div>
        <div className="card col-span-1 flex flex-col items-center justify-center">
          <p className="text-xs text-gray-400">Total Decisions</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">24,891</p>
          <p className="text-xs text-green-600 mt-1">▲ +8% this week</p>
        </div>
        <div className="card col-span-1 flex flex-col items-center justify-center">
          <p className="text-xs text-gray-400">Acceptance Rate</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">54.2%</p>
          <p className="text-xs text-green-600 mt-1">▲ +3.1pp vs last month</p>
        </div>
        <div className="card col-span-1 flex flex-col items-center justify-center">
          <p className="text-xs text-gray-400">Avg Propensity Score</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">0.71</p>
          <p className="text-xs text-gray-400 mt-1">Model v2.4</p>
        </div>
      </div>

      {/* Acceptance Rate Chart */}
      <div className="card">
        <h2 className="font-semibold text-gray-800 mb-4">Acceptance Rate — 30 Days</h2>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={ACCEPTANCE_DATA} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} interval={4} />
            <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} unit="%" />
            <Tooltip
              contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', fontSize: 11 }}
              formatter={(val, name) => [`${val}%`, name === 'acceptance' ? 'Acceptance' : 'Baseline']}
            />
            <Line type="monotone" dataKey="baseline" stroke="#e5e7eb" strokeWidth={2} dot={false} strokeDasharray="4 4" />
            <Line type="monotone" dataKey="acceptance" stroke="#0063AB" strokeWidth={2.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Breakdown Charts */}
      <div className="grid grid-cols-2 gap-4">
        <div className="card">
          <h2 className="font-semibold text-gray-800 mb-4">Lift by Channel</h2>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={CHANNEL_BREAKDOWN} layout="vertical" margin={{ left: 10, right: 10 }}>
              <XAxis type="number" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} unit="%" />
              <YAxis type="category" dataKey="channel" tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} width={70} />
              <Tooltip formatter={(val) => [`${val}%`]} />
              <Bar dataKey="lift" fill="#0063AB" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="card">
          <h2 className="font-semibold text-gray-800 mb-4">Lift by Offer Type</h2>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={OFFER_BREAKDOWN} layout="vertical" margin={{ left: 20, right: 10 }}>
              <XAxis type="number" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} unit="%" />
              <YAxis type="category" dataKey="offer" tick={{ fontSize: 10, fill: '#6b7280' }} tickLine={false} axisLine={false} width={90} />
              <Tooltip formatter={(val) => [`${val}%`]} />
              <Bar dataKey="lift" fill="#003A61" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Recent Decisions Table */}
      <div className="card">
        <h2 className="font-semibold text-gray-800 mb-4">Recent NBA Decisions</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                {['Timestamp', 'Customer', 'Offer', 'Channel', 'Propensity', 'Outcome'].map((h) => (
                  <th key={h} className="text-left text-xs text-gray-400 font-medium py-2 pr-4">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {nbaDecisions.map((d) => (
                <tr key={d.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-2 pr-4 text-xs text-gray-400 font-mono">
                    {new Date(d.timestamp).toLocaleString()}
                  </td>
                  <td className="py-2 pr-4 text-xs font-mono text-gray-600">{d.customerId}</td>
                  <td className="py-2 pr-4 text-sm text-gray-700 font-medium">{d.offer}</td>
                  <td className="py-2 pr-4 text-xs text-gray-500">{d.channel}</td>
                  <td className="py-2 pr-4">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-pega-blue rounded-full" style={{ width: `${d.propensity * 100}%` }} />
                      </div>
                      <span className="text-xs text-gray-500">{d.propensity}</span>
                    </div>
                  </td>
                  <td className="py-2">
                    <StatusBadge status={d.outcome} />
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
