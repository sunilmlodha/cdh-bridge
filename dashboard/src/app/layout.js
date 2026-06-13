'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import {
  LayoutDashboard, Plug, Users, Zap, Target, RefreshCw,
  Shield, FileText, Settings, ChevronRight, Link2, Type,
} from 'lucide-react';
import './globals.css';

const NAV_ITEMS = [
  { href: '/',           label: 'Dashboard',    icon: LayoutDashboard },
  { href: '/connectors', label: 'Connectors',   icon: Plug },
  { href: '/profiles',   label: 'Profiles',     icon: Users },
  { href: '/identity',   label: 'Identity',     icon: Link2 },
  { href: '/events',     label: 'Events',       icon: Zap },
  { href: '/segments',   label: 'Segments',     icon: Target },
  { href: '/nba',        label: 'NBA Decisions', icon: ChevronRight },
  { href: '/feedback',   label: 'Feedback Loop', icon: RefreshCw },
  { href: '/consent',    label: 'Consent',      icon: Shield },
  { href: '/audit',      label: 'Audit Log',    icon: FileText },
  { href: '/settings',   label: 'Settings',     icon: Settings },
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
    <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-sidebar-muted)' }}>
      <span className={clsx(
        'w-2 h-2 rounded-full',
        healthy === null ? 'bg-blue-300' : healthy ? 'bg-green-400 pulse-dot' : 'bg-red-400 pulse-dot'
      )} />
      {healthy === null ? 'Checking…' : healthy ? 'All systems live' : 'Backend offline'}
    </span>
  );
}

function ThemeToggle({ theme, onToggle }) {
  const isEditorial = theme === 'editorial';
  return (
    <button
      onClick={onToggle}
      className="theme-toggle"
      title={isEditorial ? 'Switch to Default theme' : 'Switch to DCS Editorial theme'}
      aria-label="Toggle theme"
    >
      <Type size={11} />
      {isEditorial ? 'Default' : 'Editorial'}
    </button>
  );
}

export default function RootLayout({ children }) {
  const pathname = usePathname();
  const [theme, setTheme] = useState('default');

  // Persist theme in localStorage
  useEffect(() => {
    const saved = typeof window !== 'undefined'
      ? localStorage.getItem('cdh-theme') : null;
    if (saved === 'editorial') setTheme('editorial');
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(prev => {
      const next = prev === 'default' ? 'editorial' : 'default';
      if (typeof window !== 'undefined') localStorage.setItem('cdh-theme', next);
      return next;
    });
  }, []);

  const isEditorial = theme === 'editorial';

  return (
    <html lang="en" data-theme={isEditorial ? 'editorial' : undefined}>
      <head>
        {/* Preconnect for faster font loading */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body
        className="flex h-screen overflow-hidden"
        style={{ background: 'var(--bg)', color: 'var(--text)' }}
      >
        {/* Sidebar */}
        <aside
          className="w-60 flex flex-col flex-shrink-0 overflow-y-auto"
          style={{ background: 'var(--bg-sidebar)' }}
        >
          {/* Logo */}
          <div className="px-4 py-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
            <div className="flex items-center gap-2.5">
              <div
                className="w-8 h-8 flex items-center justify-center flex-shrink-0"
                style={{
                  background: 'var(--logo-bg)',
                  color: 'var(--logo-text)',
                  borderRadius: 'var(--radius-sm)',
                  border: isEditorial ? '1.5px solid var(--border)' : 'none',
                }}
              >
                <span className="font-bold text-sm" style={{ fontFamily: 'var(--font-heading)' }}>N</span>
              </div>
              <div>
                <p
                  className="font-semibold text-sm leading-tight"
                  style={{ color: 'var(--text-sidebar)', fontFamily: 'var(--font-heading)' }}
                >
                  CDH Bridge
                </p>
                <p className="text-xs" style={{ color: 'var(--text-sidebar-muted)' }}>
                  Admin Console
                </p>
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
                  className="sidebar-link"
                  data-active={isActive ? 'true' : undefined}
                  style={isActive ? {
                    background: 'var(--nav-active-bg)',
                    color: 'var(--nav-active-text)',
                    fontWeight: 600,
                  } : {}}
                >
                  <Icon size={15} className="flex-shrink-0" />
                  {label}
                </Link>
              );
            })}
          </nav>

          {/* Footer */}
          <div className="px-4 py-4" style={{ borderTop: '1px solid rgba(255,255,255,0.1)' }}>
            <HealthDot />
            <div className="flex items-center justify-between mt-2">
              <p className="text-xs" style={{ color: 'var(--text-sidebar-muted)' }}>v1.0.0</p>
              <ThemeToggle theme={theme} onToggle={toggleTheme} />
            </div>
          </div>
        </aside>

        {/* Main */}
        <main className="flex-1 overflow-y-auto" style={{ background: 'var(--bg)' }}>
          {children}
        </main>
      </body>
    </html>
  );
}
