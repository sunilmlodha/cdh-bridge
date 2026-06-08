# CDH Bridge — Deployment Guide

## ✅ Deployed on Vercel

| Service | URL |
|---------|-----|
| **CDH Bridge Dashboard** | https://cdh-bridge-dashboard.vercel.app |
| **Demo Suite (DemoBank + Citadele)** | https://cdh-bridge-demos.vercel.app |
| DemoBank Web | https://cdh-bridge-demos.vercel.app/web |
| DemoBank Mobile | https://cdh-bridge-demos.vercel.app/mobile |
| Citadele Launcher | https://cdh-bridge-demos.vercel.app/citadele |
| Citadele Web Banking | https://cdh-bridge-demos.vercel.app/citadele/web |
| Citadele Mobile | https://cdh-bridge-demos.vercel.app/citadele/mobile |

## 🚂 Backend Services — Deploy on Railway

The 7 backend services (Kafka, Redis, Mock CDH, Event Collector, Profile Router,
Feedback Loop, Consent Service, Connector Service) run as Docker containers.

### One-click Railway deploy

1. Go to https://railway.app/new
2. Choose "Deploy from GitHub repo"
3. Select: `sunilmlodha/cdh-bridge`
4. Railway auto-detects `docker-compose.yml`
5. Set these environment variables in Railway:
   ```
   NODE_ENV=production
   PEGA_CDH_AUTH_TOKEN=prod-token-replace-me
   JWT_SECRET=prod-secret-replace-me
   LOG_LEVEL=info
   MOCK_DATA=true
   ```
6. Railway provides a public URL like: `https://cdh-bridge-api-production.up.railway.app`
7. Update the Vercel Dashboard env var `SERVICES_BASE_URL` to that URL

### After Railway deploy — update demos

Set `window.NEXUS_RAILWAY_URL` before loading the SDK in your banking apps:
```html
<script>
  window.NEXUS_RAILWAY_URL = 'https://your-railway-url.up.railway.app';
</script>
<script src="https://cdh-bridge-demos.vercel.app/sdk/nexus.js"></script>
```

## 🖥️ Local Development

```bash
git clone https://github.com/sunilmlodha/cdh-bridge
cd cdh-bridge
cp .env.example .env
docker compose up -d

# Services:
# Dashboard:         http://localhost:3000
# Event Collector:   http://localhost:3001
# Profile Router:    http://localhost:3002
# Feedback Loop:     http://localhost:3003
# Consent Service:   http://localhost:3004
# Connector Service: http://localhost:3005
# Mock Pega CDH:     http://localhost:3010
```
