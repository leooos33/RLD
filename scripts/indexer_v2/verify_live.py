#!/usr/bin/env python3
"""
verify_live.py — Live indexer verification with RLD-specific operations.

Starts ingestor + processor, then executes real on-chain txns and asserts
each state change is reflected in the DB within 2 seconds.

Tests:
  1. ERC20 Transfer (waUSDC deposit to broker)
  2. Create new Broker via BrokerFactory
  3. Borrow (PositionModified — increase debt)
  4. Partial repay (PositionModified — decrease debt)
  5. wRLP Transfer between brokers
  6. Processing drain + zero errors

Usage:
    DATABASE_URL="postgresql://rld:rld_dev_password@localhost:5432/rld_indexer" \\
    python3 scripts/indexer_v2/verify_live.py
"""
import asyncio
import asyncpg
import json
import logging
import os
import sys
import time

from web3 import Web3

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from processor import run_processor
from ingestor import run_ingestor

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-5s %(name)-12s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("verify")

DB_URL = os.environ.get("DATABASE_URL", "postgresql://rld:rld_dev_password@localhost:5432/rld_indexer")
RPC_URL = os.environ.get("RPC_URL", "http://127.0.0.1:8545")
CONFIG_PATH = os.environ.get("CONFIG", os.path.join(os.path.dirname(__file__), "..", "..", "docker", "deployment.json"))

# Hardhat accounts
KEYS = {
    0: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",  # deployer
    5: "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",  # User A
    7: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",  # User B (unused broker owner)
    8: "0x8166f546bab6da521a8369cab06c5d2b9e46670292d85c875ee9ec20e84ffb61",  # User C (unused)
}

TIMEOUT = 2.0
POLL = 0.1


# ── Helpers ───────────────────────────────────────────────────────────────────

def send_tx(w3: Web3, key: str, to: str, data: str, gas: int = 200_000) -> dict:
    """Sign and send a tx, return receipt."""
    acct = w3.eth.account.from_key(key)
    nonce = w3.eth.get_transaction_count(acct.address, "pending")
    tx = {
        "from": acct.address,
        "to": Web3.to_checksum_address(to),
        "data": data,
        "gas": gas,
        "maxFeePerGas": w3.eth.gas_price * 3,
        "maxPriorityFeePerGas": w3.eth.gas_price,
        "nonce": nonce,
        "chainId": w3.eth.chain_id,
        "type": 2,
    }
    signed = w3.eth.account.sign_transaction(tx, key)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    return w3.eth.wait_for_transaction_receipt(tx_hash)


def encode_call(sig: str, *args) -> str:
    """Encode a function call: sig like 'transfer(address,uint256)', args as hex/int."""
    selector = Web3.keccak(text=sig)[:4]
    encoded = selector
    for arg in args:
        if isinstance(arg, str) and arg.startswith("0x"):
            encoded += bytes.fromhex(arg[2:].zfill(64))
        elif isinstance(arg, int):
            if arg < 0:
                # two's complement for int256
                encoded += (arg % (2**256)).to_bytes(32, "big")
            else:
                encoded += arg.to_bytes(32, "big")
        elif isinstance(arg, bytes):
            encoded += arg.rjust(32, b'\x00')
        else:
            raise ValueError(f"Unsupported arg type: {type(arg)}")
    return "0x" + encoded.hex()


async def poll_until(conn, query: str, check_fn, desc: str, timeout: float = TIMEOUT) -> float:
    """Poll DB until check_fn(row) is True. Returns elapsed seconds."""
    t0 = time.monotonic()
    while time.monotonic() - t0 < timeout:
        row = await conn.fetchrow(query)
        if check_fn(row):
            elapsed = time.monotonic() - t0
            return elapsed
        await asyncio.sleep(POLL)
    row = await conn.fetchrow(query)
    if check_fn(row):
        return time.monotonic() - t0
    raise AssertionError(f"TIMEOUT ({timeout}s): {desc} — got: {dict(row) if row else None}")


# ── Main ──────────────────────────────────────────────────────────────────────

