# CDH Bridge

A microservices platform that bridges real-time customer data and Next-Best-Action (NBA) decisions between Pega Customer Decision Hub (CDH) and your front-end channels.

---

## Features

1. **Event Collector** — Ingests real-time behavioral events (page views, clicks, form submits) and forwards them to Pega CDH.
2. **Profile Router** — Unifies customer identity across Salesforce, Snowflake, and other sources into a single CDH profile.
3. **Feedback Loop** — Captures NBA decision outcomes (accepted, rejected, ignored) and sends them back to CDH to improve model accuracy.
4. **Consent Service** — Manages customer consent preferences and propagates opt-in/opt-out signals to CDH within milliseconds.
5. **Connector Service** — Generic adapter layer for ingesting customer data from external systems (CRM, data warehouse, custom APIs).

---

## Architecture

```
                         +------------------+
   Browser / App  ──────>| event-collector  |:3001
                         +--------+---------+
                                  |
                    +-------------+-------------+
                    |                           |
         +----------v---------+   +-------------v------+
         | profile-router     |   | feedback-loop      |
         | :3002              |   | :3003              |
         +----------+---------+   +-------------+------+
                    |                           |
         +----------v---------+   +-------------v------+
         | connector-service  |   | consent-service    |
         | :3005              |   | :3004              |
         +----------+---------+   +--------------------+
                    |
         +----------v---------+
         |    mock-cdh        |  (Pega CDH REST API)
         |    :3010           |
         +--------------------+

   Supporting infrastructure:
     Kafka  :9092   (event streaming)
     Redis  :6379   (caching / pub-sub)

   Dashboard (dev only)  :3000
```

---

## Quick Start

```bash
git clone https://github.com/your-org/cdh-bridge.git
cd cdh-bridge
cp .env.example .env          # edit values as needed
docker-compose up --build
```

Seed demo data once all services are healthy:

```bash
node scripts/seed-data.js
```

Run the 30-second customer journey demo:

```bash
node scripts/demo.js
```

Check service health:

```bash
node scripts/health-check.js
```

---

## Service Port Map

| Port | Service            | Description                                  |
|------|--------------------|----------------------------------------------|
| 3000 | dashboard          | Developer dashboard (optional UI)            |
| 3001 | event-collector    | Receives behavioral events from clients      |
| 3002 | profile-router     | Unifies customer profiles across sources     |
| 3003 | feedback-loop      | Records NBA decision outcomes                |
| 3004 | consent-service    | Manages consent preferences                  |
| 3005 | connector-service  | Ingests data from external CRM/DW systems    |
| 3010 | mock-cdh           | Mock Pega CDH REST API for local development |

---

## API Reference

### event-collector (:3001)

| Method | Path             | Description                          |
|--------|------------------|--------------------------------------|
| POST   | /events          | Ingest a single behavioral event     |
| POST   | /events/batch    | Ingest a batch of events             |
| GET    | /events/:id      | Retrieve a stored event by ID        |
| GET    | /health          | Health check                         |

**POST /events body:**
```json
{
  "customerId": "cust-123",
  "eventType": "page_view",
  "channel": "web",
  "properties": { "url": "/home" }
}
```

---

### profile-router (:3002)

| Method | Path                        | Description                                  |
|--------|-----------------------------|----------------------------------------------|
| GET    | /profiles/:customerId       | Retrieve unified customer profile            |
| POST   | /profiles/merge             | Merge two customer identity records          |
| PUT    | /profiles/:customerId       | Update profile attributes                    |
| DELETE | /profiles/:customerId       | Delete a customer profile                    |
| GET    | /health                     | Health check                                 |

**POST /profiles/merge body:**
```json
{
  "primaryId": "cust-123",
  "secondaryId": "sf-456",
  "source": "salesforce"
}
```

---

### feedback-loop (:3003)

