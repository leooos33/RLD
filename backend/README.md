# RLD Backend

Python services powering the RLD Protocol simulation and rate indexing infrastructure. This package contains three independent services that share a common codebase:

| Service | Entry Point | Dockerfile | Port | Description |
|---------|-------------|------------|------|-------------|
| **Simulation Indexer** | `entrypoint.py` | `Dockerfile.indexer` | 8080 | Indexes simulation blocks, serves REST + GraphQL API |
| **Rates Indexer** | `start_rates.sh` | `Dockerfile.rates` | 8081 | Indexes Aave V3 rates, ETH prices, SOFR, sUSDe yields |
| **Monitor Bot** | `services/monitor_bot.py` | `Dockerfile.bot` | 8082 | Telegram bot with /status dashboard + hourly reports |

## Directory Structure

```
backend/
├── api/
│   ├── main.py                 # Rates API entrypoint (middleware, router imports)
│   ├── deps.py                 # Shared: DB connections, auth, cache
│   ├── routes/
│   │   ├── rates.py            # /rates, /eth-prices, /ws/rates, /download/db
│   │   └── sim.py              # Simulation endpoints (RATE_ONLY=false only)
│   ├── indexer_api.py          # Simulation REST API (FastAPI)
│   ├── graphql_schema.py       # Simulation GraphQL schema (Strawberry)
│   └── GRAPHQL_API.md          # GraphQL API reference for integrators
├── db/
│   └── comprehensive.py        # PostgreSQL data access layer (simulation)
├── indexers/
│   └── comprehensive.py        # On-chain event indexer (simulation)
├── rates/
│   ├── daemon.py               # Rate indexing daemon (protocol-agnostic loop)
│   ├── sync_clean_db.py        # Hourly aggregation sync (raw → clean DB)
│   ├── init_clean_db.py        # Clean DB initialization
│   ├── fill_gaps.py            # Gap repair utility
│   └── adapters/               # Protocol-specific rate adapters
│       ├── base.py             # ProtocolAdapter ABC
│       ├── aave_v3.py          # Aave V3 [ACTIVE]
│       ├── morpho.py           # Morpho [STUB]
│       ├── fluid.py            # Fluid [STUB]
│       └── euler.py            # Euler [STUB]
├── services/
│   ├── combined_daemon.py      # MM daemon (rate sync + arb + clear auctions)
│   ├── monitor_bot.py          # Telegram monitoring bot
│   ├── v4_pool.py              # Uniswap V4 pool reader (Python, no Forge)
│   └── v4_swap.py              # Uniswap V4 swap executor
├── tools/
│   ├── chaos_daemon.py         # Random trade generator
│   └── ...                     # Audit, debugging, and analysis scripts
├── entrypoint.py               # Simulation indexer container entrypoint
├── start_prod.sh               # Simulation indexer startup script
├── start_rates.sh              # Rates indexer startup script
├── config.py                   # Protocol registry, data sources, DB paths
└── requirements.txt            # Python dependencies
```

## Simulation Indexer

The simulation indexer runs inside the Docker simulation stack. It auto-discovers contracts from `deployment.json`, indexes every block, and serves data via REST + GraphQL.

### How It Works

1. **Startup**: Reads `deployment.json` (written by deployer) → discovers contracts via RPC → creates PostgreSQL tables
2. **Indexing loop**: Every 2s, polls for new blocks → reads market state, pool state, broker positions, events → writes to PostgreSQL
3. **API**: FastAPI serves REST endpoints and Strawberry GraphQL on port 8080

### Key APIs

- **REST**: `/api/latest`, `/api/market-info`, `/api/events`, `/api/chart/price`, `/api/status`
- **GraphQL**: `POST /graphql` — see [GRAPHQL_API.md](api/GRAPHQL_API.md) for full reference

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `RPC_URL` | `http://host.docker.internal:8545` | Anvil RPC |
| `CONFIG_FILE` | `/config/deployment.json` | Contract addresses |
| `DB_URL` | `postgresql://rld:rld_dev_password@postgres:5432/rld_indexer` | PostgreSQL connection |
| `SIM_ID` | `default` | Schema isolation key |
| `API_PORT` | `8080` | API port |
| `POLL_INTERVAL` | `2` | Block poll interval (seconds) |
| `BROKERS` | — | Comma-separated broker addresses to track |

---

## Rates Indexer

A persistent service that indexes lending rates and asset yields from mainnet. Uses a **protocol adapter pattern** for multi-protocol extensibility.

