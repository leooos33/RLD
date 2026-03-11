# RLD Docker Deployment

Complete containerized infrastructure for the RLD Protocol: simulation stack (Postgres-backed), rates indexer, Telegram bot, and production frontend.

## Architecture

```
                  ┌──────────────────────────────────────────────────┐
                  │                 HOST (OVHCloud)                  │
                  │                                                  │
  Internet ──────►│  Nginx (443/SSL) ──► /api/ ──► rates-indexer    │
                  │       │                        (port 8081)       │
                  │       └──► /* ──► frontend/dist                  │
                  │                                                  │
                  │  Nginx (8090) ──► dashboard/index.html           │
                  │       └──► /status.json (generated every 60s)   │
                  │                                                  │
                  │  ┌─── docker_default network ───────────────┐    │
                  │  │                                          │    │
                  │  │  postgres ◄── indexer ◄── mm-daemon      │    │
                  │  │                 ▲          chaos-trader   │    │
                  │  │                 │                         │    │
                  │  │  rates-indexer ◄── monitor-bot            │    │
                  │  │                                          │    │
                  │  │  deployer (one-shot)                     │    │
                  │  └──────────────────────────────────────────┘    │
                  │                                                  │
                  │  Anvil (port 8545) ◄── all containers            │
                  │  Cron: generate-status.sh (every minute)         │
                  └──────────────────────────────────────────────────┘
```

## Quick Start

### Full Stack Restart (recommended)

```bash
# One command does everything: kills Anvil, tears down containers,
# cleans deployment.json, restarts Anvil from clean fork, deploys
# contracts, launches all services, waits for health, and prints status.
./docker/restart.sh
```

**CLI Flags:**

| Flag         | Description                                            |
| ------------ | ------------------------------------------------------ |
| `--no-build` | Skip Docker image rebuilds (faster if no code changes) |
| `--help`     | Show usage                                             |

```bash
# Fast restart without rebuilding images
./docker/restart.sh --no-build
```

> **Note:** Each restart cleans `deployment.json` before deploying, ensuring all addresses represent the latest on-chain state. No stale addresses carry over between simulations.

### Manual Setup (step by step)

```bash
# 1. Start Anvil fork
anvil --fork-url $MAINNET_RPC_URL --fork-block-number 21698573 --block-time 12 --host 0.0.0.0

# 2. Start persistent services (only needed once)
docker compose -f docker/docker-compose.rates.yml --env-file docker/.env up -d
docker compose -f docker/docker-compose.bot.yml --env-file docker/.env up -d

# 3. Deploy + launch simulation
cd docker && docker compose --env-file .env up --build -d
```

### Frontend (production)

```bash
# Build locally — Nginx serves from frontend/dist
cd frontend && npm run build

# Or containerized
docker compose -f docker/docker-compose.frontend.yml up -d --build
```

---

## Services

### Compose Files

| File                          | Services                                               | Lifecycle      |
| ----------------------------- | ------------------------------------------------------ | -------------- |
| `docker-compose.yml`          | postgres, deployer, indexer, mm-daemon, chaos-trader   | Per simulation |
| `docker-compose.rates.yml`    | rates-indexer                                          | Persistent     |
| `docker-compose.bot.yml`      | monitor-bot                                            | Persistent     |
| `docker-compose.frontend.yml` | frontend                                               | Persistent     |

### Container Details

