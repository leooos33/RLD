# RLD Protocol Scripts

Shell scripts for deploying, testing, and simulating the RLD protocol.

## Quick Start

```bash
# Full lifecycle simulation (recommended first run)
./scripts/lifecycle_test.sh

# Then run stress tests on the existing pool
./scripts/stress_test.sh
./scripts/chaos_test.sh
```

---

## Core Scripts

### `lifecycle_test.sh` ⭐ Main Entry Point

Complete end-to-end protocol simulation.

**What it does:**

1. Restarts Anvil fork at block 21698573
2. Deploys RLD protocol (TWAMM Hook + Factory)
3. Deploys wrapped market (waUSDC/wRLP)
4. User A: Deposits 100M collateral, mints wRLP, provides LP
5. User B: Swaps 100k waUSDC → wRLP
6. User C: Submits 100k TWAMM order

**Usage:**

```bash
./scripts/lifecycle_test.sh
```

**Output:**

- Exports environment variables for further testing
- Creates `wrapped_market.json` in contracts/
- LP Position NFT Token ID

**Expected duration:** ~3 minutes

---

### `stress_test.sh`

100 alternating swaps with pattern: BUY/SELL × EXACT_IN/EXACT_OUT

**Prerequisites:** Run `lifecycle_test.sh` first (or set `WAUSDC`, `POSITION_TOKEN`, `TWAMM_HOOK`)

**What it does:**

- Funds trader with waUSDC if needed
- Executes 100 pattern swaps
- Reports tick change and net P&L

**Usage:**

```bash
./scripts/stress_test.sh
```

**Expected output:**

```
=== SUMMARY ===
Tick change: 0
Net waUSDC: -25000
Net wRLP: -2400
```

---

### `chaos_test.sh` 🔥

Random stress test with varying sizes, whale swaps, and time warps.

**Prerequisites:** Run `lifecycle_test.sh` first

**What it does:**

- Random swap sizes (10-1000 tokens)
- 10% chance of whale swaps (5x size)
- 5% chance of dust swaps (1 token)
- Time warps between swaps

**Usage:**

```bash
./scripts/chaos_test.sh
```

**Expected output:**

```
=== CHAOS RESULTS ===
Success: 98
Failed: 2
=== TICK VOLATILITY ===
Range: 279 ticks
```

---

## Deployment Scripts

### `deploy_local.sh`

Deploys core RLD protocol to local Anvil.

```bash
./scripts/deploy_local.sh
```

### `deploy_wrapped_market.sh`

Deploys waUSDC/wRLP market after protocol is deployed.

```bash
./scripts/deploy_wrapped_market.sh
```

---

## Trading Scripts

### `go_long.sh`

Swap waUSDC → wRLP (go long on wRLP).

**Environment required:**

```bash
export WAUSDC=0x...
export POSITION_TOKEN=0x...
export TWAMM_HOOK=0x...
export SWAP_AMOUNT=100000000  # 100 tokens
```

### `go_short.sh`

Swap wRLP → waUSDC (go short / exit position).

### `test_twamm_order.sh`

Submit a TWAMM time-weighted order.

---

## LP Scripts

### `mint_and_lp_wrapped.sh`

Mint wRLP and provide liquidity using wrapped tokens.

### `mint_and_lp_executor.sh`

Full LP flow using executor pattern.

---

## Environment Variables

Scripts read from `contracts/.env`:

```bash
WAUSDC=0x...              # Wrapped aUSDC address
POSITION_TOKEN=0x...      # wRLP token address
TWAMM_HOOK=0x...          # TWAMM hook address
MARKET_ID=0x...           # Market identifier
BROKER_FACTORY=0x...      # Broker factory
PRIVATE_KEY=0x...         # Deployer key
```

After running `lifecycle_test.sh`, export these to continue testing:

```bash
export WAUSDC=0x2fe19128A8257182fdD77f90eA96D27cA342897A
export POSITION_TOKEN=0xcF6c6272E9e353fc1F3e9A747A7B7AADE3c83389
export TWAMM_HOOK=0x7e0C07EEabb2459D70dba5b8d100Dca44c652aC0
```

---

## Anvil Accounts

| Account   | Address                                      | Role              |
| --------- | -------------------------------------------- | ----------------- |
| Account 0 | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` | Deployer / User A |
| Account 1 | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` | User B (Trader)   |
| Account 2 | `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC` | User C (TWAMM)    |

---

## Troubleshooting

### "WAUSDC not set"

Run `lifecycle_test.sh` first or set environment variables.

### Swap fails with overflow

Check currency ordering. The LifecycleSwap script handles this automatically.

### TWAMM order fails

Ensure user has approved tokens and has sufficient balance.

### Anvil connection refused

```bash
pkill anvil
anvil --fork-url $ETH_RPC_URL --fork-block-number 21698573
```
