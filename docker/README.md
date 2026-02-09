# RLD Docker Deployment

Complete containerized infrastructure for the RLD Protocol: simulation stack, rates indexer, Telegram bot, and production frontend.

## Architecture

```
                  ┌──────────────────────────────────────────────────┐
                  │                 HOST (OVHCloud)                  │
                  │                                                  │
  Internet ──────►│  Nginx (443/SSL) ──► /api/ ──► rates-indexer    │
                  │       │                        (port 8081)       │
                  │       └──► /* ──► frontend/dist                  │
                  │                                                  │
                  │  ┌─── docker_default network ───────────────┐    │
                  │  │                                          │    │
                  │  │  rates-indexer ◄── monitor-bot           │    │
                  │  │       ▲              │                   │    │
                  │  │       │              ├──► Telegram API   │    │
                  │  │  indexer ◄── mm-daemon                   │    │
                  │  │       ▲       chaos-trader               │    │
                  │  │       │                                  │    │
                  │  │  deployer (one-shot)                     │    │
                  │  └──────────────────────────────────────────┘    │
                  │                                                  │
                  │  Anvil (port 8545) ◄── all containers            │
                  └──────────────────────────────────────────────────┘
```

## Quick Start

### 1. Start persistent services (run once)

```bash
# Aave V3 Rates Indexer (port 8081) — survives simulation restarts
docker compose -f docker/docker-compose.rates.yml up -d

# Telegram Monitor Bot (port 8082)
docker compose -f docker/docker-compose.bot.yml up -d
```

### 2. Simulation cycle

```bash
# Restart Anvil, deploy contracts, launch simulation stack
./restart.sh

# Or manually:
anvil --fork-url $ETH_RPC_URL --fork-block-number 21698573 --block-time 1
docker compose -f docker/docker-compose.yml up --build
```

### 3. Frontend (containerized)

```bash
# One-command deploy (recommended)
docker compose -f docker/docker-compose.frontend.yml up -d --build

# Or manual build
docker build \
  --build-arg VITE_API_BASE_URL=https://rld.fi/api \
  --build-arg VITE_MAINNET_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY \
  -f frontend/Dockerfile -t rld-frontend .

docker run -p 3000:80 rld-frontend
```

---

## Services

### Compose Files

| File                          | Services                                   | Lifecycle      |
| ----------------------------- | ------------------------------------------ | -------------- |
| `docker-compose.yml`          | deployer, indexer, mm-daemon, chaos-trader | Per simulation |
| `docker-compose.rates.yml`    | rates-indexer                              | Persistent     |
| `docker-compose.bot.yml`      | monitor-bot                                | Persistent     |
| `docker-compose.frontend.yml` | frontend                                   | Persistent     |

### Container Details

| Container       | Image                        | Port | Health              | Description                                                                        |
| --------------- | ---------------------------- | ---- | ------------------- | ---------------------------------------------------------------------------------- |
| `deployer`      | `docker/deployer/Dockerfile` | —    | Exits on completion | Deploys protocol, market, oracle, users, router → writes `/config/deployment.json` |
| `indexer`       | `backend/Dockerfile.indexer` | 8080 | `python3 urllib`    | Indexes simulation blocks + serves API. **Auto-resets DB on simulation restart**   |
| `mm-daemon`     | `docker/daemons/Dockerfile`  | —    | —                   | Market maker: arb trades + oracle updates from live rates                          |
| `chaos-trader`  | `docker/daemons/Dockerfile`  | —    | —                   | Random trades for market activity                                                  |
| `rates-indexer` | `backend/Dockerfile.rates`   | 8081 | curl                | Scrapes live Aave V3 rates from mainnet                                            |
| `monitor-bot`   | `backend/Dockerfile.bot`     | 8082 | curl                | Telegram bot: `/status` reports, hourly digests                                    |
| `rld-frontend`  | `frontend/Dockerfile`        | 80   | wget                | Multi-stage build: Node 20 → Nginx Alpine (68MB)                                   |

---

## Networking

All compose-managed containers share the `docker_default` network. Services communicate by **Docker service name**, not `host.docker.internal`:

| From           | To              | URL                                |
| -------------- | --------------- | ---------------------------------- |
| `monitor-bot`  | `rates-indexer` | `http://rates-indexer:8080`        |
| `monitor-bot`  | `indexer`       | `http://indexer:8080`              |
| `mm-daemon`    | `rates-indexer` | `http://rates-indexer:8080`        |
| All containers | Anvil           | `http://host.docker.internal:8545` |

> **Note:** External ports (8080, 8081, 8082) are exposed via Docker but **blocked by UFW** to the internet. Only SSH (22), HTTP (80), and HTTPS (443) are open externally.