async def main():
    with open(os.path.normpath(CONFIG_PATH)) as f:
        cfg = json.load(f)

    w3 = Web3(Web3.HTTPProvider(RPC_URL))
    assert w3.is_connected(), "Cannot connect to Anvil"
    log.info("Connected — chain %d, block %d", w3.eth.chain_id, w3.eth.block_number)

    pool = await asyncpg.create_pool(DB_URL, min_size=2, max_size=5)

    # Start background tasks
    ingest = asyncio.create_task(run_ingestor(RPC_URL, os.path.normpath(CONFIG_PATH), 0.3, DB_URL))
    proc = asyncio.create_task(run_processor(pool, 0.2, None))
    await asyncio.sleep(1.0)

    # Addresses
    wausdc = cfg["wausdc"]
    wrlp = cfg.get("position_token", cfg.get("token1", ""))
    market_id = cfg["market_id"]
    broker_factory = cfg["broker_factory"]
    deployer_key = KEYS[0]
    deployer_addr = w3.eth.account.from_key(deployer_key).address
    user_a_key = KEYS[5]
    user_a_addr = w3.eth.account.from_key(user_a_key).address

    # Ensure deployer has ETH
    w3.provider.make_request("anvil_setBalance", [deployer_addr, hex(10**19)])
    w3.provider.make_request("anvil_setBalance", [user_a_addr, hex(10**19)])

    # Snapshot
    async with pool.acquire() as conn:
        brokers = await conn.fetch("SELECT * FROM brokers ORDER BY created_block")
        assert len(brokers) >= 3, f"Need ≥3 brokers, got {len(brokers)}"
        broker_a = brokers[0]["address"]
        broker_c = brokers[2]["address"]
        initial_count = len(brokers)
        initial_wausdc_a = float(brokers[0]["wausdc_balance"] or 0)
        initial_debt_a = float(brokers[0]["debt_principal"] or 0)
        initial_wrlp_a = float(brokers[0]["wrlp_balance"] or 0)
        initial_wrlp_c = float(brokers[2]["wrlp_balance"] or 0)

    results = []

    print()
    print("═" * 80)
    print("  LIVE INDEXER VERIFICATION — RLD operations, 2s latency target")
    print("═" * 80)
    print()

    # ═══════════════════════════════════════════════════════════════════════
    # TEST 1: waUSDC Deposit (ERC20 Transfer → broker)
    # ═══════════════════════════════════════════════════════════════════════
    log.info("T1: waUSDC Deposit — Transfer 1 USDC into Broker A")
    amt = 1_000_000  # 1 USDC (6 dec)
    data = encode_call("transfer(address,uint256)", broker_a, amt)
    rcpt = send_tx(w3, deployer_key, wausdc, data)
    if rcpt["status"] == 1:
        expected = initial_wausdc_a + amt
        async with pool.acquire() as conn:
            try:
                t = await poll_until(conn,
                    f"SELECT wausdc_balance FROM brokers WHERE address = '{broker_a}'",
                    lambda r: r and float(r["wausdc_balance"] or 0) >= expected,
                    "waUSDC balance increased")
                log.info("  ✅ T1 waUSDC deposit — %.2fs", t)
                results.append(("T1 waUSDC deposit", t, True))
            except AssertionError as e:
                log.error("  ❌ T1: %s", e)
                results.append(("T1 waUSDC deposit", TIMEOUT, False))
    else:
        log.warning("  ⏭ T1 skipped — tx reverted (deployer may lack waUSDC)")
        results.append(("T1 waUSDC deposit (reverted)", -1, None))

    # ═══════════════════════════════════════════════════════════════════════
    # TEST 2: Create new Broker via BrokerFactory.createBroker(bytes32)
    # ═══════════════════════════════════════════════════════════════════════
    log.info("T2: Create new Broker")
    salt = Web3.keccak(text=f"test-broker-{int(time.time())}")
    data = encode_call("createBroker(bytes32)", salt)
    rcpt = send_tx(w3, deployer_key, broker_factory, data, gas=1_000_000)
    if rcpt["status"] == 1:
        async with pool.acquire() as conn:
            try:
                t = await poll_until(conn,
                    f"SELECT COUNT(*) as cnt FROM brokers",
                    lambda r: r and r["cnt"] > initial_count,
                    "New broker appeared in DB")
                log.info("  ✅ T2 BrokerCreated — %.2fs", t)
                results.append(("T2 BrokerCreated", t, True))
                # Get the new broker address
                new_broker = await conn.fetchrow(
                    "SELECT address FROM brokers ORDER BY created_block DESC LIMIT 1")
                log.info("  New broker: %s", new_broker["address"] if new_broker else "?")
            except AssertionError as e:
                log.error("  ❌ T2: %s", e)
                results.append(("T2 BrokerCreated", TIMEOUT, False))
    else:
        log.error("  ❌ T2 — createBroker reverted")
        results.append(("T2 BrokerCreated (reverted)", -1, False))

    # ═══════════════════════════════════════════════════════════════════════
    # TEST 3: Borrow — modifyPosition(marketId, 0, +1M) increases debt
    # ═══════════════════════════════════════════════════════════════════════
    log.info("T3: Borrow — modifyPosition(+500k wRLP)")
    borrow_amt = 500_000_000_000  # 500k (6 dec)
    data = encode_call("modifyPosition(bytes32,int256,int256)", market_id, 0, borrow_amt)
    rcpt = send_tx(w3, deployer_key, broker_a, data, gas=500_000)
    if rcpt["status"] == 1:
        expected_debt = initial_debt_a + borrow_amt
        async with pool.acquire() as conn:
            try:
                t = await poll_until(conn,
                    f"SELECT debt_principal FROM brokers WHERE address = '{broker_a}'",
                    lambda r: r and float(r["debt_principal"] or 0) >= expected_debt,
                    f"debt_principal increased to ≥{expected_debt}")
                log.info("  ✅ T3 Borrow — debt increased by 500k — %.2fs", t)
                results.append(("T3 Borrow (debt+500k)", t, True))
            except AssertionError as e:
                log.error("  ❌ T3: %s", e)
                results.append(("T3 Borrow", TIMEOUT, False))
    else:
        log.warning("  ⏭ T3 reverted — broker may lack collateral")
        results.append(("T3 Borrow (reverted)", -1, None))

    # ═══════════════════════════════════════════════════════════════════════
    # TEST 4: Partial Repay — modifyPosition(marketId, 0, -200k)
    # ═══════════════════════════════════════════════════════════════════════
    log.info("T4: Repay — modifyPosition(-200k wRLP)")
    repay_amt = -200_000_000_000  # -200k
    data = encode_call("modifyPosition(bytes32,int256,int256)", market_id, 0, repay_amt)

    # Need to send wRLP to broker for repayment if it doesn't have any
    # First check broker's wRLP on-chain
    wrlp_bal_call = encode_call("balanceOf(address)", broker_a)
    wrlp_on_chain = w3.eth.call({"to": Web3.to_checksum_address(wrlp), "data": wrlp_bal_call})
    wrlp_on_chain_int = int.from_bytes(wrlp_on_chain, "big")
    log.info("  Broker A on-chain wRLP: %d", wrlp_on_chain_int)

    rcpt = send_tx(w3, deployer_key, broker_a, data, gas=500_000)
    if rcpt["status"] == 1:
        # After borrow + repay: debt should be initial + 500k - 200k = initial + 300k
        expected_debt = initial_debt_a + borrow_amt + repay_amt
        async with pool.acquire() as conn:
            try:
                t = await poll_until(conn,
                    f"SELECT debt_principal FROM brokers WHERE address = '{broker_a}'",
                    lambda r: r and abs(float(r["debt_principal"] or 0) - expected_debt) < 1000,
                    f"debt_principal ≈ {expected_debt}")
                actual = await conn.fetchval(f"SELECT debt_principal FROM brokers WHERE address = '{broker_a}'")
                log.info("  ✅ T4 Repay — debt now %s — %.2fs", actual, t)
                results.append(("T4 Repay (debt-200k)", t, True))
            except AssertionError as e:
                log.error("  ❌ T4: %s", e)
                results.append(("T4 Repay", TIMEOUT, False))
    else:
        log.warning("  ⏭ T4 reverted — broker may lack wRLP to repay")
        results.append(("T4 Repay (reverted)", -1, None))

    # ═══════════════════════════════════════════════════════════════════════
    # TEST 5: wRLP Transfer between brokers (broker A → broker C)
    # ═══════════════════════════════════════════════════════════════════════
    log.info("T5: wRLP transfer — Broker A → Broker C")
    # Check if broker A has wRLP to transfer
    async with pool.acquire() as conn:
        curr_wrlp_a = float((await conn.fetchval(
            f"SELECT wrlp_balance FROM brokers WHERE address = '{broker_a}'")) or 0)
    
    if curr_wrlp_a > 0:
        xfer_amt = min(int(curr_wrlp_a * 0.1), 100_000_000_000)  # 10% or 100k max
        # Use anvil impersonation: send tx with unlocked account
        broker_a_cs = Web3.to_checksum_address(broker_a)
        wrlp_cs = Web3.to_checksum_address(wrlp)
        w3.provider.make_request("anvil_setBalance", [broker_a_cs, hex(10**18)])
        w3.provider.make_request("anvil_impersonateAccount", [broker_a_cs])
        data = encode_call("transfer(address,uint256)", broker_c, xfer_amt)
        try:
            tx_hash = w3.eth.send_transaction({
                "from": broker_a_cs,
                "to": wrlp_cs,
                "data": data,
                "gas": 100_000,
            })
            rcpt = w3.eth.wait_for_transaction_receipt(tx_hash)
        except Exception as ex:
            log.warning("  T5 impersonated tx failed: %s", ex)
            rcpt = {"status": 0}
        w3.provider.make_request("anvil_stopImpersonatingAccount", [broker_a_cs])
        
        if rcpt.get("status") == 1:
            async with pool.acquire() as conn:
                try:
                    t = await poll_until(conn,
                        f"SELECT wrlp_balance FROM brokers WHERE address = '{broker_c}'",
                        lambda r: r and float(r["wrlp_balance"] or 0) > initial_wrlp_c,
                        "Broker C wRLP balance increased")
                    log.info("  ✅ T5 wRLP transfer — %.2fs", t)
                    results.append(("T5 wRLP transfer", t, True))
                except AssertionError as e:
                    log.error("  ❌ T5: %s", e)
                    results.append(("T5 wRLP transfer", TIMEOUT, False))
        else:
            log.info("  ⏭ T5 skipped — wRLP transfer tx failed")
            results.append(("T5 wRLP transfer (skip)", -1, None))
    else:
        log.info("  ⏭ T5 skipped — Broker A has no wRLP to transfer")
        results.append(("T5 wRLP transfer (skip)", -1, None))

    # ═══════════════════════════════════════════════════════════════════════
    # TEST 6: Processing drain + zero errors
    # ═══════════════════════════════════════════════════════════════════════
    log.info("T6: Processing drain + error check")
    async with pool.acquire() as conn:
        try:
            t = await poll_until(conn,
                "SELECT COUNT(*) as cnt FROM raw_events WHERE status = 'pending'",
                lambda r: r and r["cnt"] == 0,
                "All events processed")
            log.info("  ✅ T6a drain — %.2fs", t)
            results.append(("T6a Drain", t, True))
        except AssertionError as e:
            log.error("  ❌ T6a: %s", e)
            results.append(("T6a Drain", TIMEOUT, False))

        error_count = await conn.fetchval("SELECT COUNT(*) FROM raw_events WHERE status = 'error'")
        if error_count == 0:
            log.info("  ✅ T6b zero errors")
            results.append(("T6b Zero errors", 0, True))
        else:
            errors = await conn.fetch(
                "SELECT id, topic0, error_msg FROM raw_events WHERE status = 'error' LIMIT 5")
            for e in errors:
                log.error("  ❌ err id=%d: %s", e["id"], (e["error_msg"] or "")[:80])
            results.append(("T6b Zero errors", 0, False))

    # ═══════════════════════════════════════════════════════════════════════
    # RESULTS
    # ═══════════════════════════════════════════════════════════════════════
    print()
    print("═" * 80)
    print("  RESULTS")
    print("═" * 80)
    print()
    print(f"  {'Test':<30} {'Latency':>10} {'Result':>10}")
    print(f"  {'─' * 30} {'─' * 10} {'─' * 10}")

    passed = 0
    failed = 0
    skipped = 0
    for name, lat, ok in results:
        if ok is None:
            skipped += 1
            print(f"  {name:<30} {'skip':>10} {'⏭ SKIP':>10}")
        elif ok:
            passed += 1
            print(f"  {name:<30} {f'{lat:.2f}s':>10} {'✅ PASS':>10}")
        else:
            failed += 1
            lat_s = f"{lat:.2f}s" if lat >= 0 else "N/A"
            print(f"  {name:<30} {lat_s:>10} {'❌ FAIL':>10}")

    print()
    total = passed + failed
    print(f"  PASSED: {passed}/{total}  SKIPPED: {skipped}")
    under_2s = all(0 <= r[1] <= TIMEOUT for r in results if r[2] is True)
    if failed == 0 and under_2s:
        print("  🎉 ALL TESTS PASSED WITHIN 2s LATENCY TARGET")
    elif failed == 0:
        print("  ⚠ All passed but some exceeded 2s")
    else:
        print(f"  ❌ {failed} TESTS FAILED")
    print("═" * 80)

    # Final snapshot
    print()
    async with pool.acquire() as conn:
        brokers = await conn.fetch("SELECT address, debt_principal, wausdc_balance, wrlp_balance, is_liquidated FROM brokers ORDER BY created_block")
        print(f"  FINAL STATE ({len(brokers)} brokers):")
        for b in brokers:
            debt = float(b["debt_principal"] or 0) / 1e6
            wau = float(b["wausdc_balance"] or 0) / 1e6
            wrl = float(b["wrlp_balance"] or 0) / 1e18
            print(f"    {b['address'][:16]}..  waUSDC={wau:>14,.2f}  wRLP={wrl:>12,.6f}  debt={debt:>12,.2f}  liq={b['is_liquidated']}")
    print()

    # Cleanup
    ingest.cancel()
    proc.cancel()
    for t in [ingest, proc]:
        try:
            await t
        except asyncio.CancelledError:
            pass
    await pool.close()
    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    asyncio.run(main())
