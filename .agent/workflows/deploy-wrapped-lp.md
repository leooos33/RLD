---
description: Deploy waUSDC market and provide V4 LP from scratch
---

# Deploy Simulation Stack

Full redeployment of the RLD simulation stack (protocol, MockOracle, market, users, LP, brokers, swap router).

> **DO NOT TOUCH**: rates-indexer, tg-bot — they run independently.

## Prerequisites

- `docker/.env` configured (keys, RPC URLs, API keys)
- Docker and Docker Compose v2 installed

## Canonical Command

// turbo-all

### Sim-only restart (rates-indexer + tg-bot stay running)

```bash
cd /home/ubuntu/RLD && ./docker/restart.sh --sim-only
```

### Full restart (everything including rates + bot)

```bash
cd /home/ubuntu/RLD && ./docker/restart.sh
```

### Options

| Flag          | Effect                                    |
| :------------ | :---------------------------------------- |
| `--sim-only`  | Keep rates-indexer and tg-bot running     |
| `--no-build`  | Skip Docker image rebuilds (faster)       |
| `--keep-data` | Preserve indexer SQLite DB across restart |

## What happens

1. **Teardown**: Kills Anvil, stops sim containers, prunes images
2. **Anvil**: Starts fresh fork at configured block
3. **Support**: Starts rates-indexer + bot (unless `--sim-only`)
4. **Deploy**: Runs deployer container (`deploy_all.sh`)
   - Protocol (RLDCore, Factory, TWAMM, BrokerRouter)
   - MockRLDAaveOracle (rate fetched from rates-indexer API)
   - Wrapped market (waUSDC, wRLP, BrokerFactory)
   - Users: LP ($100M), Long ($100k), TWAMM ($100k), MM ($10M), Chaos ($10M)
   - SwapRouter + token approvals
   - Writes `deployment.json`
5. **Services**: Indexer, MM daemon, Chaos trader start after deployer exits
6. **Verify**: Health checks on all containers + API endpoint

## Verify

```bash
# Check all containers
docker ps --format "table {{.Names}}\t{{.Status}}"

# Check API
curl -s http://localhost:8080/api/latest | python3 -m json.tool | head -20

# MM daemon logs
docker logs docker-mm-daemon-1 --tail 10
```