### Protocol Registry (`config.py`)

| Protocol | Status | Adapter | Assets |
|----------|--------|---------|--------|
| **Aave V3** | ✅ Active | `aave_v3.py` | USDC, DAI, USDT |
| **Morpho** | ⏸️ Stub | `morpho.py` | — |
| **Fluid** | ⏸️ Stub | `fluid.py` | — |
| **Euler** | ⏸️ Stub | `euler.py` | — |

### Data Sources

| Source | Method | Frequency | Storage |
|--------|--------|-----------|---------|
| Protocol rates (via adapters) | `eth_call` per adapter | Every block (~12s) | `aave_rates.db` |
| ETH/USD price | Uniswap V3 `slot0()` | Every block (~12s) | `aave_rates.db` |
| sUSDe yield | ERC-4626 `convertToAssets(1e18)` | Every block (~12s) | `aave_rates.db` |
| ETH/USD backfill | The Graph `poolHourDatas` | Startup only | `aave_rates.db` |
| SOFR rate | NY Fed API | Daily | `aave_rates.db` |

### Data Pipeline

```
Protocol Adapters         ─┐
Uniswap V3 slot0()         ├──► aave_rates.db (block-level) ──► sync_clean_db.py ──► clean_rates.db (hourly)
sUSDe convertToAssets()    ├                                       (AVG per hour)
NY Fed SOFR API            ─┘                                       (sUSDe: 24h Δ → APY)
```

### Adding a New Protocol

1. Set `enabled: True` in `PROTOCOLS` dict in `config.py`
2. Create `rates/adapters/{protocol}.py` implementing `ProtocolAdapter` (see `base.py`)
3. Restart container — daemon auto-discovers it, tables auto-create, API auto-serves

### API Endpoints (port 8081)

| Endpoint | Description |
|----------|-------------|
| `GET /` | Service status + last indexed block |
| `GET /rates?symbol=USDC&limit=N` | Historical lending rates |
| `GET /rates?symbol=sUSDe` | sUSDe staking yields (on-chain) |
| `GET /rates?symbol=SOFR` | SOFR daily rates |
| `GET /eth-prices?limit=N&resolution=1H` | ETH price history |
| `WS /ws/rates` | Real-time rate broadcast |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `MAINNET_RPC_URL` | Primary Ethereum RPC (unrestricted Alchemy key) |
| `RESERVE_RPC_URL` | Backup RPC (Infura) |
| `ETH_PRICE_GRAPH_URL` | The Graph API URL for Uniswap V3 data (gap backfill) |
| `API_KEY` | API authentication key (injected by Nginx) |

---

## Monitor Bot (Telegram)

A Telegram bot that provides system monitoring via `/status` command and hourly automated reports.

### Features

- `/start` — Welcome message
- `/status` — Live dashboard with Refresh button
- **Hourly autoscan** — Sends report at the top of every hour
- **Alerting** — Sends `🚨 ALERT: System DOWN` when the rates API becomes unreachable, and `✅ RECOVERY` when it comes back

### Dashboard Report Contents

| Section | Data |
|---------|------|
| API Status | Online/Offline + response latency |
| Block Lag | Indexed vs. chain block count |
| Market Rates | USDC, DAI, USDT lending rates + 24h trend |
| ETH Price | Live block-level price + 24h trend |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Bot auth token from @BotFather |
| `TELEGRAM_CHAT_ID` | Default chat ID (auto-saved on first `/start`) |
| `RATES_API_URL` | Rates indexer URL (default: `http://rates-indexer:8080`) |
| `MAINNET_RPC_URL` | For on-chain block number (lag calculation) |
| `API_KEY` | Rates API auth key |

---

## Dependencies

```
fastapi, uvicorn          # HTTP API framework
strawberry-graphql[fastapi] # GraphQL
web3                      # Ethereum RPC
psycopg2-binary           # PostgreSQL (simulation indexer)
python-dotenv             # .env loading
requests, httpx           # HTTP clients
cachetools                # API response caching
websockets                # WebSocket support
pandas                    # Data analysis (simulation indexer only)
```

## Local Development

```bash
cd backend
pip install -r requirements.txt

# Run simulation indexer locally
RPC_URL=http://localhost:8545 python3 entrypoint.py

# Run rates indexer locally
MAINNET_RPC_URL=... python3 rates/daemon.py

# Run monitor bot locally
TELEGRAM_BOT_TOKEN=... python3 services/monitor_bot.py
```
