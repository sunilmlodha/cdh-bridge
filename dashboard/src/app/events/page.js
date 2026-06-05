'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, Filter } from 'lucide-react';
import StatusBadge from '@/components/StatusBadge';
import { MOCK_EVENTS } from '@/lib/api';
import clsx from 'clsx';

const EVENT_TYPES = ['All', 'PageView', 'Purchase', 'AddToCart', 'FormSubmit', 'Login', 'Search', 'OfferClick'];
const CHANNELS = ['All', 'Web', 'Mobile', 'Email', 'SMS', 'Call Centre'];

const MOCK_RAW_PAYLOAD = {
  eventType: 'Purchase',
  timestamp: new Date().toISOString(),
  customerId: 'CUST-482910',
  channel: 'Web',
  properties: {
    orderId: 'ORD-88291',
    amount: 149.99,
    currency: 'USD',
    items: [{ sku: 'PROD-001', qty: 2, price: 74.99 }],
  },
};

const MOCK_CDH_PAYLOAD = {
  CustomerID: 'CUST-482910',
  InteractionType: 'Purchase',
  Channel: 'Web',
  DateTime: new Date().toISOString(),
  Outcome: {
    OrderID: 'ORD-88291',
    Revenue: 149.99,
    Currency: 'USD',
    Products: [{ ProductID: 'PROD-001', Quantity: 2, Price: 74.99 }],
  },
};

function EventModal({ event, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[80vh] overflow-y-auto">
        <div className="flex justify-between items-center p-5 border-b border-gray-100">
          <div>
            <h2 className="font-semibold text-gray-900">Event Detail</h2>
            <p className="text-xs text-gray-400 font-mono mt-0.5">{event.id}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>
        <div className="p-5 grid grid-cols-2 gap-5">
          <div>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Raw Payload</h3>
            <pre className="bg-gray-900 text-green-400 p-4 rounded-lg text-xs overflow-x-auto leading-relaxed">
              {JSON.stringify(MOCK_RAW_PAYLOAD, null, 2)}
            </pre>
          </div>
          <div>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">CDH Mapped Payload</h3>
            <pre className="bg-pega-dark text-blue-200 p-4 rounded-lg text-xs overflow-x-auto leading-relaxed">
              {JSON.stringify(MOCK_CDH_PAYLOAD, null, 2)}
            </pre>
          </div>
        </div>
        <div className="p-5 border-t border-gray-100 grid grid-cols-4 gap-3">
          {[
            { label: 'Customer', value: event.customerId },
            { label: 'Channel', value: event.channel },
            { label: 'CDH Type', value: event.cdhType ?? 'purchase-event' },
            { label: 'Status', value: <StatusBadge status={event.status ?? 'mapped'} /> },
          ].map(({ label, value }) => (
            <div key={label}>
              <p className="text-xs text-gray-400">{label}</p>
              <div className="mt-1">{typeof value === 'string' ? <p className="text-sm font-medium text-gray-700">{value}</p> : value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function EventsPage() {
  const [events, setEvents] = useState(MOCK_EVENTS);
  const [filterType, setFilterType] = useState('All');
  const [filterChannel, setFilterChannel] = useState('All');
  const [selected, setSelected] = useState(null);

  // Poll every 2 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      const newEvent = {
        id: `evt-${Date.now()}`,
        timestamp: new Date().toISOString(),
        customerId: `CUST-${Math.floor(Math.random() * 900000) + 100000}`,
        eventType: EVENT_TYPES.slice(1)[Math.floor(Math.random() * 7)],
        channel: CHANNELS.slice(1)[Math.floor(Math.random() * 5)],
        cdhType: 'event-mapped',
        status: Math.random() > 0.05 ? 'mapped' : 'error',
      };
      setEvents((prev) => [newEvent, ...prev.slice(0, 49)]);
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const filtered = events.filter((e) => {
    if (filterType !== 'All' && e.eventType !== filterType) return false;
    if (filterChannel !== 'All' && e.channel !== filterChannel) return false;
    return true;
  });

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Live Event Stream</h1>
          <p className="text-sm text-gray-500 mt-0.5">Real-time event ingestion — polling every 2s</p>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-green-600 bg-green-50 px-3 py-1.5 rounded-full">
          <span className="w-1.5 h-1.5 bg-green-500 rounded-full pulse-dot" />
          Live
        </div>
      </div>

      {/* Filters */}
      <div className="card p-4">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Filter size={14} className="text-gray-400" />
            <span className="text-xs text-gray-500 font-medium">Filters</span>
          </div>
          <div>
            <label className="text-xs text-gray-400 mr-1.5">Event Type</label>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-pega-blue"
            >
              {EVENT_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-400 mr-1.5">Channel</label>
            <select
              value={filterChannel}
              onChange={(e) => setFilterChannel(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-pega-blue"
            >
              {CHANNELS.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <span className="text-xs text-gray-400 ml-auto">
            Showing {filtered.length} of {events.length} events
          </span>
        </div>
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        <div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 260px)' }}>
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-100 sticky top-0 z-10">
              <tr>
                {['Timestamp', 'Customer ID', 'Event Type', 'Channel', 'CDH Type', 'Status'].map((h) => (
                  <th key={h} className="text-left text-xs text-gray-400 font-medium px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((evt, idx) => (
                <tr
                  key={evt.id}
                  onClick={() => setSelected(evt)}
                  className={clsx(
                    'border-b border-gray-50 hover:bg-pega-light/30 cursor-pointer transition-colors',
                    idx === 0 && 'animate-pulse-once'
                  )}
                >
                  <td className="px-4 py-2.5 text-xs font-mono text-gray-500">
                    {new Date(evt.timestamp).toLocaleTimeString('en-US', { hour12: false })}
                  </td>
                  <td className="px-4 py-2.5 text-xs font-mono text-gray-600">{evt.customerId}</td>
                  <td className="px-4 py-2.5">
                    <span className={clsx(
                      'text-xs font-semibold',
                      evt.eventType === 'Purchase' ? 'text-green-700' :
                      evt.eventType === 'OfferClick' ? 'text-pega-blue' :
                      'text-gray-600'
                    )}>{evt.eventType}</span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-500">{evt.channel}</td>
                  <td className="px-4 py-2.5 text-xs font-mono text-gray-400">{evt.cdhType ?? 'mapped'}</td>
                  <td className="px-4 py-2.5">
                    <StatusBadge status={evt.status ?? 'mapped'} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <EventModal event={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
