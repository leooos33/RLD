#!/usr/bin/env python3
"""
Anvil Timestamp Sync Daemon
===========================
Anvil bug: when evm_increaseTime is used with evm_setIntervalMining,
block headers get the jumped timestamps but the EVM TIMESTAMP opcode
returns fork_ts + block_count (ignoring the time jumps).

This daemon continuously calls evm_setNextBlockTimestamp to keep the
EVM execution timestamp in sync with the mined block header timestamp.

Runs as a lightweight background process, polling every ~900ms.
"""

import json
import os
import sys
import time
import urllib.request
import urllib.error

RPC_URL = os.environ.get("RPC_URL", "http://host.docker.internal:8545")
POLL_INTERVAL = float(os.environ.get("POLL_INTERVAL", "0.9"))  # seconds


def rpc_call(method: str, params=None):
    """Make a JSON-RPC call to Anvil."""
    payload = json.dumps({
        "jsonrpc": "2.0",
        "method": method,
        "params": params or [],
        "id": 1,
    }).encode()
    req = urllib.request.Request(
        RPC_URL,
        data=payload,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            return json.loads(resp.read())
    except (urllib.error.URLError, TimeoutError):
        return None


def get_latest_timestamp() -> int | None:
    """Get the latest mined block's header timestamp."""
    result = rpc_call("eth_getBlockByNumber", ["latest", False])
    if result and "result" in result and result["result"]:
        return int(result["result"]["timestamp"], 16)
    return None


def set_next_block_timestamp(ts: int) -> bool:
    """Set the timestamp for the next block to be mined."""
    result = rpc_call("evm_setNextBlockTimestamp", [ts])
    return result is not None and "error" not in result


def main():
    print("⏱  Anvil Timestamp Sync Daemon", flush=True)
    print(f"   RPC: {RPC_URL}", flush=True)
    print(f"   Poll interval: {POLL_INTERVAL}s", flush=True)
    print("", flush=True)

    # Wait for Anvil to become available
    while True:
        ts = get_latest_timestamp()
        if ts is not None:
            print(f"   Connected! Latest block ts: {ts}", flush=True)
            break
        print("   Waiting for Anvil...", flush=True)
        time.sleep(2)

    synced_count = 0
    error_count = 0
    last_log_time = time.time()

    while True:
        try:
            latest_ts = get_latest_timestamp()
            if latest_ts is not None:
                next_ts = latest_ts + 1
                if set_next_block_timestamp(next_ts):
                    synced_count += 1
                else:
                    error_count += 1

            # Log status every 60 seconds
            now = time.time()
            if now - last_log_time >= 60:
                print(
                    f"   [sync] {synced_count} synced, {error_count} errors, "
                    f"latest_ts={latest_ts}",
                    flush=True,
                )
                last_log_time = now

        except Exception as e:
            error_count += 1
            if error_count % 10 == 1:
                print(f"   [error] {e}", flush=True)

        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