| Container       | Image                        | Port | Health          | Depends On            | Description                                                                          |
| --------------- | ---------------------------- | ---- | --------------- | --------------------- | ------------------------------------------------------------------------------------ |
| `postgres`      | `postgres:15-alpine`         | 5432 | `pg_isready`    | —                     | Shared PostgreSQL database for all simulation data. Persistent volume                |
| `deployer`      | `docker/deployer/Dockerfile` | —    | Exits on success| postgres (healthy)    | Deploys protocol, oracle, market, users, router → writes `deployment.json`           |
| `indexer`       | `backend/Dockerfile.indexer` | 8080 | `python urllib` | deployer, postgres    | Indexes simulation blocks, serves REST + GraphQL API. Auto-resets tables on restart  |
| `mm-daemon`     | `docker/daemons/Dockerfile`  | —    | `pgrep`         | deployer              | Market maker: arb trades + oracle updates from live rates                            |
| `chaos-trader`  | `docker/daemons/Dockerfile`  | —    | `pgrep`         | deployer              | Random trades for market activity                                                    |
| `rates-indexer` | `backend/Dockerfile.rates`   | 8081 | curl            | —                     | Indexes Aave V3 rates + ETH price (Uniswap V3 slot0) per block (~12s)                |
| `monitor-bot`   | `backend/Dockerfile.bot`     | 8082 | curl            | —                     | Telegram bot: `/status` dashboard, hourly rate+price digests                         |
| `rld-frontend`  | `frontend/Dockerfile`        | 80   | wget            | —                     | Multi-stage build: Node 20 → Nginx Alpine (68MB)                                     |

### Service Ordering & Resilience

The simulation stack uses three layers of defense against startup race conditions:

1. **`depends_on: service_completed_successfully`** — `indexer`, `mm-daemon`, and `chaos-trader` only start after the `deployer` container exits with code 0. This prevents services from starting with an empty or partial `deployment.json`.

2. **`wait-for-config.sh`** (daemon entrypoint) — Validates that `deployment.json` contains a non-null `rld_core` key, not just that the file exists. Polls every 2s for up to 240s.

3. **`entrypoint.py`** (indexer) — Retries on-chain market discovery up to 30 times with 10s backoff. If contracts aren't deployed yet when the indexer starts, it waits instead of crashing.

4. **Deployer retry logic** — `forge create` commands (e.g., MockRLDAaveOracle) retry up to 3 times with 3s delays to handle transient failures (stale caches, nonce collisions on re-deploys).

---

## deployment.json

The deployer writes `deployment.json` on success. This file is the **single source of truth** for all contract addresses used by the indexer, daemons, and frontend. It is cleaned at the start of each restart to prevent stale addresses.

### Structure

```json
{
    "rpc_url": "http://host.docker.internal:8545",
    "rld_core": "0x...",
    "twamm_hook": "0x...",
    "market_id": "0x...",
    "mock_oracle": "0x...",
    "broker_router": "0x...",
    "wausdc": "0x...",
    "position_token": "0x...",
    "broker_factory": "0x...",
    "swap_router": "0x...",
    "bond_factory": "0x...",
    "basis_trade_factory": "0x...",
    "broker_executor": "0x...",
    "pool_manager": "0x...",
    "pool_id": "0x...",
    "external_contracts": {
        "usdc": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        "ausdc": "0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c",
        "aave_pool": "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
        "susde": "0x9D39A5DE30e57443BfF2A8307A4256c8797A3497",
        "usdc_whale": "0x37305B1cD40574E4C5Ce33f8e8306Be057fD7341"
    }
}
```

The `external_contracts` block contains canonical mainnet addresses for tokens and protocols used by the simulation (USDC, aUSDC, Aave V3 Pool, sUSDe, USDC whale for faucet). These are served to the frontend via the indexer's `marketInfo` response, eliminating hardcoded addresses across the codebase.

---

## Networking

All compose-managed containers share the `docker_default` network. Services communicate by **Docker service name**, not `host.docker.internal`:

| From           | To              | URL                                |
| -------------- | --------------- | ---------------------------------- |
| `indexer`      | `postgres`      | `postgresql://rld:...@postgres:5432/rld_indexer` |
| `monitor-bot`  | `rates-indexer` | `http://rates-indexer:8080`        |
| `mm-daemon`    | `rates-indexer` | `http://rates-indexer:8080`        |
| All containers | Anvil           | `http://host.docker.internal:8545` |

> **Note:** External ports (8080, 8081, 8082) are exposed via Docker but **blocked by UFW** to the internet. Only SSH (22), HTTP (80), and HTTPS (443) are open externally.

