# CDH Bridge Demo Suite

A self-contained demo environment for showing how **NexusCDP / CDH Bridge** enriches Pega CDH Next-Best-Action accuracy in real time — no backend changes required by the host application.

---

## Prerequisites

| Requirement | Notes |
|---|---|
| Docker Desktop | Running and healthy |
| CDH Bridge repo | Cloned locally |
| Ports available | 3000–3005, 3010 |
| Modern browser | Chrome / Edge / Firefox (CORS must allow localhost) |

---

## Quick Start

### 1. Start all services

```bash
cd cdh-bridge
docker compose up -d
```

Wait ~15 seconds for all containers to become healthy. To follow logs:

```bash
docker compose logs -f
```

### 2. Open the demo launcher

```bash
open demo/index.html
```

Or double-click `demo/index.html` in Finder.

### 3. Verify all 7 services are green

In the **CDH Bridge — Live System Status** section every service indicator should be a solid green dot. If any are red, see the Troubleshooting section below.

| Service | Port | Health endpoint |
|---|---|---|
| Mock Pega CDH | 3010 | `GET /health` |
| Event Collector | 3001 | `GET /health` |
| Profile Router | 3002 | `GET /health` |
| Feedback Loop | 3003 | `GET /health` |
| Consent Service | 3004 | `GET /health` |
| Connector Service | 3005 | `GET /health` |
| Dashboard | 3000 | `GET /` |

### 4. Launch a demo app

Click **Launch Web Demo** for the desktop banking experience or **Launch Mobile Demo** for the iOS-style PWA.

### 5. Run a scenario

Click **▶ Run in Web** or **▶ Run in Mobile** under any scenario card. The app opens with that scenario pre-selected.

---

## Demo Scenarios

### Scenario 1 — Anonymous Browse

**What happens:** The visitor lands on DemoBank without logging in. NexusJS captures `page_view` and `product_view` events tagged with an anonymous `cookieId`. CDH Bridge builds a lightweight anonymous profile in Redis and forwards all events to Pega CDH Interaction History.

**What to watch:**
- Event log panel in the demo app populates with raw events
- Profile Router stats (`http://localhost:3002/v1/profiles/stats`) shows `anonymousProfiles` incrementing
- Mock Pega CDH health (`http://localhost:3010/health`) shows `profileCount` rising

---

### Scenario 2 — Login & Identity Stitch

**What happens:** The customer logs in. NexusJS fires a `login` event carrying both `cookieId` and `customerId`. CDH Bridge stitches every pre-login event to the authenticated profile in under 100 ms. Pega CDH now has full pre-login context for its next NBA cycle.

**What to watch:**
- Event log shows a `identify` event with both IDs
- Profile Router merges the anonymous profile; `anonymousProfiles` decreases, `knownProfiles` increases
- Dashboard timeline shows the stitch event

---

### Scenario 3 — NBA Decision

**What happens:** The banking dashboard loads and NexusJS calls `getNBA()`. Mock Pega CDH evaluates the profile and returns three ranked personalised offers (e.g., Home Loan upgrade, Credit Card limit increase, Term Deposit). When the customer clicks **Accept**, a feedback event flows back to CDH to update Adaptive Model weights.

**What to watch:**
- Offer cards render in the demo UI populated from the CDH response
- Dashboard shows the `nba_request` and `nba_response` events
- Accepting an offer triggers a `feedback` event visible in the event log

---

### Scenario 4 — Product Browse

**What happens:** The customer navigates to the Home Loan product page. NexusJS emits a `product_view` event that CDH Bridge maps to `IH.ProductView` in Pega CDH Interaction History. The profile accumulates cross-channel intent signals.

**What to watch:**
- `IH.ProductView` entry appears in the CDH dashboard's Interaction History tab
- Next NBA call (refresh the offers panel) reflects the accumulated Home Loan interest signal
- Profile Router shows `productViews` count incrementing

---

### Scenario 5 — Consent Opt-out

**What happens:** The customer opens Privacy Settings and toggles off marketing consent. NexusJS calls `NexusCDP.optOut()`. CDH Bridge propagates the preference to Pega CDH in under 500 ms, suppresses the profile from outbound decisioning, and fans out the consent event to all 12 connected downstream systems.

**What to watch:**
- Consent Service health (`http://localhost:3004/health`) shows `suppressedProfiles` incrementing
- Dashboard shows the `consent_update` event with `marketing: false`
- Subsequent `getNBA()` calls return an empty offer set (profile suppressed)

---

### Scenario 6 — Full End-to-End Journey

**What happens:** A fully automated 60-second walkthrough of all five scenarios above in sequence: anonymous browse → login stitch → NBA decision → product view → offer acceptance → feedback loop → CDH profile enrichment. Each step waits for the previous service response before continuing.

**What to watch:**
- All 7 status dots should remain green throughout
- Dashboard event timeline shows all event types appearing in order
- Profile Router stats show the full lifecycle: anonymous → known → enriched → decided

---

## What to Watch Alongside the Demo

### CDH Bridge Dashboard
```
http://localhost:3000
```
Real-time event stream, service health, profile stats, and NBA decision log.

### Profile Router Stats
```
http://localhost:3002/v1/profiles/stats
```
JSON snapshot of anonymous/known profile counts, stitch operations, and Redis memory usage.

### Event Log Panel
Each demo app has a collapsible event log at the bottom of the screen. It shows every NexusCDP call in real time, including the CDH API response payload.

---

## SDK Quick Embed

Once you are ready to instrument a real site:

```html
<!-- Load NexusCDP SDK -->
<script src="https://cdn.nexuscdp.io/v1/nexus.js"></script>

// Initialise
NexusCDP.init({ apiKey: 'pk_YOUR_KEY' });

// Track events — auto-maps to Pega CDH IH schema
NexusCDP.track('product_view', { product: 'home-loan' });
NexusCDP.identify('CUST-001', { name: 'Alice Smith' });
```

---

## Troubleshooting

### One or more status dots are red

1. Check Docker is running: `docker ps`
2. Check the specific container: `docker compose ps`
3. Check container logs: `docker compose logs <service-name>`
4. Restart a single service: `docker compose restart <service-name>`

### CORS errors in browser console

The demo apps use `fetch()` with `mode: 'cors'`. Make sure you are opening the HTML files directly from the filesystem (not through a proxy that strips CORS headers). If you serve them via a local web server, ensure it does not override the `Access-Control-Allow-Origin` headers set by the CDH Bridge services.

### Status shows "timeout" but the container is running

The browser fetch has a 3-second timeout. On slow machines the first poll may time out while services are still warming up. Wait 15–20 seconds and refresh — the dots will turn green once services are ready.

### Scenario buttons open a blank page

The web and mobile demo apps (`demo/web/index.html` and `demo/mobile/index.html`) are separate files included in the `demo/` directory. If they are missing, check that you pulled the full repository including submodules:

```bash
git submodule update --init --recursive
```

### Port conflict

If a port is already in use, edit `docker-compose.yml` to remap the host port, then update the service URL in `demo/index.html` to match.

---

## Stopping the Demo

```bash
cd cdh-bridge
docker compose down
```

To also remove persisted Redis/Kafka data:

```bash
docker compose down -v
```

---

*CDH Bridge v0.1.0 — Built for Pega CDH integration*
