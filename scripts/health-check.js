#!/usr/bin/env node
/**
 * health-check.js
 * Checks /health on all 7 CDH Bridge services and prints a status table.
 * Exits with code 1 if any service is down.
 * Run: node scripts/health-check.js
 */

const http = require('http');

const SERVICES = [
  { name: 'event-collector',   port: 3001 },
  { name: 'profile-router',    port: 3002 },
  { name: 'feedback-loop',     port: 3003 },
  { name: 'consent-service',   port: 3004 },
  { name: 'connector-service', port: 3005 },
  { name: 'mock-cdh',          port: 3010 },
  { name: 'dashboard',         port: 3000 },
];

const TIMEOUT_MS = 5000;

function checkHealth(service) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const req = http.request(
      {
        hostname: 'localhost',
        port:     service.port,
        path:     '/health',
        method:   'GET',
        timeout:  TIMEOUT_MS,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          const latency = Date.now() - startedAt;
          const up = res.statusCode >= 200 && res.statusCode < 300;
          resolve({ ...service, up, status: res.statusCode, latency, body: body.slice(0, 120) });
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      resolve({ ...service, up: false, status: 'TIMEOUT', latency: TIMEOUT_MS, body: '' });
    });

    req.on('error', (err) => {
      const latency = Date.now() - startedAt;
      resolve({ ...service, up: false, status: 'CONN_REFUSED', latency, body: err.message });
    });

    req.end();
  });
}

function row(name, port, status, latency, note) {
  const portStr    = String(port).padEnd(5);
  const statusStr  = String(status).padEnd(13);
  const latencyStr = (String(latency) + 'ms').padEnd(9);
  return `  ${name.padEnd(22)} ${portStr} ${statusStr} ${latencyStr} ${note}`;
}

(async () => {
  console.log('\n=== CDH Bridge Health Check ===');
  console.log(`  Checking ${SERVICES.length} services at ${new Date().toISOString()}\n`);
  console.log(row('SERVICE', 'PORT', 'HTTP STATUS', 'LATENCY', 'NOTE'));
  console.log('  ' + '-'.repeat(72));

  const results = await Promise.all(SERVICES.map(checkHealth));

  let anyDown = false;

  for (const r of results) {
    const icon = r.up ? 'UP  ' : 'DOWN';
    const note = r.up ? 'OK' : r.body || 'unreachable';
    console.log(row(r.name, r.port, `${icon} (${r.status})`, r.latency, note.slice(0, 40)));
    if (!r.up) anyDown = true;
  }

  console.log('  ' + '-'.repeat(72));

  const upCount   = results.filter((r) => r.up).length;
  const downCount = results.length - upCount;

  console.log(`\n  ${upCount}/${results.length} services healthy.`);

  if (anyDown) {
    const downList = results.filter((r) => !r.up).map((r) => r.name).join(', ');
    console.log(`  DOWN: ${downList}`);
    console.log('\n  Start all services with: docker-compose up\n');
    process.exit(1);
  }

  console.log('\n  All services are up and healthy.\n');
  process.exit(0);
})();