---

## Database

### PostgreSQL (Simulation Indexer)

The simulation indexer uses PostgreSQL (`postgres:15-alpine`) with a persistent volume. Tables are auto-created on startup and wiped on simulation restart (stale data detection).

| Table              | Description                                    |
| ------------------ | ---------------------------------------------- |
| `block_state`      | Per-block market state (NF, debt, reserves)    |
| `pool_state`       | Per-block pool state (price, tick, liquidity)  |
| `events`           | Decoded protocol events                        |
| `broker_snapshots` | Broker NAV, debt, collateral ratio per block   |
| `price_candles_5m` | 5-minute OHLC candles for price charts         |

### SQLite (Rates Indexer)

The rates indexer uses SQLite (`aave_rates.db` + `clean_rates.db`), managed separately from the simulation stack.

---

## API Endpoints

### Simulation Indexer (port 8080)

#### REST API

| Endpoint                  | Description                                          |
| ------------------------- | ---------------------------------------------------- |
| `GET /`                   | Service status                                       |
| `GET /health`             | Health check                                         |
| `GET /config`             | Discovered contract addresses                        |
| `GET /api/latest`         | Latest market/pool/broker state                      |
| `GET /api/market-info`    | Full market config including `external_contracts`    |
| `GET /api/status`         | Indexer stats (last block, total events)             |
| `GET /api/events?limit=N` | Recent events                                        |
| `GET /api/history/market` | Market state history                                 |
| `GET /api/history/pool`   | Pool state history                                   |
| `GET /api/chart/price`    | Price chart data (supports `5M`, `1H`, `4H`, `1D`)  |
| `GET /docs`               | Swagger UI                                           |

#### GraphQL API (`POST /graphql`)

The indexer also serves a Strawberry GraphQL API. Key queries:

| Query                            | Description                                                                 |
| -------------------------------- | --------------------------------------------------------------------------- |
| `marketInfo`                     | Full market configuration, risk params, infrastructure, `externalContracts` |
| `marketInfo.externalContracts`   | USDC, aUSDC, Aave Pool, sUSDe, USDC whale addresses                        |
| `marketInfo.infrastructure`      | Pool manager, position manager, state view, routers                         |
| `simSnapshot`                    | Combined market state, pool state, broker snapshots per block               |

### Rates Indexer (port 8081, proxied at `/api/`)

| Endpoint                                 | Description                                  |
| ---------------------------------------- | -------------------------------------------- |
| `GET /`                                  | Service status                               |
| `GET /rates?symbol=USDC&limit=N`         | Historical spot rates (hourly from clean DB) |
| `GET /eth-prices?limit=N`                | ETH price history (hourly, default)          |
| `GET /eth-prices?limit=N&resolution=RAW` | ETH price (block-level, ~12s, from raw DB)   |

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
| 5432      | 🔒 Docker only | PostgreSQL (internal)             |
| 8545      | 🔒 Docker only | Anvil (172.16.0.0/12)             |
| 8080-8082 | 🔒 Blocked     | Internal only (Docker networking) |

---

## Environment Variables

### `docker/.env` (primary config)

| Variable              | Description                                             | Secret?         |
| --------------------- | ------------------------------------------------------- | --------------- |
| `RPC_URL`             | Anvil RPC (default: `http://host.docker.internal:8545`) | No              |
| `MAINNET_RPC_URL`     | **Unrestricted** Alchemy key for server-side use        | Yes             |
| `ETH_PRICE_GRAPH_URL` | The Graph API URL for Uniswap V3 ETH/USDC pool data     | Yes             |
| `RESERVE_RPC_URL`     | Infura RPC for reserve/fallback mainnet access          | Yes             |
| `DB_PASSWORD`         | PostgreSQL password (default: `rld_dev_password`)       | Simulation only |
| `DB_PORT`             | PostgreSQL port (default: `5432`)                       | No              |
| `SIM_ID`              | Simulation identifier (default: `default`)              | No              |
| `DEPLOYER_KEY`        | Anvil key #0 (deploy contracts)                         | Simulation only |
| `USER_A_KEY`          | Anvil key #0 (LP provider)                              | Simulation only |
| `USER_B_KEY`          | Anvil key #1 (long user)                                | Simulation only |
| `USER_C_KEY`          | Anvil key #2 (TWAMM user)                               | Simulation only |
| `MM_KEY`              | Anvil key #3 (market maker)                             | Simulation only |
| `CHAOS_KEY`           | Anvil key #4 (chaos trader)                             | Simulation only |
| `TELEGRAM_BOT_TOKEN`  | Telegram bot auth token                                 | Yes             |
| `TELEGRAM_CHAT_ID`    | Telegram chat for reports                               | No              |
| `API_KEY`             | Rates API auth key                                      | Yes             |

