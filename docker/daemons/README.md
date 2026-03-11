# Simulation Daemons

Containerized daemons that keep the RLD simulation alive by syncing oracle rates, arbitraging the market, clearing TWAMM auctions, and generating random trades.

Both daemons run inside a single Docker image (`docker/daemons/Dockerfile`) and wait for `deployment.json` to be fully populated before starting.

## Market Maker Daemon (`mm-daemon`)

**Entry point:** `backend/services/combined_daemon.py`

Runs four sub-systems at two speeds:

### Fast Loop (every 2s)

| Sub-system | Description |
|------------|-------------|
| **Timestamp Sync** | Calls `evm_setNextBlockTimestamp` to keep Anvil's `TIMESTAMP` opcode aligned with block headers |
| **Clear Auctions** | Buys accrued ghost tokens from the JTM (TWAMM) hook at a discount via `clear()` |

### Slow Loop (every 12s)

| Sub-system | Description |
|------------|-------------|
| **Rate Sync** | Fetches latest USDC borrow rate (API first, on-chain Aave V3 fallback) → updates `MockRLDAaveOracle.setRate()` |
| **Market Maker** | Reads index price (oracle) and mark price (V4 pool via `extsload`) → if spread > 1% (100 bps), executes an arb swap via `SwapRouter` to push mark toward index |

### Configuration

| Variable | Description |
|----------|-------------|
| `MOCK_ORACLE_ADDR` | MockRLDAaveOracle contract address |
| `WAUSDC` | waUSDC token address |
| `POSITION_TOKEN` | wRLP token address |
| `TWAMM_HOOK` | JTM/TWAMM hook address |
| `SWAP_ROUTER` | V4 swap router address |
| `PRIVATE_KEY` | MM operator key (Anvil key #3) |
| `ORACLE_ADMIN_KEY` | Deployer key for oracle updates (Anvil key #0) |
| `RPC_URL` | Anvil RPC |
| `API_URL` | Rates API for fetching latest rates |
| `API_KEY` | API authentication key |
| `RLD_CORE` | RLDCore contract (for reading NF) |
| `MARKET_ID` | Market ID (bytes32) |

### How Arb Works

```
1. Read index price from MockRLDAaveOracle.getIndexPrice()
2. Read mark price from V4 pool via extsload (slot0 → sqrtPriceX96 → tick → price)
3. If |spread| > 1%:
   - Calculate exact swap amount to move mark to index (Python V4 math)
   - Cap at $500k per trade
   - Execute via SwapRouter
```

### Clear Auction Logic

```
1. Call getStreamState() → (accrued0, accrued1, currentDiscount, timeSinceLastClear)
2. If accrued USD value > $0.001 and stream has active orders:
   - Call clear(poolKey, zeroForOne, maxAmount, minDiscountBps=1)
   - Bot pays market tokens, receives ghost tokens at discount
3. Expected reverts (ignored): InsufficientDiscount, NothingToClear, NoActiveStream
```

---

## Chaos Trader Daemon (`chaos-trader`)

**Entry point:** `backend/tools/chaos_daemon.py`

Executes random trades every 10–15 seconds to simulate organic market activity and stress-test the system.

### Behavior

- Randomly picks direction: buy wRLP or sell wRLP
- Random size: 1–10% of available balance
- Logs all operations to `/tmp/chaos_trader.log`
- Skips trades if balance < 1,000 tokens

### Configuration

| Variable | Description |
|----------|-------------|
| `CHAOS_KEY` | Chaos trader private key (Anvil key #4) |
| `CHAOS_BROKER` | Chaos trader's broker address |
| `WAUSDC` | waUSDC token address |
| `POSITION_TOKEN` | wRLP token address |
| `TWAMM_HOOK` | JTM hook address |
| `SWAP_ROUTER` | V4 swap router |
| `RPC_URL` | Anvil RPC |

---

## Startup Sequence

Both daemons use `wait-for-config.sh` as their Docker entrypoint:

```
1. wait-for-config.sh polls /config/deployment.json every 2s (up to 240s)
2. Validates that deployment.json has a non-null "rld_core" key
3. Exports all contract addresses from deployment.json as env vars
4. Launches the Python daemon
```

## Logs

```bash
# Follow MM daemon
docker compose -f docker/docker-compose.yml logs -f mm-daemon

# Follow chaos trader
docker compose -f docker/docker-compose.yml logs -f chaos-trader

# Chaos trader also logs to file
docker exec chaos-trader cat /tmp/chaos_trader.log
```
