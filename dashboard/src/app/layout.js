'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import {
  LayoutDashboard, Plug, Users, Zap, Target, RefreshCw, Shield, FileText, Settings, ChevronRight
} from 'lucide-react';
import './globals.css';

const NAV_ITEMS = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/connectors', label: 'Connectors', icon: Plug },
  { href: '/profiles', label: 'Profiles', icon: Users },
  { href: '/events', label: 'Events', icon: Zap },
  { href: '/segments', label: 'Segments', icon: Target },
  { href: '/nba', label: 'NBA Decisions', icon: ChevronRight },
  { href: '/feedback', label: 'Feedback Loop', icon: RefreshCw },
  { href: '/consent', label: 'Consent', icon: Shield },
  { href: '/audit', label: 'Audit Log', icon: FileText },
  { href: '/settings', label: 'Settings', icon: Settings },
];

function HealthDot() {
  const [healthy, setHealthy] = useState(null);

  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch('/api/health', { cache: 'no-store' });
        setHealthy(res.ok);
      } catch {
        setHealthy(false);
      }
    };
    check();
    const t = setInterval(check, 10000);
    return () => clearInterval(t);
  }, []);

  return (
    <span className="flex items-center gap-1.5 text-xs text-blue-200">
      <span className={clsx(
        'w-2 h-2 rounded-full',
        healthy === null ? 'bg-blue-300' : healthy ? 'bg-green-400 pulse-dot' : 'bg-red-400 pulse-dot'
      )} />
      {healthy === null ? 'Checking…' : healthy ? 'All systems live' : 'Backend offline'}
    </span>
  );
}

export default function RootLayout({ children }) {
  const pathname = usePathname();

  return (
    <html lang="en">
      <body className="bg-gray-50 flex h-screen overflow-hidden">
        {/* Sidebar */}
        <aside className="w-60 bg-pega-dark flex flex-col flex-shrink-0 overflow-y-auto">
          {/* Logo */}
          <div className="px-4 py-5 border-b border-white/10">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 bg-pega-blue rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">N</span>
              </div>
              <div>
                <p className="text-white font-semibold text-sm leading-tight">CDH Bridge</p>
                <p className="text-blue-300 text-xs">Admin Console</p>
              </div>
            </div>
          </div>

          {/* Nav */}
          <nav className="flex-1 px-3 py-4 space-y-0.5">
            {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
              const isActive = href === '/' ? pathname === '/' : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={clsx(
                    'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150',
                    isActive
                      ? 'bg-white/20 text-white'
                      : 'text-blue-200 hover:bg-white/10 hover:text-white'
                  )}
                >
                  <Icon size={16} className="flex-shrink-0" />
                  {label}
                </Link>
              );
            })}
          </nav>

          {/* Footer */}
          <div className="px-4 py-4 border-t border-white/10">
            <HealthDot />
            <p className="text-blue-400 text-xs mt-1">v1.0.0 · Pega CDH</p>
          </div>
        </aside>

        {/* Main */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </body>
    </html>
  );
}