### Root `.env` (protocol addresses + frontend vars)

| Variable               | Description                                            |
| ---------------------- | ------------------------------------------------------ |
| `FORK_BLOCK`           | Anvil fork block number (default: `21698573`)          |
| `MAINNET_RPC_URL`      | **Unrestricted** Alchemy key (same as docker/.env)     |
| `VITE_MAINNET_RPC_URL` | **Origin-restricted** Alchemy key (frontend on rld.fi) |
| `VITE_API_BASE_URL`    | API endpoint (`https://rld.fi/api`)                    |
| `RLD_CORE`, `WAUSDC`…  | Protocol contract addresses (auto-updated by deployer) |

> **API Key Strategy:** Two Alchemy keys are used:
>
> - **Unrestricted** (`MAINNET_RPC_URL`) — for Anvil fork + rates indexer (server-side only)
> - **Origin-restricted to `rld.fi`** (`VITE_MAINNET_RPC_URL`) — for the frontend (exposed to browsers)
>
> Only `VITE_`-prefixed vars are exposed to the browser. The rates API key is injected server-side by Nginx's `proxy_set_header X-API-Key`.

---

## Operations

### Common Tasks

```bash
# Full clean restart (Anvil + all containers)
./docker/restart.sh

# Fast restart (no image rebuild)
./docker/restart.sh --no-build
```

### Monitoring

```bash
# View all containers
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# Follow logs
docker compose -f docker/docker-compose.yml logs -f indexer
docker compose -f docker/docker-compose.yml logs -f mm-daemon
docker compose -f docker/docker-compose.bot.yml logs -f monitor-bot

# Check indexer lag
curl -s http://localhost:8080/api/status | python3 -m json.tool

# Check external contracts served by indexer
curl -s http://localhost:8080/api/market-info | python3 -c "import json,sys; print(json.dumps(json.load(sys.stdin).get('external_contracts',{}), indent=2))"

# Check Anvil block
cast block-number --rpc-url http://localhost:8545
```

### Infrastructure Dashboard (port 8090)

A real-time infrastructure dashboard served by Nginx on port 8090. Auto-refreshes every **12 seconds** (1 Ethereum block time).

```bash
# Access locally
open http://localhost:8090

# Regenerate status data manually
sudo /home/ubuntu/RLD/docker/scripts/generate-status.sh

# View generation logs
tail -f /home/ubuntu/RLD/logs/status-gen.log
```

**Dashboard sections:**

| Section         | Metrics                                                 |
| --------------- | ------------------------------------------------------- |
| System          | CPU load, memory, disk, uptime, connections             |
| Containers      | Status, health, uptime for all containers               |
| Services        | Health check + response time for each service endpoint  |
| Database Health | Table freshness, row counts, file sizes                 |
| Data Quality    | NULL values (7d), corrupt rows, sync age, missing hours |
| SSL & Git       | Certificate expiry, latest commit info                  |
| Activity Log    | Rolling feed of health checks, block numbers, errors    |

**How it works:**

1. `generate-status.sh` runs every minute via cron, collecting metrics from Docker, PostgreSQL/SQLite DBs, service endpoints, and system stats
2. Writes `dashboard/status.json` atomically (`mktemp` → `mv`) to prevent partial reads
3. `dashboard/index.html` (React/Babel) fetches `status.json` every 12s and renders

