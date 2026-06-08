# CDH Bridge — Team Cookbook

> DCS × Pega CDH × NexusCDP | v0.1.0

## Table of Contents

- [Section 8: Identity Resolution](#section-8-identity-resolution)
- [Section 9: NexusJS SDK Integration](#section-9-nexusjs-sdk-integration)
- [Section 10: Demo Scenarios](#section-10-demo-scenarios)
- [Section 11: Deployment](#section-11-deployment)
- [Section 12: Troubleshooting](#section-12-troubleshooting)
- [Quick Reference Card](#quick-reference-card)
- [Team Access](#team-access)

---

## Section 8: Identity Resolution

### How identity matching works

The CDH Bridge uses a 3-phase approach to resolve identities across channels:

1. **Deterministic** — email, phone, or CRM ID exact match → confidence `1.0`, profiles merged immediately
2. **Probabilistic** — name + DOB + postcode fuzzy match → confidence `0.75–0.94` → routed to review queue for human approval
3. **Anonymous stitching** — `cookieId` → `customerId` on login event, triggered by `NexusCDP.identify()`

### Confidence thresholds

| Score | Action | What happens |
|-------|--------|--------------|
| ≥ 0.95 | `AUTO_MERGE` | Profiles merged immediately, CDH gets unified profile |
| 0.75–0.94 | `REVIEW_QUEUED` | Added to review queue for human approval |
| < 0.75 | `CREATE_NEW` | New profile created, no merge attempted |

### Recipe 1: Trigger anonymous-to-known stitch

```bash
curl -X POST http://localhost:3002/v1/identity/stitch \
  -H "Content-Type: application/json" \
  -d '{
    "cookieId": "ck-abc123",
    "customerId": "CUST-001",
    "source": "login-event"
  }'
```

### Recipe 2: Register a device

```bash
curl -X POST http://localhost:3002/v1/identity/device/register \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "CUST-001",
    "deviceId": "iphone-abc123",
    "deviceType": "ios",
    "metadata": { "appVersion": "4.2.0" }
  }'
```

### Recipe 3: Get identity cluster (all linked identifiers)

```bash
curl http://localhost:3002/v1/identity/cluster/CUST-001
```

Response shows: golden record, all email/phone/device/cookie aliases, merged IDs.

### Recipe 4: Check review queue

```bash
curl http://localhost:3002/v1/identity/review/queue
```

### Recipe 5: Approve a pending merge

```bash
curl -X POST http://localhost:3002/v1/identity/review/{reviewId}/approve \
  -H "Content-Type: application/json" \
  -d '{ "resolvedBy": "alice@wearedcs.com" }'
```

### Recipe 6: Reject a pending merge

```bash
curl -X POST http://localhost:3002/v1/identity/review/{reviewId}/reject \
  -H "Content-Type: application/json" \
  -d '{ "resolvedBy": "alice@wearedcs.com" }'
```

### Recipe 7: Resolve any identifier to golden ID

```bash
# Works with email, phone, deviceId, cookieId, or customerId
curl http://localhost:3002/v1/identity/cluster/alice@bank.com
curl http://localhost:3002/v1/identity/cluster/ck-abc123
```

### Recipe 8: Get identity stats

```bash
curl http://localhost:3002/v1/identity/stats
```

---

## Section 9: NexusJS SDK Integration

### Web Installation

```html
<!-- 1. Load SDK -->
<script src="https://cdh-bridge-demos.vercel.app/sdk/nexus.js"></script>

<!-- 2. Initialise (use Railway URL when backend is deployed) -->
<script>
NexusCDP.init({
  apiKey: 'pk_your_key',
  collectorUrl: 'http://localhost:3001',  // or Railway URL
  profileUrl:   'http://localhost:3002',
  cdhUrl:       'http://localhost:3010',
  feedbackUrl:  'http://localhost:3003',
  consentUrl:   'http://localhost:3004',
  debug: true   // set false in production
});
</script>
```

### Mobile Installation

```html
<script src="https://cdh-bridge-demos.vercel.app/sdk/nexus-mobile.js"></script>
<script>
NexusCDP.init({ apiKey: 'pk_your_key', /* same options */ });
NexusCDP.trackAppOpen({ platform: 'mobile', appVersion: '4.2.0' });
</script>
```

### SDK Method Reference

| Method | Description | Example |
|--------|-------------|---------|
| `init(options)` | Initialise SDK | `NexusCDP.init({ apiKey: 'pk_...' })` |
| `identify(id, traits, cb)` | Identify customer + stitch anon | `NexusCDP.identify('CUST-001', {name:'Alice'})` |
| `track(type, props, channel, cb)` | Track an event | `NexusCDP.track('product_view', {product:'loan'})` |
| `getNBA(cb)` | Fetch NBA decisions | `NexusCDP.getNBA((err, decisions) => {})` |
| `feedback(id, action, outcome, ch, cb)` | Record NBA outcome | `NexusCDP.feedback('d-1', 'Loan', 'ACCEPTED', 'web')` |
| `optOut(channels, cb)` | Consent opt-out | `NexusCDP.optOut(['email', 'sms'])` |
| `on(event, handler)` | Listen to SDK events | `NexusCDP.on('stitch:complete', fn)` |
| `getState()` | Get current state | `NexusCDP.getState()` |
| `reset()` | Logout / clear identity | `NexusCDP.reset()` |
| `biometricLogin(id, traits, cb)` | Mobile biometric auth | `NexusCDP.biometricLogin('CUST-001', {...})` |
| `trackAppOpen(meta)` | Mobile app open | `NexusCDP.trackAppOpen({platform:'ios'})` |

### SDK Events Reference

| Event | When fired | Data |
|-------|------------|------|
| `init` | SDK initialised | `{cookieId, customerId}` |
| `identify` | Identity set | `{customerId, traits}` |
| `event:sent` | Event dispatched | `{payload}` |
| `event:accepted` | Event confirmed by backend | `{payload, response: {ihEventType, kafka: {offset}}}` |
| `event:error` | Event failed | `{payload, error}` |
| `stitch:complete` | Anon→known stitch done | `{cookieId, customerId}` |
| `nba:received` | NBA decisions fetched | `decisions[]` |
| `feedback:sent` | NBA feedback recorded | `{decisionId, outcome}` |
| `consent:optout` | Opt-out propagated | `{channels, response}` |
| `reset` | Identity cleared | `{}` |

### Complete integration example (bank homepage)

```html
<!DOCTYPE html>
<html>
<head>
  <script src="https://cdh-bridge-demos.vercel.app/sdk/nexus.js"></script>
  <script>
    // 1. Initialise on page load
    NexusCDP.init({ apiKey: 'pk_demo', debug: true });

    // 2. Listen to events for your own logging
    NexusCDP.on('event:accepted', function(d) {
      console.log('CDH IH type:', d.response.ihEventType);
    });

    NexusCDP.on('stitch:complete', function(d) {
      console.log('Identity stitched:', d.customerId);
      // Now get NBA for this customer
      NexusCDP.getNBA(showOffer);
    });
  </script>
</head>
<body>
  <button onclick="login()">Sign In</button>
  <div id="offer" style="display:none"></div>

  <script>
    function login() {
      // Triggers identity stitch (cookieId already set by SDK)
      NexusCDP.identify('CUST-001', { name: 'Alice Smith', tier: 'premium' });
    }

    function showOffer(err, decisions) {
      if (err || !decisions.length) return;
      var offer = decisions[0];
      document.getElementById('offer').innerHTML =
        '<h3>' + offer.action + '</h3><p>Propensity: ' + offer.propensity + '</p>' +
        '<button onclick="accept()">Accept</button>';
      document.getElementById('offer').style.display = 'block';
    }

    function accept() {
      NexusCDP.track('offer_accept', { offer: 'HomeLoan' });
      NexusCDP.feedback(currentDecisionId, 'HomeLoan', 'ACCEPTED', 'web');
    }
  </script>
</body>
</html>
```

---

## Section 10: Demo Scenarios

### Running scenarios locally

```bash
# Full 60-second automated demo
node scripts/demo.js

# Identity resolution demo
node scripts/demo-identity.js

# Seed fresh data before demoing
node scripts/seed-data.js
```

### 6 Demo Scenarios Explained

#### Scenario 1: Anonymous Browse

**What happens:**
1. Visitor arrives with no login — SDK creates `cookieId` in localStorage
2. `page_view` events fire with `cookieId` (no `customerId`)
3. CDH Bridge builds anonymous profile in Redis
4. Events published to Kafka as `anon:{cookieId}`
5. Profile available: `GET /v1/identity/anon/{cookieId}`

**How to run:**
- Web: https://cdh-bridge-demos.vercel.app/web → click "⚡ Scenarios" → Scenario 1
- Mobile: https://cdh-bridge-demos.vercel.app/mobile → tap ⚡ FAB → Scenario 1

#### Scenario 2: Login & Identity Stitch

**What happens:**
1. Customer logs in — `NexusCDP.identify('CUST-001', {...})` fires
2. Event-collector receives login event with BOTH `cookieId` AND `customerId`
3. `profile-router` `stitchToKnown()` merges anon profile into known profile
4. All pre-login events now attributed to CUST-001
5. CDH Bridge pushes enriched profile to Pega CDH immediately

#### Scenario 3: NBA Decision

**What happens:**
1. `NexusCDP.getNBA()` calls Mock CDH: `GET /nba/decisions/{customerId}`
2. Mock CDH returns 3 ranked decisions based on profile
3. Top offer displayed in app
4. Customer accepts → `NexusCDP.feedback()` records ACCEPTED outcome
5. Feedback Loop updates profile with decision context
6. CDH Adaptive Models get richer training signal

#### Scenario 4: Product Browse (Cross-Channel)

**What happens:**
1. Customer views mortgage product → `IH.ProductView` fires
2. Event enriches CDH Interaction History
3. Switch to mobile → same profile, accumulated browsing signals
4. Next NBA on any channel reflects mortgage interest

#### Scenario 5: Consent Opt-out

**What happens:**
1. `NexusCDP.optOut(['email'])` fires
2. Consent service receives request
3. Pega CDH profile suppressed via API in <500ms
4. Kafka `cdh-consent` topic fans out to all 12 connected systems
5. Immutable audit log created

#### Scenario 6: Full End-to-End (60 seconds)

Combines all 5 scenarios in sequence with real timing. Run with:

```bash
node scripts/demo.js
```

---

## Section 11: Deployment

### Deployment Options Comparison

| Platform | Setup Time | Cost | Best For |
|----------|-----------|------|---------|
| Local Docker | 5 min | Free | Development |
| Railway | 10 min | Free tier available | Quick demo/staging |
| Fly.io | 15 min | Free tier (lhr region) | Europe-based (near Latvia) |
| AWS ECS | 30 min | ~$50/mo | Enterprise/production |
| Kubernetes | 60 min | Varies | Large scale |

### One-command deploy reference

```bash
make dev            # Local Docker Compose
make deploy-vercel  # Dashboard + Demo sites
make deploy-railway # Backend to Railway
make deploy-fly     # Backend to Fly.io
make deploy-aws     # Backend to AWS ECS Fargate
make deploy-k8s     # Backend to Kubernetes
```

### Environment variables reference

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_URL` | `redis://redis:6379` | Redis connection string |
| `KAFKA_BROKERS` | `kafka:9092` | Kafka broker(s) |
| `PEGA_CDH_URL` | `http://mock-cdh:3010` | Pega CDH endpoint |
| `PEGA_CDH_AUTH_TOKEN` | `dev-token` | CDH auth token |
| `JWT_SECRET` | `dev-secret` | JWT signing secret |
| `NODE_ENV` | `development` | Environment |
| `LOG_LEVEL` | `info` | Log verbosity |
| `MOCK_DATA` | `true` | Use mock Salesforce data |

### Docker images (GHCR)

All images are built by GitHub Actions on every push to `main`:

```
ghcr.io/sunilmlodha/cdh-bridge-event-collector:latest
ghcr.io/sunilmlodha/cdh-bridge-profile-router:latest
ghcr.io/sunilmlodha/cdh-bridge-feedback-loop:latest
ghcr.io/sunilmlodha/cdh-bridge-consent-service:latest
ghcr.io/sunilmlodha/cdh-bridge-connector-service:latest
ghcr.io/sunilmlodha/cdh-bridge-mock-cdh:latest
ghcr.io/sunilmlodha/cdh-bridge-dashboard:latest
```

Pull latest: `make pull`

---

## Section 12: Troubleshooting

### Service won't start

```bash
# Check logs for specific service
docker compose logs event-collector --tail=50

# Check all service health
node scripts/health-check.js

# Restart a specific service
docker compose restart event-collector

# Full restart
make down && make dev
```

### "Kafka connection refused" errors

Services retry Kafka connections automatically. If Kafka is still starting, wait 30 seconds and the services will reconnect.

```bash
docker compose logs kafka --tail=20
```

### Profile not found after posting

The profile might be in the review queue (probabilistic match ≥0.75). Check:

```bash
curl http://localhost:3002/v1/identity/review/queue
```

### Event returning 400 VALIDATION_ERROR

Common causes:
- Missing both `customerId` AND `cookieId` (need at least one)
- `channel` value not in allowed list: `web`, `mobile`, `email`, `sms`, `call_center`, `chat`, `app`, `api`, `other`
- `eventType` empty or too long (max 100 chars)

### NBA decisions returning empty

Mock CDH returns decisions based on profile existing. First POST the customer profile:

```bash
curl -X POST http://localhost:3010/customerprofile \
  -H "Content-Type: application/json" \
  -d '{"customerId":"CUST-001","email":"test@test.com"}'
```

Then fetch decisions:

```bash
curl http://localhost:3010/nba/decisions/CUST-001
```

### Consent propagation timeout

The consent service requires Redis. Check Redis is healthy:

```bash
docker exec cdh-redis redis-cli ping
# Should return: PONG
```

### Dashboard shows all services as offline

The Next.js dashboard proxies API calls. If running locally without Docker, services won't be available. Use `docker compose up -d` first.

### Resetting all data for a fresh demo

```bash
# Stop everything and wipe volumes
make down-volumes

# Restart fresh
make dev

# Wait for healthy, then reseed
sleep 30 && node scripts/seed-data.js
```

---

## Quick Reference Card

### All endpoints at a glance

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `:3001/v1/events` | Ingest event |
| POST | `:3001/v1/events/batch` | Batch ingest |
| GET | `:3001/v1/events/schema` | IH schema reference |
| GET | `:3001/health` | Event collector health |
| POST | `:3002/v1/profiles` | Create/upsert profile |
| GET | `:3002/v1/profiles/:id` | Get profile |
| POST | `:3002/v1/profiles/:id/merge` | Merge data into profile |
| DELETE | `:3002/v1/profiles/:id` | Delete (GDPR) |
| GET | `:3002/v1/profiles/stats` | Profile statistics |
| POST | `:3002/v1/identity/stitch` | Stitch anon→known |
| GET | `:3002/v1/identity/cluster/:id` | Identity graph |
| GET | `:3002/v1/identity/review/queue` | Pending merges |
| POST | `:3002/v1/identity/review/:id/approve` | Approve merge |
| POST | `:3003/v1/feedback` | Record NBA outcome |
| GET | `:3003/v1/feedback/:customerId` | Decision history |
| GET | `:3003/v1/feedback/lift` | NBA lift stats |
| POST | `:3004/v1/consent/optout` | Marketing opt-out |
| POST | `:3004/v1/consent/gdpr-erasure` | GDPR erasure |
| GET | `:3004/v1/consent/:id` | Consent status |
| GET | `:3004/v1/consent/requests` | Pending requests |
| GET | `:3005/v1/connectors` | List connectors |
| POST | `:3005/v1/connectors` | Add connector |
| POST | `:3005/v1/connectors/:id/test` | Test connection |
| GET | `:3010/nba/decisions/:id` | Get NBA decisions |
| POST | `:3010/customerprofile` | Push profile to CDH |
| GET | `:3010/health` | Mock CDH health |

---

## Team Access

| Resource | URL / Details |
|----------|--------------|
| GitHub repo | https://github.com/sunilmlodha/cdh-bridge |
| Dashboard (live) | https://cdh-bridge-dashboard.vercel.app |
| Demo Suite | https://cdh-bridge-demos.vercel.app |
| Citadele Demo | https://cdh-bridge-demos.vercel.app/citadele |
| DemoBank Web | https://cdh-bridge-demos.vercel.app/web |
| DemoBank Mobile | https://cdh-bridge-demos.vercel.app/mobile |
| Cookbook | https://cdh-bridge-demos.vercel.app/cookbook |

Team member access: @NanjundanChinnasamy has been granted Write access to the GitHub repo.

---

*CDH Bridge v0.1.0 | DCS Implementation | Built with care for Pega CDH*