---

## Indexer Auto-Reset

The simulation indexer (`entrypoint.py`) automatically detects stale data on startup:

```
[3/4] Checking for stale data (simulation restart)...
⚠️  STALE DB DETECTED: indexed block 21,800,739 > chain head 21,702,736 (lag: 98,003)
🔄 Simulation was restarted — wiping DB and re-indexing from scratch
✅ DB reset complete. Will index from chain head.
```

**Logic:** If `last_indexed_block > chain_head + 1`, the Anvil fork was restarted. The indexer wipes its SQLite DB and re-indexes from the current chain head.

---

## Production Deployment (rld.fi)

The frontend is served from `/home/ubuntu/RLD/frontend/dist` by Nginx with SSL.

### Nginx Config (`/etc/nginx/sites-available/rld.fi`)

| Feature         | Config                                                        |
| --------------- | ------------------------------------------------------------- |
| SSL             | Let's Encrypt (certbot auto-renewal)                          |
| API Proxy       | `/api/` → `localhost:8081` with server-side API key injection |
| Rate Limiting   | 10 req/s, burst 20 on `/api/`                                 |
| HSTS            | `max-age=63072000; includeSubDomains; preload`                |
| CSP             | Restrict scripts/styles/connections to approved domains       |
| Sensitive Files | `.git`, `.env` → 404                                          |
| Server Version  | Hidden (`server_tokens off`)                                  |

### Rebuild & Deploy Frontend

```bash
cd frontend && npm run build
# Nginx serves from frontend/dist — no restart needed
```

### Firewall (UFW)

| Port      | Status         | Purpose                           |
| --------- | -------------- | --------------------------------- |
| 22/tcp    | ✅ Open        | SSH                               |
| 80/tcp    | ✅ Open        | HTTP → HTTPS redirect             |
| 443/tcp   | ✅ Open        | HTTPS (Nginx)                     |
| 8545      | 🔒 Docker only | Anvil (172.16.0.0/12)             |
| 8080-8082 | 🔒 Blocked     | Internal only (Docker networking) |

---

## API Endpoints

### Simulation Indexer (port 8080)

| Endpoint                  | Description                              |
| ------------------------- | ---------------------------------------- |
| `GET /`                   | Service status                           |
| `GET /health`             | Health check                             |
| `GET /config`             | Discovered contract addresses            |
| `GET /api/latest`         | Latest market/pool/broker state          |
| `GET /api/status`         | Indexer stats (last block, total events) |
| `GET /api/events?limit=N` | Recent events                            |
| `GET /api/history/market` | Market state history                     |
| `GET /api/history/pool`   | Pool state history                       |
| `GET /api/chart/price`    | Price chart data                         |
| `GET /docs`               | Swagger UI                               |

### Rates Indexer (port 8081, proxied at `/api/`)

| Endpoint                         | Description           |
| -------------------------------- | --------------------- |
| `GET /`                          | Service status        |
| `GET /rates?symbol=USDC&limit=N` | Historical spot rates |
| `GET /eth-prices?limit=N`        | ETH price history     |

---

## Environment Variables

### Root `.env` (required)

| Variable             | Description                          | Secret?         |
| -------------------- | ------------------------------------ | --------------- |
| `MAINNET_RPC_URL`    | Alchemy/Infura RPC for rates indexer | Yes             |
| `ETH_RPC_URL`        | Alchemy RPC for Anvil forking        | Yes             |
| `DEPLOYER_KEY`       | Anvil key #0 (deploy contracts)      | Simulation only |
| `MM_KEY`             | Anvil key #3 (market maker)          | Simulation only |
| `CHAOS_KEY`          | Anvil key #4 (chaos trader)          | Simulation only |
| `TELEGRAM_BOT_TOKEN` | Telegram bot auth token              | Yes             |
| `TELEGRAM_CHAT_ID`   | Telegram chat for reports            | No              |
| `API_KEY`            | Rates API auth key                   | Yes             |

### Frontend `.env` (safe — no secrets)

| Variable               | Description                         |
| ---------------------- | ----------------------------------- |
| `VITE_API_BASE_URL`    | API endpoint (`https://rld.fi/api`) |
| `VITE_MAINNET_RPC_URL` | Public RPC for on-chain reads       |

> **Security:** Only `VITE_`-prefixed vars are exposed to the browser. The API key is injected server-side by Nginx's `proxy_set_header X-API-Key`.

---

## Operations