| Method | Path               | Description                                      |
|--------|--------------------|--------------------------------------------------|
| POST   | /feedback          | Record an NBA decision outcome                   |
| GET    | /feedback/:nbaId   | Retrieve feedback for an NBA decision            |
| GET    | /feedback/summary  | Aggregated outcome statistics                    |
| GET    | /health            | Health check                                     |

**POST /feedback body:**
```json
{
  "customerId": "cust-123",
  "nbaId": "nba-offer-789",
  "outcome": "ACCEPTED",
  "channel": "web",
  "timestamp": "2026-06-04T12:00:00Z"
}
```

---

### consent-service (:3004)

| Method | Path                            | Description                               |
|--------|---------------------------------|-------------------------------------------|
| GET    | /consent/:customerId            | Get current consent preferences           |
| POST   | /consent                        | Create a new consent record               |
| PUT    | /consent/:customerId            | Update consent preferences                |
| DELETE | /consent/:customerId/:channel   | Opt out of a specific channel             |
| GET    | /health                         | Health check                              |

**POST /consent body:**
```json
{
  "customerId": "cust-123",
  "email": true,
  "sms": false,
  "push": true,
  "source": "preference-center"
}
```

---

### connector-service (:3005)

| Method | Path                          | Description                                     |
|--------|-------------------------------|-------------------------------------------------|
| POST   | /connectors/salesforce/sync   | Trigger Salesforce customer sync                |
| POST   | /connectors/snowflake/sync    | Trigger Snowflake segment sync                  |
| POST   | /connectors/custom            | Push data from a custom source                  |
| GET    | /connectors/status            | List connector sync statuses                    |
| GET    | /health                       | Health check                                    |

**POST /connectors/custom body:**
```json
{
  "source": "my-crm",
  "customerId": "cust-123",
  "data": { "segment": "high-value", "ltv": 4500 }
}
```

---

### mock-cdh (:3010)

| Method | Path                          | Description                                     |
|--------|-------------------------------|-------------------------------------------------|
| POST   | /cdh/events                   | Accept events from event-collector              |
| GET    | /cdh/profiles/:customerId     | Return mock profile data                        |
| POST   | /cdh/nba                      | Return mock NBA decisions                       |
| POST   | /cdh/feedback                 | Accept feedback outcomes                        |
| POST   | /cdh/consent                  | Accept consent updates                          |
| GET    | /health                       | Health check                                    |

---

## Development Guide

### Prerequisites

- Node.js >= 18
- Docker & Docker Compose
- (Optional) Kafka and Redis running locally if not using Docker Compose

### Running services individually

```bash
cd services/event-collector
npm install
npm start
```

Each service reads config from environment variables. Copy `.env` to the project root and services will inherit values via Docker Compose or your shell.

### Environment variables

| Variable              | Default                        | Description                          |
|-----------------------|--------------------------------|--------------------------------------|
| PEGA_CDH_URL          | http://localhost:3010          | CDH REST API base URL                |
| PEGA_CDH_AUTH_TOKEN   | dev-token-replace-in-prod      | Bearer token for CDH authentication  |
| KAFKA_BROKERS         | localhost:9092                 | Comma-separated Kafka broker list    |
| REDIS_URL             | redis://localhost:6379         | Redis connection URL                 |
| JWT_SECRET            | dev-secret-replace-in-prod     | JWT signing secret                   |
| NODE_ENV              | development                    | Node environment                     |
| LOG_LEVEL             | info                           | Logging level (debug/info/warn/error)|
| MOCK_DATA             | true                           | Use mock data instead of real CDH    |
| CORS_ORIGINS          | http://localhost:3000          | Allowed CORS origins                 |

### Logs

All services log structured JSON to stdout. Use `docker-compose logs -f <service>` to tail logs.

### Tests

```bash
npm test          # unit tests
npm run test:e2e  # end-to-end tests (requires all services running)
```

### Adding a new connector

1. Create a handler in `services/connector-service/src/connectors/`.
2. Register it in `connector-service/src/routes.js`.
3. Add the sync endpoint to `docker-compose.yml` env section if new env vars are needed.
4. Document the endpoint in this README.

---

## License

MIT
