#!/bin/bash
# Deploy CDH Bridge to AWS ECS (Fargate)
# Prerequisites: aws cli configured, jq installed
set -e

AWS_REGION="${AWS_REGION:-eu-west-1}"
CLUSTER="${ECS_CLUSTER:-cdh-bridge}"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
PREFIX="cdh-bridge"

echo "🚀 Deploying CDH Bridge to AWS ECS"
echo "   Account: $ACCOUNT_ID | Region: $AWS_REGION | Cluster: $CLUSTER"

# ── Create Log Group ──────────────────────────────────────────────────────────
aws logs create-log-group \
  --log-group-name /ecs/cdh-bridge \
  --region "$AWS_REGION" 2>/dev/null || true

# ── Store secrets in SSM Parameter Store ─────────────────────────────────────
echo "🔐 Storing secrets in SSM..."
for param in REDIS_URL KAFKA_BROKERS PEGA_CDH_AUTH_TOKEN JWT_SECRET; do
  val="${!param}"
  if [ -z "$val" ]; then
    echo "⚠️  $param not set — skipping"
    continue
  fi
  aws ssm put-parameter \
    --name "/cdh-bridge/$param" \
    --value "$val" \
    --type SecureString \
    --overwrite \
    --region "$AWS_REGION" || true
done

# ── Register task definitions ─────────────────────────────────────────────────
SERVICES=(mock-cdh event-collector profile-router feedback-loop consent-service connector-service)

for svc in "${SERVICES[@]}"; do
  echo "📋 Registering task definition: $svc"
  # Replace ACCOUNT_ID placeholder in the task definition
  sed "s/ACCOUNT_ID/$ACCOUNT_ID/g; s/eu-west-1/$AWS_REGION/g" \
    ecs-task-definitions.json | \
    python3 -c "
import sys, json
data = json.load(sys.stdin)
svc = '${svc}'.replace('-', '_')
# Find matching task def
for td in data.get('services', []):
    if '${svc}' in td.get('family', ''):
        print(json.dumps(td))
        break
" > /tmp/td-${svc}.json

  if [ -s /tmp/td-${svc}.json ]; then
    aws ecs register-task-definition \
      --cli-input-json file:///tmp/td-${svc}.json \
      --region "$AWS_REGION" \
      --query 'taskDefinition.taskDefinitionArn' \
      --output text
  fi
done

# ── Create/update ECS Services ────────────────────────────────────────────────
SUBNET_IDS="${ECS_SUBNET_IDS:-}"    # comma-separated subnet IDs
SECURITY_GROUPS="${ECS_SG_IDS:-}"   # comma-separated security group IDs

if [ -z "$SUBNET_IDS" ]; then
  echo "⚠️  ECS_SUBNET_IDS not set. Services not created — register manually in console."
  exit 0
fi

PORT_MAP=(
  "mock-cdh:3010"
  "event-collector:3001"
  "profile-router:3002"
  "feedback-loop:3003"
  "consent-service:3004"
  "connector-service:3005"
)

for entry in "${PORT_MAP[@]}"; do
  svc="${entry%:*}"
  port="${entry#*:}"
  app_name="${PREFIX}-${svc}"

  echo "🚢 Deploying ECS service: $app_name"

  # Get latest task def revision
  TASK_DEF_ARN=$(aws ecs describe-task-definition \
    --task-definition "${PREFIX}-${svc}" \
    --query 'taskDefinition.taskDefinitionArn' \
    --output text \
    --region "$AWS_REGION" 2>/dev/null || echo "")

  if [ -z "$TASK_DEF_ARN" ]; then
    echo "⚠️  Task definition not found for $svc — skipping"
    continue
  fi

  # Create or update service
  aws ecs describe-services \
    --cluster "$CLUSTER" \
    --services "$app_name" \
    --region "$AWS_REGION" \
    --query 'services[0].status' \
    --output text 2>/dev/null | grep -q ACTIVE && {
      # Update existing
      aws ecs update-service \
        --cluster "$CLUSTER" \
        --service "$app_name" \
        --task-definition "$TASK_DEF_ARN" \
        --region "$AWS_REGION" \
        --query 'service.serviceArn' \
        --output text
  } || {
      # Create new
      aws ecs create-service \
        --cluster "$CLUSTER" \
        --service-name "$app_name" \
        --task-definition "$TASK_DEF_ARN" \
        --desired-count 1 \
        --launch-type FARGATE \
        --network-configuration "awsvpcConfiguration={subnets=[$SUBNET_IDS],securityGroups=[$SECURITY_GROUPS],assignPublicIp=ENABLED}" \
        --region "$AWS_REGION" \
        --query 'service.serviceArn' \
        --output text
  }
  echo "✅ $app_name deployed"
done

echo ""
echo "════════════════════════════════════════"
echo "  CDH Bridge AWS ECS Deployment Done   "
echo "════════════════════════════════════════"
echo "Check: https://console.aws.amazon.com/ecs/home?region=$AWS_REGION#/clusters/$CLUSTER"
