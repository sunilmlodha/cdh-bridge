# CDH Bridge — Makefile
# Usage: make <target>

REGISTRY   := ghcr.io/sunilmlodha
PREFIX     := cdh-bridge
SERVICES   := event-collector profile-router feedback-loop consent-service connector-service mock-cdh
ALL_IMAGES := $(SERVICES) dashboard
SHA        := $(shell git rev-parse --short HEAD 2>/dev/null || echo "dev")

.DEFAULT_GOAL := help

# ── Local development ─────────────────────────────────────────────────────────

.PHONY: dev
dev: ## Start full stack locally (Docker Compose)
	docker compose up

.PHONY: dev-build
dev-build: ## Build and start locally
	docker compose up --build

.PHONY: down
down: ## Stop all containers
	docker compose down

.PHONY: down-volumes
down-volumes: ## Stop and remove volumes (clean slate)
	docker compose down -v

.PHONY: logs
logs: ## Tail all service logs
	docker compose logs -f

.PHONY: seed
seed: ## Seed demo data into running services
	node scripts/seed-data.js

.PHONY: demo
demo: ## Run 30-second live demo
	node scripts/demo.js

.PHONY: health
health: ## Check health of all local services
	node scripts/health-check.js

.PHONY: test
test: ## Run all tests (unit + integration)
	cd services/profile-router && npx jest src/identity/__tests__/ --no-coverage
	node scripts/test-identity.js

# ── Docker image builds ───────────────────────────────────────────────────────

.PHONY: build
build: ## Build all Docker images locally
	@for svc in $(ALL_IMAGES); do \
	  echo "🐳 Building $$svc..."; \
	  if [ "$$svc" = "dashboard" ]; then \
	    docker build -t $(REGISTRY)/$(PREFIX)-$$svc:latest \
	                 -t $(REGISTRY)/$(PREFIX)-$$svc:$(SHA) \
	                 ./dashboard; \
	  else \
	    docker build -t $(REGISTRY)/$(PREFIX)-$$svc:latest \
	                 -t $(REGISTRY)/$(PREFIX)-$$svc:$(SHA) \
	                 ./services/$$svc; \
	  fi; \
	  echo "✅ $$svc built"; \
	done

.PHONY: build-%
build-%: ## Build a single image: make build-event-collector
	@svc=$*; \
	if [ "$$svc" = "dashboard" ]; then ctx=./dashboard; else ctx=./services/$$svc; fi; \
	docker build -t $(REGISTRY)/$(PREFIX)-$$svc:latest \
	             -t $(REGISTRY)/$(PREFIX)-$$svc:$(SHA) \
	             $$ctx && echo "✅ $$svc built"

# ── Push to GitHub Container Registry ────────────────────────────────────────

.PHONY: push
push: ## Push all images to GHCR (requires: docker login ghcr.io)
	@for svc in $(ALL_IMAGES); do \
	  echo "📤 Pushing $$svc..."; \
	  docker push $(REGISTRY)/$(PREFIX)-$$svc:latest; \
	  docker push $(REGISTRY)/$(PREFIX)-$$svc:$(SHA); \
	  echo "✅ $$svc pushed"; \
	done

.PHONY: push-%
push-%: ## Push a single image: make push-event-collector
	docker push $(REGISTRY)/$(PREFIX)-$*:latest
	docker push $(REGISTRY)/$(PREFIX)-$*:$(SHA)
	echo "✅ $* pushed"

.PHONY: build-push
build-push: build push ## Build and push all images

.PHONY: login-ghcr
login-ghcr: ## Login to GitHub Container Registry
	@echo "Enter GitHub PAT with write:packages scope:"
	@read -s PAT && echo "$$PAT" | docker login ghcr.io -u sunilmlodha --password-stdin

# ── Pull pre-built images ─────────────────────────────────────────────────────

.PHONY: pull
pull: ## Pull latest images from GHCR
	@for svc in $(ALL_IMAGES); do \
	  echo "📥 Pulling $$svc..."; \
	  docker pull $(REGISTRY)/$(PREFIX)-$$svc:latest || true; \
	done

# ── Vercel deployment ─────────────────────────────────────────────────────────

.PHONY: deploy-demos
deploy-demos: ## Deploy demo sites to Vercel
	cd demo && vercel deploy --prod --yes --scope dcs2

.PHONY: deploy-dashboard
deploy-dashboard: ## Deploy Next.js dashboard to Vercel
	cd dashboard && vercel deploy --prod --yes --scope dcs2

.PHONY: deploy-vercel
deploy-vercel: deploy-demos deploy-dashboard ## Deploy all Vercel projects

# ── Railway deployment ────────────────────────────────────────────────────────

.PHONY: deploy-railway
deploy-railway: ## Deploy backend services to Railway
	cd deploy/railway && railway up

.PHONY: railway-logs
railway-logs: ## Stream Railway logs
	railway logs --tail

# ── Fly.io deployment ─────────────────────────────────────────────────────────

.PHONY: deploy-fly
deploy-fly: ## Deploy all services to Fly.io
	chmod +x deploy/fly/deploy-all.sh
	cd deploy/fly && bash deploy-all.sh

.PHONY: deploy-fly-%
deploy-fly-%: ## Deploy single service to Fly.io: make deploy-fly-event-collector
	fly deploy \
	  --app cdh-bridge-$* \
	  --config deploy/fly/fly.$*.toml \
	  --image $(REGISTRY)/$(PREFIX)-$*:latest

# ── AWS ECS deployment ────────────────────────────────────────────────────────

.PHONY: deploy-aws
deploy-aws: ## Deploy to AWS ECS Fargate
	chmod +x deploy/aws/deploy.sh
	cd deploy/aws && bash deploy.sh

.PHONY: aws-status
aws-status: ## Check AWS ECS service status
	aws ecs list-services --cluster cdh-bridge --query 'serviceArns' --output table

# ── Kubernetes deployment ─────────────────────────────────────────────────────

.PHONY: deploy-k8s
deploy-k8s: ## Deploy to Kubernetes (requires kubectl configured)
	kubectl apply -f deploy/k8s/

.PHONY: k8s-status
k8s-status: ## Check Kubernetes pod status
	kubectl get pods -n cdh-bridge

# ── Utility ───────────────────────────────────────────────────────────────────

.PHONY: ps
ps: ## Show running containers
	docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

.PHONY: images
images: ## List CDH Bridge images
	docker images | grep $(PREFIX)

.PHONY: prune
prune: ## Remove stopped containers and dangling images
	docker system prune -f

.PHONY: help
help: ## Show this help
	@grep -E '^[a-zA-Z_%-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
	  awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-25s\033[0m %s\n", $$1, $$2}'
