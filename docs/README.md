# RLD Protocol — Documentation Index

Central index linking all component documentation across the repository. Each doc lives alongside its code — this page is the map.

---

## Architecture

| Document | Description |
|----------|-------------|
| [Simulation Deployment](../docker/README.md) | Docker stack, services, networking, restart, env vars, CI/CD |
| [Protocol Docs (VitePress)](../docs-site/index.md) | Public-facing documentation site at [docs.rld.fi](https://docs.rld.fi) |

---

## Backend Services

| Document | Description |
|----------|-------------|
| [Backend Overview](../backend/README.md) | All 3 Python services: sim indexer, rates indexer, Telegram bot |
| [GraphQL API Reference](../backend/api/GRAPHQL_API.md) | Full query catalog, types, integration patterns, examples |

---

## Smart Contracts

| Document | Description |
|----------|-------------|
| [Contracts README](../contracts/README.md) | Solidity contracts, build, test, deploy |
| [Differential Fuzzing](../contracts/test/DIFFERENTIAL_FUZZING.md) | Fuzz testing methodology and results |

---

## Frontend

| Document | Description |
|----------|-------------|
| [Frontend README](../frontend/README.md) | React app structure, build, dev server |
| [Design System](../frontend/DESIGN_SYSTEM.md) | CSS tokens, typography, color palette, components |

---

## Simulation Infrastructure

| Document | Description |
|----------|-------------|
| [Docker Deployment](../docker/README.md) | Full simulation stack setup and operations |
| [Daemons](../docker/daemons/README.md) | MM daemon (rate sync, arb, clear auctions) + chaos trader |
| [Dashboard](../docker/dashboard/README.md) | Infrastructure monitoring dashboard (port 8090) |

---

## Operational Guides

| Document | Description |
|----------|-------------|
| [Scripts README](../scripts/README.md) | Deployment and utility scripts |
| [Rates Indexer](../indexer/README.md) | Standalone rates indexer documentation |

---

## Quick Links

### Starting a Simulation
```bash
./docker/restart.sh              # Full clean restart
./docker/restart.sh --no-build   # Fast restart (skip image rebuild)
```

### Building Frontend
```bash
cd frontend && npm run build     # Production build → dist/
```

### Running Tests
```bash
cd contracts && forge test       # Solidity tests
cd frontend && npm run lint      # ESLint
```

### Checking Service Health
```bash
curl http://localhost:8080/health   # Simulation indexer
curl http://localhost:8081/         # Rates indexer
curl http://localhost:8082/         # Monitor bot
```

### Key API Endpoints
```bash
# Simulation indexer (GraphQL)
curl -X POST http://localhost:8080/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ latest { blockNumber market { totalDebt } pool { markPrice } } }"}'

# Rates
curl http://localhost:8081/rates?symbol=USDC&limit=10

# Market info (REST)
curl http://localhost:8080/api/market-info
```
