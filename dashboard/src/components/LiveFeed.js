'use client';

import { useEffect, useRef, useState } from 'react';
import { MOCK_EVENTS } from '@/lib/api';

const EVENT_TYPE_COLORS = {
  Purchase: 'text-green-600 font-semibold',
  OfferClick: 'text-pega-blue font-semibold',
  Login: 'text-purple-600',
  PageView: 'text-gray-600',
  AddToCart: 'text-orange-600',
  FormSubmit: 'text-blue-600',
  Search: 'text-gray-500',
};

export default function LiveFeed({ events }) {
  const containerRef = useRef(null);
  const [displayEvents, setDisplayEvents] = useState(events ?? MOCK_EVENTS.slice(0, 20));

  useEffect(() => {
    if (events) {
      setDisplayEvents(events.slice(0, 20));
    }
  }, [events]);

  // Simulate new events arriving when no real data
  useEffect(() => {
    if (events) return;
    const interval = setInterval(() => {
      const newEvent = {
        id: `evt-${Date.now()}`,
        timestamp: new Date().toISOString(),
        customerId: `CUST-${Math.floor(Math.random() * 900000) + 100000}`,
        eventType: ['PageView', 'Purchase', 'AddToCart', 'FormSubmit', 'Login', 'Search', 'OfferClick'][Math.floor(Math.random() * 7)],
        channel: ['Web', 'Mobile', 'Email', 'SMS'][Math.floor(Math.random() * 4)],
        status: Math.random() > 0.05 ? 'mapped' : 'error',
      };
      setDisplayEvents((prev) => [newEvent, ...prev.slice(0, 19)]);
    }, 1800);
    return () => clearInterval(interval);
  }, [events]);

  return (
    <div ref={containerRef} className="overflow-y-auto" style={{ maxHeight: 320 }}>
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-white z-10">
          <tr className="border-b border-gray-100">
            <th className="text-left text-gray-400 font-medium py-2 pr-3 w-28">Time</th>
            <th className="text-left text-gray-400 font-medium py-2 pr-3">Customer</th>
            <th className="text-left text-gray-400 font-medium py-2 pr-3">Event</th>
            <th className="text-left text-gray-400 font-medium py-2">Channel</th>
          </tr>
        </thead>
        <tbody>
          {displayEvents.map((evt, idx) => (
            <tr
              key={evt.id ?? idx}
              className="border-b border-gray-50 hover:bg-gray-50 transition-colors"
              style={{ animation: idx === 0 ? 'fadeSlideIn 0.3s ease-out' : undefined }}
            >
              <td className="py-1.5 pr-3 text-gray-400 font-mono">
                {new Date(evt.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </td>
              <td className="py-1.5 pr-3 font-mono text-gray-500">{evt.customerId}</td>
              <td className={`py-1.5 pr-3 ${EVENT_TYPE_COLORS[evt.eventType] ?? 'text-gray-600'}`}>
                {evt.eventType}
              </td>
              <td className="py-1.5 text-gray-500">{evt.channel}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <style jsx>{`
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(-6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
