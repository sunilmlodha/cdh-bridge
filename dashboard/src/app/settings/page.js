'use client';

import { useState } from 'react';
import { Settings, Save, RefreshCw } from 'lucide-react';

const DEFAULT_CONFIG = {
  cdhApiUrl: 'https://cdh.bank.pega.com/prweb/api/v1',
  cdhTenantId: 'BANK-CDH-PROD',
  eventCollectorUrl: 'http://event-collector:4003',
  profileRouterUrl: 'http://profile-router:4002',
  connectorServiceUrl: 'http://connector-service:4001',
  feedbackLoopUrl: 'http://feedback-loop:4004',
  consentServiceUrl: 'http://consent-service:4005',
  refreshIntervalMs: '3000',
  maxRetries: '3',
  timeoutMs: '8000',
  logLevel: 'info',
  enableMockData: 'true',
};

export default function SettingsPage() {
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [saved, setSaved] = useState(false);

  const handleSave = (e) => {
    e.preventDefault();
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const sections = [
    {
      title: 'CDH Connection',
      fields: ['cdhApiUrl', 'cdhTenantId'],
    },
    {
      title: 'Backend Services',
      fields: ['eventCollectorUrl', 'profileRouterUrl', 'connectorServiceUrl', 'feedbackLoopUrl', 'consentServiceUrl'],
    },
    {
      title: 'Dashboard Behaviour',
      fields: ['refreshIntervalMs', 'maxRetries', 'timeoutMs', 'logLevel', 'enableMockData'],
    },
  ];

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <Settings size={24} className="text-gray-500" />
        <div>
          <h1 className="text-xl font-bold text-gray-900">Settings</h1>
          <p className="text-sm text-gray-500">CDH Bridge dashboard configuration</p>
        </div>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {sections.map(({ title, fields }) => (
          <div key={title} className="card space-y-4">
            <h2 className="font-semibold text-gray-700 text-sm border-b border-gray-100 pb-2">{title}</h2>
            {fields.map((key) => (
              <div key={key}>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  {key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())}
                </label>
                <input
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-pega-blue"
                  value={config[key]}
                  onChange={(e) => setConfig({ ...config, [key]: e.target.value })}
                />
              </div>
            ))}
          </div>
        ))}

        <div className="flex gap-3">
          <button type="submit" className={`btn-primary flex items-center gap-2 ${saved ? 'bg-green-500' : ''}`}>
            <Save size={16} />
            {saved ? 'Saved!' : 'Save Settings'}
          </button>
          <button type="button" onClick={() => setConfig(DEFAULT_CONFIG)} className="btn-secondary flex items-center gap-2">
            <RefreshCw size={16} />
            Reset to Defaults
          </button>
        </div>
      </form>
    </div>
  );
}
