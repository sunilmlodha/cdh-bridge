#!/bin/bash
# Deploy all CDH Bridge services to Fly.io
# Prerequisites: flyctl auth login && flyctl wireguard create
set -e

ORG="${FLY_ORG:-personal}"
REGION="${FLY_REGION:-lhr}"   # London — nearest to Latvia/Europe
PREFIX="cdh-bridge"

echo "🚀 Deploying CDH Bridge to Fly.io (org: $ORG, region: $REGION)"
echo ""

# ── Infrastructure ────────────────────────────────────────────────────────────

echo "📦 Creating managed Redis (Upstash)..."
fly redis create \
  --name "${PREFIX}-redis" \
  --org "$ORG" \
  --region "$REGION" \
  --plan free-6mb \
  --no-prompt || echo "Redis already exists"

REDIS_URL=$(fly redis status ${PREFIX}-redis --json 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('privateUrl',''))" 2>/dev/null || echo "")
echo "Redis URL: $REDIS_URL"

# ── Services ──────────────────────────────────────────────────────────────────

SERVICES=(
  "mock-cdh:3010:services/mock-cdh"
  "event-collector:3001:services/event-collector"
  "profile-router:3002:services/profile-router"
  "feedback-loop:3003:services/feedback-loop"
  "consent-service:3004:services/consent-service"
  "connector-service:3005:services/connector-service"
)

DEPLOYED_URLS=()

for entry in "${SERVICES[@]}"; do
  IFS=':' read -r name port context <<< "$entry"
  app_name="${PREFIX}-${name}"

  echo ""
  echo "🐳 Deploying $app_name..."

  # Create app if it doesn't exist
  fly apps create "$app_name" --org "$ORG" 2>/dev/null || echo "App $app_name already exists"

  # Set secrets
  fly secrets set \
    --app "$app_name" \
    REDIS_URL="$REDIS_URL" \
    KAFKA_BROKERS="${KAFKA_BROKERS:-}" \
    PEGA_CDH_URL="https://${PREFIX}-mock-cdh.fly.dev" \
    PEGA_CDH_AUTH_TOKEN="${PEGA_CDH_AUTH_TOKEN:-demo-token}" \
    JWT_SECRET="${JWT_SECRET:-demo-secret}" \
    NODE_ENV="production" \
    PORT="$port" \
    MOCK_DATA="true" \
    2>/dev/null || true

  # Deploy from Dockerfile
  fly deploy \
    --app "$app_name" \
    --dockerfile "../../${context}/Dockerfile" \
    --build-arg SERVICE_PORT="$port" \
    --region "$REGION" \
    --image "ghcr.io/sunilmlodha/cdh-bridge-${name}:latest" \
    --ha=false \
    --wait-timeout 300 \
    || { echo "❌ Failed to deploy $name"; continue; }

  URL="https://${app_name}.fly.dev"
  DEPLOYED_URLS+=("$name → $URL")
  echo "✅ $name deployed: $URL"
done

echo ""
echo "════════════════════════════════════════"
echo "  CDH Bridge Fly.io Deployment Complete "
echo "════════════════════════════════════════"
for url in "${DEPLOYED_URLS[@]}"; do
  echo "  ✅ $url"
done
echo ""
echo "Verify all services:"
echo "  bash verify.sh"
