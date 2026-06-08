# Deploy to Railway

## One-Time Setup

### 1. Create Railway project
```bash
railway login
railway init cdh-bridge
```

### 2. Add managed infrastructure plugins
In Railway dashboard → your project → **Add Plugin**:
- ✅ **Redis** — Railway injects `REDIS_URL` automatically
- ✅ **Kafka** (or use Upstash Kafka) — provides `KAFKA_URL`

### 3. Set environment variables
```bash
railway variables set \
  PEGA_CDH_URL=http://mock-cdh.railway.internal:3010 \
  PEGA_CDH_AUTH_TOKEN=prod-token-change-me \
  JWT_SECRET=prod-secret-change-me \
  CORS_ORIGINS=https://cdh-bridge-demos.vercel.app,https://cdh-bridge-dashboard.vercel.app \
  NODE_ENV=production \
  LOG_LEVEL=info \
  MOCK_DATA=true
```

### 4. Deploy
```bash
railway up
```

## Service URLs
Railway assigns public URLs to each service:
```
https://mock-cdh-production.up.railway.app          → Mock Pega CDH
https://event-collector-production.up.railway.app   → Event Collector (SDK endpoint)
https://profile-router-production.up.railway.app    → Profile Router
https://feedback-loop-production.up.railway.app     → Feedback Loop
https://consent-service-production.up.railway.app   → Consent Service
https://connector-service-production.up.railway.app → Connector Service
```

## Wire up Vercel demos

After Railway deploy, update Vercel env vars:
```bash
cd ../../dashboard
vercel env add SERVICES_BASE_URL production
# Enter: https://cdh-bridge-api.up.railway.app
vercel deploy --prod --scope dcs2
```

Or set it in the Vercel dashboard → Project Settings → Environment Variables.