**Alerting thresholds (Database Health):**

| Metric      | Real-time tables (rates) | Hourly tables (eth_prices, clean_rates) |
| ----------- | ------------------------ | --------------------------------------- |
| 🟢 Fresh    | < 30 min                 | < 75 min                                |
| 🟡 Stale    | < 2 hours                | < 2.5 hours                             |
| 🔴 Critical | > 2 hours                | > 2.5 hours                             |

### Single-Service Rebuild

```bash
# Rebuild + restart just one service (no full redeploy)
docker compose -f docker/docker-compose.yml build indexer
docker compose -f docker/docker-compose.yml up -d --no-deps indexer
```

### Troubleshooting

| Symptom                           | Cause                                         | Fix                                                    |
| --------------------------------- | --------------------------------------------- | ------------------------------------------------------ |
| RPC 403 errors in daemon logs     | Alchemy API key restricted to specific origin | Use an unrestricted key in `MAINNET_RPC_URL`           |
| Port already in use on restart    | Orphaned container from previous run          | `restart.sh` handles this automatically                |
| Deployer `nonce too low`          | Rapid-fire transactions without receipt wait  | Already fixed in `deploy_all.sh`                       |
| MockOracle deploy fails           | Transient `forge create` failure on re-deploy | Fixed: 3-attempt retry with 3s delay                   |
| Containers stuck in `Created`     | Deployer dependency not met                   | Fixed: `depends_on: service_completed_successfully`    |
| Services start with empty config  | `deployment.json` exists but is `{}`          | Fixed: `wait-for-config.sh` validates `rld_core` key   |
| Indexer crashes on first attempt  | Contracts not deployed when discovery runs    | Fixed: `entrypoint.py` retries 30× with 10s backoff    |
| `Cannot resolve 'indexer'` in bot | Bot on different Docker network than indexer  | Ensure both use same compose or `host.docker.internal` |
| Dashboard JSON parse error        | `status.json` read mid-write                  | Fixed: atomic writes via `mktemp` + `mv`               |
| ETH price stale by ~1 hour        | Using `1H` resolution instead of `RAW`        | Use `/eth-prices?resolution=RAW` for live price        |
| Sync age > 5min on dashboard      | `SYNC_INTERVAL` too high in daemon.py         | Set to 60s (current default)                           |
| Dashboard shows 5/6 services ok   | Stopped deployer counted in health check      | Fixed: stopped/created containers excluded from count  |
| Stale addresses after restart     | Old `deployment.json` carried over            | Fixed: `restart.sh` cleans file before deploying       |

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
* * * * * sudo /home/ubuntu/RLD/docker/scripts/generate-status.sh >> /home/ubuntu/RLD/logs/status-gen.log 2>&1

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

---

## Data Pipeline

### ETH Price Sync

The rates-indexer daemon fetches ETH/USDC prices **on-chain** via the Uniswap V3 `slot0()` function at every block (~12s), alongside Aave V3 rate calls.

```
Uniswap V3 slot0() ──► aave_rates.db (eth_prices) ──► sync_clean_db.py ──► clean_rates.db (hourly_stats)
     (per block, ~12s)          (block-level)              (AVG per hour)         (hourly aggregated)
```

- **Primary source:** Uniswap V3 USDC/ETH 0.05% pool `slot0()` — real-time `sqrtPriceX96` at each block
- **Conversion:** `ETH_USD = 10¹² / (sqrtPriceX96² / 2¹⁹²)` (adjusts for USDC 6 / WETH 18 decimals)
- **Gap repair:** The Graph `poolHourDatas` query backfills missing data after crashes (startup only)
- **API resolutions:** `RAW` = block-level from `aave_rates.db`, `1H/4H/1D` = aggregated from `clean_rates.db`
- **Bot display:** Uses `RAW` resolution for live price, `1H` for 24h trend calculation