```bash
# View all containers
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# Logs
docker compose -f docker/docker-compose.yml logs -f indexer
docker compose -f docker/docker-compose.bot.yml logs -f monitor-bot

# Restart simulation (keeps rates + bot running)
docker compose -f docker/docker-compose.yml down -v
./restart.sh

# Rebuild + restart a single service
docker compose -f docker/docker-compose.yml build indexer
docker compose -f docker/docker-compose.yml up -d --no-deps indexer

# Check indexer lag
curl -s http://localhost:8080/api/status | python3 -m json.tool
```

---

## CI/CD (GitHub Actions)

Automated build & deploy pipeline via `.github/workflows/deploy.yml`.

### Triggers

| Trigger             | Condition                                                          |
| ------------------- | ------------------------------------------------------------------ |
| `push` to `main`    | Only when `frontend/**`, `backend/**`, or `docker/**` files change |
| `workflow_dispatch` | Manual trigger from GitHub Actions UI                              |

> **Note:** Changes to `.github/workflows/` alone won't auto-trigger — use manual dispatch.

### Pipeline Jobs

```
push to main ──► frontend (34s) ──► deploy (29s)
                   │                    │
                   ├─ Checkout          ├─ Download build artifact
                   ├─ Node 20 + cache  ├─ SCP dist/ to server
                   ├─ npm ci           ├─ git pull --ff-only
                   ├─ npm run lint     └─ Rebuild backend if changed
                   ├─ npm run build
                   └─ Upload artifact
```

**Job 1: `frontend`** — Lint & build on `ubuntu-latest`

- Installs Node 20 with npm cache (keyed on `package-lock.json`)
- Runs ESLint (`npm run lint`) — **fails the pipeline on any error**
- Builds with Vite, injecting `VITE_API_BASE_URL` and `VITE_MAINNET_RPC_URL`
- Uploads `frontend/dist` as artifact (7-day retention)

**Job 2: `deploy`** — SCP + SSH to production (only on `main`)

- Downloads the `frontend-dist` artifact
- SCPs `dist/*` to `/home/ubuntu/RLD/frontend/` via `appleboy/scp-action@v0.1.7`
- SSHs into the server via `appleboy/ssh-action@v1.2.5`:
  - `git pull --ff-only` to sync config/backend changes
  - If `backend/` changed: rebuilds `indexer` + `monitor-bot` containers

### Required GitHub Secrets

Set these in **Settings → Secrets and variables → Actions**:

| Secret                 | Value                  | Notes                             |
| ---------------------- | ---------------------- | --------------------------------- |
| `DEPLOY_HOST`          | Server IP or hostname  | e.g., `203.0.113.42`              |
| `DEPLOY_USER`          | SSH username           | e.g., `ubuntu`                    |
| `DEPLOY_SSH_KEY`       | Full SSH private key   | Must include BEGIN/END lines      |
| `VITE_MAINNET_RPC_URL` | Alchemy/Infura RPC URL | Baked into frontend at build time |

### Deploy Key Setup

The deploy key is stored at `~/.ssh/deploy_key` on the server:

```bash
# Generate (already done)
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/deploy_key -N ""

# Public key is in authorized_keys
cat ~/.ssh/deploy_key.pub >> ~/.ssh/authorized_keys

# Copy the PRIVATE key into DEPLOY_SSH_KEY secret
cat ~/.ssh/deploy_key
# Copy entire output including -----BEGIN/END----- lines
```

### Troubleshooting

| Error                                | Cause                                  | Fix                                        |
| ------------------------------------ | -------------------------------------- | ------------------------------------------ |
| `exit code 128` (warning)            | npm cache git operation                | Harmless, ignore                           |
| `ssh: no key found`                  | `DEPLOY_SSH_KEY` empty or wrong format | Re-paste the full private key with headers |
| `unable to authenticate [publickey]` | Key mismatch                           | Use `~/.ssh/deploy_key`, not `id_ed25519`  |
| `Unable to resolve action`           | Invalid action version tag             | Check tags at github.com/appleboy/\*       |
| Pipeline not triggered on push       | Changed files outside `paths` filter   | Use manual `workflow_dispatch` or add path |

---

## Log Aggregation

Hourly cron collects logs from all containers into daily files:

```bash
# Setup (already installed via crontab)
0 * * * * /home/ubuntu/RLD/docker/scripts/collect-logs.sh

# Manual run
./docker/scripts/collect-logs.sh

# View today's logs
ls -la logs/
cat logs/indexer_$(date +%Y-%m-%d).log
cat logs/health_$(date +%Y-%m-%d).log
```

Logs are rotated automatically after 7 days.

---

## Rate Limiting

| Zone   | Rate     | Burst | Scope               |
| ------ | -------- | ----- | ------------------- |
| `site` | 30 req/s | 60    | All pages (`/`)     |
| `api`  | 10 req/s | 20    | API proxy (`/api/`) |
