/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  async rewrites() {
    // In Docker: set SERVICES_BASE_URL=http://service-name
    // In local dev: services run on localhost:300x
    const base = process.env.SERVICES_BASE_URL || 'http://localhost'
    return [
      // Mock CDH
      { source: '/api/mock-cdh/:path*',  destination: `${base}:3010/:path*` },
      // Connector service (port 3005)
      { source: '/api/connectors/:path*', destination: `${base}:3005/v1/connectors/:path*` },
      // Profile router (port 3002)
      { source: '/api/profiles/:path*',   destination: `${base}:3002/v1/profiles/:path*` },
      { source: '/api/profile-stats',     destination: `${base}:3002/v1/profiles/stats` },
      // Event collector (port 3001)
      { source: '/api/events/recent',     destination: `${base}:3001/v1/events/recent` },
      { source: '/api/events/:path*',     destination: `${base}:3001/v1/events/:path*` },
      { source: '/api/event-stats',       destination: `${base}:3001/v1/events/stats` },
      // Feedback loop (port 3003)
      { source: '/api/feedback/:path*',   destination: `${base}:3003/v1/feedback/:path*` },
      { source: '/api/lift/:path*',       destination: `${base}:3003/v1/feedback/lift/:path*` },
      // Consent service (port 3004)
      { source: '/api/consent/:path*',    destination: `${base}:3004/v1/consent/:path*` },
      { source: '/api/audit/:path*',      destination: `${base}:3004/v1/consent/audit/:path*` },
      // Identity resolution (port 3002)
      { source: '/api/identity/:path*',   destination: `${base}:3002/v1/identity/:path*` },
      // Health
      { source: '/api/health',            destination: `${base}:3001/health` },
    ]
  },
}

module.exports = nextConfig
