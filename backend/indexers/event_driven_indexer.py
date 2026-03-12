"""
Event-Driven Blockchain Indexer — replaces comprehensive.py.

Architecture:
  2 RPC calls per block (header + get_logs), then pure DB projections.
  No per-block state polling. No full-chain log scans.

Processing pipeline per block:
  1. eth_getBlockByNumber(N, full_tx=False)  — timestamp only
  2. eth_getLogs(fromBlock=N, toBlock=N)     — one call for all contracts
  3. BEGIN TX
       For each log:
         a. INSERT INTO events (immutable audit trail)
         b. Route to projection handler (upsert state table)
       UPDATE indexer_state
     COMMIT
"""
import asyncio
import logging
import json
import os
import math
import urllib.request
from typing import Optional, List, Dict, Any, Set

from web3 import Web3

from db.event_driven import (
    get_last_indexed_block, update_last_indexed_block,
    insert_event, write_batch, get_conn,
    upsert_market_meta, upsert_market_state,
    upsert_broker_state, upsert_pool_state,
    upsert_lp_position, update_lp_owner,
    upsert_twamm_order, close_twamm_order,
    upsert_bond, close_bond,
    upsert_candle, upsert_block_state,
)

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────
# Event Topic Map  (computed once at module load — never per-block)
# ──────────────────────────────────────────────────────────────

def _topic(sig: str) -> str:
    return Web3.keccak(text=sig).hex()


# All topics we care about
TOPIC_MAP: Dict[str, str] = {
    _topic("PositionModified(bytes32,address,int256,int256)"):             "PositionModified",
    _topic("FundingApplied(bytes32,int256,uint256)"):                      "FundingApplied",
    _topic("MarketCreated(bytes32,address,address,address)"):              "MarketCreated",
    _topic("Swap(bytes32,address,int128,int128,uint160,uint128,int24)"):   "Swap",
    _topic("ModifyLiquidity(bytes32,address,int24,int24,int256,bytes32)"): "ModifyLiquidity",
    _topic("Transfer(address,address,uint256)"):                           "Transfer_ERC20",
    # ERC721 Transfer has same sig — disambiguated by contract address at parse time
    _topic("SubmitOrder(bytes32,address,OrderKey,uint256,uint256)"):       "SubmitOrder",
    _topic("UpdateOrder(bytes32,address,OrderKey,uint256,uint256)"):       "UpdateOrder",
    _topic("CancelOrder(bytes32,address,OrderKey,uint256,uint256)"):       "CancelOrder",
    _topic("BondMinted(address,address,uint256,uint256,uint256)"):         "BondMinted",
    _topic("BondClosed(address,uint256,uint256)"):                         "BondClosed",
    _topic("BondReturned(address)"):                                       "BondReturned",
    _topic("BondClaimed(address)"):                                        "BondClaimed",
    _topic("BasisTradeOpened(address,address,uint256,uint256,uint256)"):   "BasisTradeOpened",
    _topic("BasisTradeClosed(address,uint256,uint256)"):                   "BasisTradeClosed",
}

# Reverse map for quick name lookup
TOPIC_TO_NAME: Dict[str, str] = TOPIC_MAP

# Events that modify protocol state → trigger block_state write
STATE_CHANGING_EVENTS: Set[str] = {
    "Swap", "ModifyLiquidity",
    "PositionModified", "FundingApplied",
    "MarketCreated",
    "BondMinted", "BondClosed", "BondReturned", "BondClaimed",
    "BasisTradeOpened", "BasisTradeClosed",
    "SubmitOrder", "UpdateOrder", "CancelOrder",
    "Transfer_ERC721",
}


# ──────────────────────────────────────────────────────────────
# Minimal ABIs (only what we need for setup — no per-block eth_calls)
# ──────────────────────────────────────────────────────────────

_DISCOVERY_ABI = [
    {"inputs": [{"name": "id", "type": "bytes32"}], "name": "getMarketAddresses",
     "outputs": [{"components": [
         {"name": "collateralToken", "type": "address"},
         {"name": "underlyingToken", "type": "address"},
         {"name": "underlyingPool", "type": "address"},
         {"name": "rateOracle", "type": "address"},
         {"name": "spotOracle", "type": "address"},
         {"name": "markOracle", "type": "address"},
         {"name": "fundingModel", "type": "address"},
         {"name": "curator", "type": "address"},
         {"name": "liquidationModule", "type": "address"},
         {"name": "positionToken", "type": "address"},
     ], "name": "", "type": "tuple"}],
     "stateMutability": "view", "type": "function"},
    {"inputs": [{"name": "id", "type": "bytes32"}], "name": "getMarketState",
     "outputs": [{"components": [
         {"name": "normalizationFactor", "type": "uint128"},
         {"name": "totalDebt", "type": "uint128"},
         {"name": "lastUpdateTimestamp", "type": "uint48"},
     ], "name": "", "type": "tuple"}],
     "stateMutability": "view", "type": "function"},
]

_ORACLE_ABI = [
    {"inputs": [{"name": "", "type": "address"}, {"name": "", "type": "address"}],
     "name": "getIndexPrice", "outputs": [{"name": "", "type": "uint256"}],
     "stateMutability": "view", "type": "function"},
]

_QUOTER_ABI = [
    {"inputs": [{"components": [
        {"name": "poolKey", "type": "tuple", "components": [
            {"name": "currency0", "type": "address"},
            {"name": "currency1", "type": "address"},
            {"name": "fee", "type": "uint24"},
            {"name": "tickSpacing", "type": "int24"},
            {"name": "hooks", "type": "address"},
        ]},
        {"name": "zeroForOne", "type": "bool"},
        {"name": "exactAmount", "type": "uint128"},
        {"name": "hookData", "type": "bytes"},
    ], "name": "params", "type": "tuple"}],
     "name": "quoteExactInputSingle",
     "outputs": [{"name": "deltaAmounts", "type": "int128[]"},
                 {"name": "gasEstimate", "type": "uint256"}],
     "stateMutability": "nonpayable", "type": "function"},
]


# ──────────────────────────────────────────────────────────────
# Mark Price Helpers
# ──────────────────────────────────────────────────────────────

def _mark_from_sqrt(sqrt_price_x96: int) -> float:
    """Compute mark price from sqrtPriceX96 without any RPC call."""
    if sqrt_price_x96 == 0:
        return 0.0
    raw = (sqrt_price_x96 * sqrt_price_x96 * 10 ** 18) // (2 ** 192)
    return raw / 1e18


# ──────────────────────────────────────────────────────────────
# Event-Driven Indexer
# ──────────────────────────────────────────────────────────────

class EventDrivenIndexer:
    """
    Block-level event-driven indexer.

    Per block: 2 RPC calls (header + get_logs), then pure SQL projections.
    No polling. No full-chain scans. No per-block eth_calls.
    """

    def __init__(
        self,
        rpc_url: str,
        rld_core: str,
        pool_manager: str,
        market_id: str,
        oracle_addr: Optional[str] = None,
        tracked_brokers: Optional[List[str]] = None,
        position_manager_addr: Optional[str] = None,
        twamm_hook_addr: Optional[str] = None,
        bond_factory_addr: Optional[str] = None,
        basis_trade_factory_addr: Optional[str] = None,
        collateral_token: Optional[str] = None,
        position_token: Optional[str] = None,
        quoter_addr: Optional[str] = None,
    ):
        self.w3 = Web3(Web3.HTTPProvider(rpc_url))
        self.rpc_url = rpc_url
        self.running = False

        self.market_id = market_id
        self.market_id_bytes = bytes.fromhex(market_id.replace("0x", ""))

        # Contract objects (only used during bootstrap, never per-block)
        self.rld_core = self.w3.eth.contract(
            address=Web3.to_checksum_address(rld_core),
            abi=_DISCOVERY_ABI,
        )
        self.pool_manager_addr = Web3.to_checksum_address(pool_manager)
        self.oracle_addr = oracle_addr

        # Token addresses (resolved once at startup)
        self.collateral_token = (
            Web3.to_checksum_address(collateral_token) if collateral_token else None
        )
        self.position_token = (
            Web3.to_checksum_address(position_token) if position_token else None
        )

        # Optional periphery addresses (for log filtering)
        self.posm_addr = (
            Web3.to_checksum_address(position_manager_addr) if position_manager_addr else None
        )
        self.twamm_addr = (
            Web3.to_checksum_address(twamm_hook_addr) if twamm_hook_addr else None
        )
        self.bond_factory_addr = (
            Web3.to_checksum_address(bond_factory_addr) if bond_factory_addr else None
        )
        self.basis_factory_addr = (
            Web3.to_checksum_address(basis_trade_factory_addr) if basis_trade_factory_addr else None
        )

        # Quoter (used only for fallback mark price on Swap events)
        self._quoter = None
        if quoter_addr:
            self._quoter = self.w3.eth.contract(
                address=Web3.to_checksum_address(quoter_addr),
                abi=_QUOTER_ABI,
            )

        # Oracle (used only for index price on Swap events)
        self._oracle = None
        if oracle_addr:
            try:
                self._oracle = self.w3.eth.contract(
                    address=Web3.to_checksum_address(oracle_addr),
                    abi=_ORACLE_ABI,
                )
            except Exception:
                pass

        # Tracked brokers (grows as BondMinted events arrive)
        self.tracked_brokers: Set[str] = {
            b.lower() for b in (tracked_brokers or [])
        }

        # Pool ID — resolved lazily from first Swap event
        self.pool_id: Optional[str] = None

        # Build watched-address list for get_logs filter
        self._watched_addresses: List[str] = self._build_watched_addresses(rld_core)

        logger.info("EventDrivenIndexer initialized")
        logger.info(f"  Market: {market_id[:20]}...")
        logger.info(f"  Watching {len(self._watched_addresses)} contract address(es)")

    # ──────────────────────────────────────────────────────────
    # Setup
    # ──────────────────────────────────────────────────────────

    def _build_watched_addresses(self, rld_core: str) -> List[str]:
        addrs = [rld_core, self.pool_manager_addr]
        for a in [self.posm_addr, self.twamm_addr,
                  self.bond_factory_addr, self.basis_factory_addr,
                  self.collateral_token, self.position_token]:
            if a:
                addrs.append(a)
        return [Web3.to_checksum_address(a) for a in addrs if a]

    def bootstrap(self):
        """
        One-time startup: resolve addresses from chain, seed market_meta.
        Called once before the main loop — the only time we use eth_call.
        """
        logger.info("🔍 Bootstrapping market metadata from chain...")
        try:
            addrs = self.rld_core.functions.getMarketAddresses(
                self.market_id_bytes
            ).call()
            state = self.rld_core.functions.getMarketState(
                self.market_id_bytes
            ).call()

            coll = addrs[0]
            pos_tk = addrs[9]

            # Resolve token addresses if not provided
            if not self.collateral_token:
                self.collateral_token = Web3.to_checksum_address(coll)
                self._watched_addresses.append(self.collateral_token)
            if not self.position_token:
                self.position_token = Web3.to_checksum_address(pos_tk)
                self._watched_addresses.append(self.position_token)

            upsert_market_meta(self.market_id, {
                "collateral_token": coll,
                "underlying_token": addrs[1],
                "underlying_pool": addrs[2],
                "rate_oracle": addrs[3],
                "spot_oracle": addrs[4],
                "curator": addrs[7],
                "liquidation_module": addrs[8],
                "position_token": pos_tk,
            })
            # Seed initial state so first API query works immediately
            upsert_market_state(
                self.market_id,
                normalization_factor=state[0],
                total_debt=state[1],
                last_update_ts=state[2],
                block_number=self.w3.eth.block_number,
            )
            logger.info(f"  ✅ Market meta seeded: collateral={coll[:10]}... pos={pos_tk[:10]}...")
        except Exception as e:
            logger.warning(f"  ⚠️  Bootstrap partial failure (non-fatal): {e}")

    # ──────────────────────────────────────────────────────────
    # Block-Time Detection
    # ──────────────────────────────────────────────────────────

    def detect_block_time(self, sample_size: int = 10) -> float:
        """
        Sample the last `sample_size` blocks to compute median block interval.
        Returns the median block time in seconds.

        Chain examples:
          Anvil --block-time 1  → ~1.0s
          Anvil --block-time 5  → ~5.0s
          Mainnet               → ~12.0s
          Optimism              → ~2.0s
        """
        try:
            head = self.w3.eth.block_number
            start = max(1, head - sample_size)
            timestamps = []
            for n in range(start, head + 1):
                b = self.w3.eth.get_block(n)
                timestamps.append(b["timestamp"])

            if len(timestamps) < 2:
                logger.warning("  ⚠️  Not enough blocks to detect block time — using 2s default")
                return 2.0

            intervals = [timestamps[i] - timestamps[i - 1]
                         for i in range(1, len(timestamps))
                         if timestamps[i] > timestamps[i - 1]]

            if not intervals:
                return 2.0

            intervals.sort()
            mid = len(intervals) // 2
            median_interval = (
                intervals[mid] if len(intervals) % 2 == 1
                else (intervals[mid - 1] + intervals[mid]) / 2
            )

            self.detected_block_time = float(median_interval)
            logger.info(
                f"  🕐 Block-time detection: sampled {len(intervals)} intervals, "
                f"median = {self.detected_block_time:.1f}s"
            )
            return self.detected_block_time

        except Exception as e:
            logger.warning(f"  ⚠️  Block-time detection failed ({e}) — using 2s default")
            self.detected_block_time = 2.0
            return 2.0

    def recommended_poll_interval(self) -> int:
        """
        Returns the recommended poll_interval in whole seconds.
        Rule: max(1, floor(block_time * 0.75))
        This guarantees we poll at least once per block without hammering the RPC.
        """
        bt = getattr(self, "detected_block_time", 2.0)
        interval = max(1, int(bt * 0.75))
        logger.info(
            f"  ⏱️  Poll interval: {interval}s  "
            f"(75% of {bt:.1f}s median block time)"
        )
        return interval

    # ──────────────────────────────────────────────────────────
    # Main Loop
    # ──────────────────────────────────────────────────────────

    async def run(self, from_block: int = None, poll_interval: int = 2):
        self.running = True
        self._snapshot_sem = asyncio.Semaphore(2)  # cap concurrent block processing

        if from_block is None:
            from_block = get_last_indexed_block()
            if from_block == 0:
                from_block = self.w3.eth.block_number

        logger.info(
            f"🚀 EventDrivenIndexer starting from block {from_block} "
            f"| poll={poll_interval}s "
            f"| detected_block_time={getattr(self, 'detected_block_time', '?')}s"
        )

        last_block = from_block - 1

        while self.running:
            try:
                current_block = self.w3.eth.block_number
                if current_block > last_block:
                    for block_n in range(last_block + 1, current_block + 1):
                        async with self._snapshot_sem:
                            await asyncio.to_thread(self.process_block, block_n)
                        await asyncio.sleep(0)  # yield to event loop
                    last_block = current_block
                await asyncio.sleep(poll_interval)
            except Exception as e:
                logger.error(f"❌ Indexer loop error: {e}", exc_info=True)
                await asyncio.sleep(poll_interval)

    def stop(self):
        self.running = False

    # ──────────────────────────────────────────────────────────
    # Block Processing — 2 RPC calls, then pure SQL
    # ──────────────────────────────────────────────────────────

    def process_block(self, block_number: int):
        """
        Process a single block.
        RPC: 1x eth_getBlockByNumber (header only) + 1x eth_getLogs.
        Everything else is SQL.
        """
        # ── RPC call 1: block header (timestamp only) ────────
        block = self.w3.eth.get_block(block_number)
        block_ts = block["timestamp"]

        # ── RPC call 2: all logs for watched contracts ────────
        log_filter = {
            "fromBlock": block_number,
            "toBlock": block_number,
            "address": self._watched_addresses,
        }
        raw_logs = self.w3.eth.get_logs(log_filter)

        if raw_logs:
            logger.info(f"📦 Block {block_number} | ts={block_ts} | {len(raw_logs)} log(s)")

        parsed = [self._parse_log(log) for log in raw_logs]
        parsed = [p for p in parsed if p]  # Drop unrecognized

        # ── Single DB transaction for everything in this block ─
        with write_batch() as conn:
            cur = conn.cursor()
            for p in parsed:
                # Audit log (immutable)
                insert_event(
                    block_number, block_ts,
                    p["tx_hash"], p["log_index"],
                    p["event_name"], p["contract_addr"],
                    p.get("market_id"),
                    p.get("data", {}),
                    cur=cur,
                )
                # Route to projection handler
                self._route(p, block_number, block_ts, cur)

            # Block-indexed state log — write if any state-changing event fired
            fired_names = {p["event_name"] for p in parsed}
            if fired_names & STATE_CHANGING_EVENTS:
                self._write_block_state(block_number, block_ts, fired_names, cur)

            update_last_indexed_block(block_number, cur=cur)

    # ──────────────────────────────────────────────────────────
    # Log Parsing
    # ──────────────────────────────────────────────────────────

    def _parse_log(self, log: Dict) -> Optional[Dict]:
        """Decode a raw log into a structured dict. Returns None if unrecognized."""
        topics = log.get("topics", [])
        if not topics:
            return None

        topic0 = topics[0].hex() if isinstance(topics[0], bytes) else topics[0]
        # TOPIC_MAP keys are keccak().hex() — no 0x prefix. Normalize:
        topic0_key = topic0.lstrip("0x") if topic0.startswith("0x") else topic0

        event_name = TOPIC_TO_NAME.get(topic0_key)
        if not event_name:
            return None

        tx_hash = log["transactionHash"].hex() if isinstance(log["transactionHash"], bytes) else log["transactionHash"]
        contract_addr = log["address"].lower()
        data_hex = log.get("data", "0x")
        if isinstance(data_hex, bytes):
            data_hex = "0x" + data_hex.hex()

        result = {
            "tx_hash": tx_hash,
            "log_index": log.get("logIndex", 0),
            "contract_addr": contract_addr,
            "event_name": event_name,
            "raw_topics": [t.hex() if isinstance(t, bytes) else t for t in topics],
            "raw_data": data_hex,
            "data": {},
        }

        try:
            result = self._decode_event(result, topics, data_hex)
        except Exception as e:
            logger.debug(f"Decode error for {event_name}: {e}")

        return result

    def _decode_event(self, base: Dict, topics: list, data_hex: str) -> Dict:
        """Decode event-specific fields from topics and data."""
        name = base["event_name"]
        data = {}

        def _topic_addr(t) -> str:
            raw = t.hex() if isinstance(t, bytes) else t
            return "0x" + raw[-40:]

        def _topic_bytes32(t) -> str:
            raw = t.hex() if isinstance(t, bytes) else t
            return raw if raw.startswith("0x") else "0x" + raw

        def _data_int(hex_str: str, offset: int) -> int:
            clean = hex_str[2:] if hex_str.startswith("0x") else hex_str
            if len(clean) < (offset + 1) * 64:
                return 0
            return int(clean[offset * 64:(offset + 1) * 64], 16)

        def _data_signed(hex_str: str, offset: int) -> int:
            v = _data_int(hex_str, offset)
            # Convert to signed 256-bit
            if v >= (1 << 255):
                v -= 1 << 256
            return v

        if name == "PositionModified":
            # PositionModified(bytes32 indexed id, address indexed user, int256 deltaCollateral, int256 deltaDebt)
            if len(topics) >= 3:
                base["market_id"] = _topic_bytes32(topics[1])
                data["user"] = _topic_addr(topics[2])
                data["delta_collateral"] = _data_signed(data_hex, 0)
                data["delta_debt"] = _data_signed(data_hex, 1)

        elif name == "FundingApplied":
            # FundingApplied(bytes32 indexed id, int256 fundingFee, uint256 newNF)
            if len(topics) >= 2:
                base["market_id"] = _topic_bytes32(topics[1])
                data["funding_fee"] = _data_signed(data_hex, 0)
                data["normalization_factor"] = _data_int(data_hex, 1)

        elif name == "MarketCreated":
            # MarketCreated(bytes32 indexed id, address collateral, address underlying, address pool)
            if len(topics) >= 2:
                base["market_id"] = _topic_bytes32(topics[1])
                data["collateral"] = "0x" + _data_int(data_hex, 0).to_bytes(32, "big").hex()[-40:]
                data["underlying"] = "0x" + _data_int(data_hex, 1).to_bytes(32, "big").hex()[-40:]
                data["pool"] = "0x" + _data_int(data_hex, 2).to_bytes(32, "big").hex()[-40:]

        elif name == "Swap":
            # Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1,
            #      uint160 sqrtPriceX96, uint128 liquidity, int24 tick)
            if len(topics) >= 2:
                pool_id = _topic_bytes32(topics[1])
                data["pool_id"] = pool_id
                if not self.pool_id:
                    self.pool_id = pool_id
                data["sender"] = _topic_addr(topics[2]) if len(topics) >= 3 else ""
                data["sqrt_price_x96"] = str(_data_int(data_hex, 2))
                data["liquidity"] = str(_data_int(data_hex, 3))
                data["tick"] = _data_signed(data_hex, 4)
                sqrt = int(data["sqrt_price_x96"])
                data["mark_price"] = _mark_from_sqrt(sqrt)

        elif name == "ModifyLiquidity":
            # ModifyLiquidity(bytes32 indexed id, address indexed sender,
            #                 int24 tickLower, int24 tickUpper, int256 liquidityDelta, bytes32 salt)
            if len(topics) >= 3:
                pool_id = _topic_bytes32(topics[1])
                data["pool_id"] = pool_id
                if not self.pool_id:
                    self.pool_id = pool_id
                data["sender"] = _topic_addr(topics[2])
                data["tick_lower"] = _data_signed(data_hex, 0)
                data["tick_upper"] = _data_signed(data_hex, 1)
                data["liquidity_delta"] = _data_signed(data_hex, 2)

        elif name in ("Transfer_ERC20",):
            # Disambiguate ERC20 vs ERC721 by data length
            # ERC20 Transfer: from (indexed), to (indexed), value (non-indexed uint256)
            # ERC721 Transfer: from (indexed), to (indexed), tokenId (indexed) — no data
            if len(topics) == 4:
                # ERC721: tokenId is the 4th topic
                base["event_name"] = "Transfer_ERC721"
                data["from"] = _topic_addr(topics[1])
                data["to"] = _topic_addr(topics[2])
                data["token_id"] = int(_topic_bytes32(topics[3]), 16)
                data["contract"] = base["contract_addr"]
            elif len(topics) == 3:
                # ERC20
                data["from"] = _topic_addr(topics[1])
                data["to"] = _topic_addr(topics[2])
                data["value"] = _data_int(data_hex, 0)
                data["contract"] = base["contract_addr"]

        elif name == "BondMinted":
            # BondMinted(address indexed broker, address indexed user, uint notional, uint hedge, uint duration)
            if len(topics) >= 3:
                data["broker"] = _topic_addr(topics[1])
                data["user"] = _topic_addr(topics[2])
                data["notional"] = _data_int(data_hex, 0)
                data["hedge"] = _data_int(data_hex, 1)
                data["duration"] = _data_int(data_hex, 2)

        elif name in ("BondClosed",):
            if len(topics) >= 2:
                data["broker"] = _topic_addr(topics[1])
                data["collateral_returned"] = _data_int(data_hex, 0)
                data["position_returned"] = _data_int(data_hex, 1)

        elif name in ("BondReturned", "BondClaimed"):
            if len(topics) >= 2:
                data["broker"] = _topic_addr(topics[1])

        elif name == "BasisTradeOpened":
            if len(topics) >= 3:
                data["broker"] = _topic_addr(topics[1])
                data["user"] = _topic_addr(topics[2])
                data["notional"] = _data_int(data_hex, 0)
                data["hedge"] = _data_int(data_hex, 1)
                data["duration"] = _data_int(data_hex, 2)

        elif name == "BasisTradeClosed":
            if len(topics) >= 2:
                data["broker"] = _topic_addr(topics[1])
                data["collateral_returned"] = _data_int(data_hex, 0)
                data["position_returned"] = _data_int(data_hex, 1)

        elif name in ("SubmitOrder", "UpdateOrder"):
            if len(topics) >= 3:
                data["pool_id"] = _topic_bytes32(topics[1])
                data["owner"] = _topic_addr(topics[2])
                data["sell_rate"] = _data_int(data_hex, 0)
                data["expiration"] = _data_int(data_hex, 1)

        elif name == "CancelOrder":
            if len(topics) >= 3:
                data["pool_id"] = _topic_bytes32(topics[1])
                data["owner"] = _topic_addr(topics[2])

        base["data"] = data
        return base

    # ──────────────────────────────────────────────────────────
    # Projection Routing
    # ──────────────────────────────────────────────────────────

    def _route(self, event: Dict, block_n: int, block_ts: int, cur):
        """Route a parsed event to the correct projection handler(s)."""
        name = event["event_name"]
        data = event.get("data", {})
        mid = event.get("market_id")

        try:
            if name == "FundingApplied":
                self._on_funding_applied(data, mid, block_n, block_ts, cur)

            elif name == "PositionModified":
                self._on_position_modified(data, mid, block_n, block_ts, cur)

            elif name == "MarketCreated":
                self._on_market_created(data, mid, block_n, block_ts, cur)

            elif name == "Swap":
                self._on_swap(data, block_n, block_ts, cur)

            elif name == "ModifyLiquidity":
                self._on_modify_liquidity(data, block_n, cur)

            elif name == "Transfer_ERC721":
                self._on_erc721_transfer(data, block_n, cur)

            elif name == "Transfer_ERC20":
                self._on_erc20_transfer(data, block_n, cur)

            elif name == "BondMinted":
                self._on_bond_minted(data, event["tx_hash"], block_n, block_ts, cur)

            elif name == "BondClosed":
                self._on_bond_event(data, "closed", event["tx_hash"], block_n, block_ts, cur)

            elif name in ("BondReturned", "BondClaimed"):
                self._on_bond_event(data, name.lower().replace("bond", ""),
                                    event["tx_hash"], block_n, block_ts, cur)

            elif name == "BasisTradeOpened":
                self._on_basis_opened(data, event["tx_hash"], block_n, block_ts, cur)

            elif name == "BasisTradeClosed":
                self._on_bond_event(data, "closed", event["tx_hash"], block_n, block_ts, cur)

            elif name in ("SubmitOrder", "UpdateOrder"):
                self._on_submit_order(data, block_n, cur)

            elif name == "CancelOrder":
                self._on_cancel_order(data, block_n, cur)

        except Exception as e:
            logger.warning(f"  ⚠️  Projection error for {name}: {e}")

    # ──────────────────────────────────────────────────────────
    # Projection Handlers (pure SQL — zero RPC calls)
    # ──────────────────────────────────────────────────────────

    def _on_funding_applied(self, d, market_id, block_n, block_ts, cur):
        if not market_id:
            return
        # FundingApplied carries the new absolute NF — exact state, no drift
        nf = d.get("normalization_factor", 0)
        upsert_market_state(market_id, nf, 0, block_ts, block_n, cur=cur)
        logger.debug(f"   📈 FundingApplied: NF={nf / 1e18:.10f}")

    def _on_position_modified(self, d, market_id, block_n, block_ts, cur):
        user = d.get("user", "").lower()
        if not user:
            return
        delta_coll = d.get("delta_collateral", 0)
        delta_debt = d.get("delta_debt", 0)
        upsert_broker_state(
            user, market_id=market_id,
            debt_delta=delta_debt,
            collateral_delta=delta_coll,
            block_number=block_n, block_ts=block_ts,
            cur=cur,
        )
        logger.debug(f"   👤 PositionModified: user={user[:10]}... dColl={delta_coll} dDebt={delta_debt}")

    def _on_market_created(self, d, market_id, block_n, block_ts, cur):
        if not market_id:
            return
        upsert_market_meta(market_id, {
            "deployment_block": block_n,
            "deployment_ts": block_ts,
        }, cur=cur)
        logger.info(f"   🏪 MarketCreated: {market_id[:20]}...")

    def _on_swap(self, d, block_n, block_ts, cur):
        pool_id = d.get("pool_id", "")
        if not pool_id:
            return
        sqrt = int(d.get("sqrt_price_x96", 0))
        mark = d.get("mark_price") or _mark_from_sqrt(sqrt)
        upsert_pool_state(pool_id, self.market_id, {
            "sqrt_price_x96": sqrt,
            "tick": d.get("tick", 0),
            "liquidity": d.get("liquidity", 0),
            "mark_price": mark,
        }, block_n, cur=cur)
        # index_price captured once per block in _write_block_state via rates-indexer
        upsert_candle(pool_id, block_ts, mark, None, cur=cur)
        logger.debug(f"   💱 Swap: pool={pool_id[:10]}... mark={mark:.4f} tick={d.get('tick')}")

    def _on_modify_liquidity(self, d, block_n, cur):
        """
        ModifyLiquidity → update lp_position_state with signed delta.
        No token_id for PoolManager events — use (sender, pool_id, tick_lower, tick_upper)
        as the natural key by encoding into a synthetic token_id.
        """
        pool_id = d.get("pool_id", "")
        sender = d.get("sender", "").lower()
        tick_lower = d.get("tick_lower", 0)
        tick_upper = d.get("tick_upper", 0)
        delta = d.get("liquidity_delta", 0)

        if not pool_id or not sender:
            return

        # Track broker if not already known
        if sender not in self.tracked_brokers:
            self.tracked_brokers.add(sender)
            upsert_broker_state(sender, self.market_id, block_number=block_n, cur=cur)

        # Synthetic token_id from position key hash
        position_key = f"{sender}:{pool_id}:{tick_lower}:{tick_upper}"
        token_id = abs(hash(position_key)) % (2 ** 31)

        upsert_lp_position(
            token_id=token_id,
            broker_address=sender,
            pool_id=pool_id,
            tick_lower=tick_lower,
            tick_upper=tick_upper,
            liquidity_delta=delta,
            mint_block=block_n if delta > 0 else None,
            block_number=block_n,
            cur=cur,
        )

        # Also update pool liquidity
        upsert_pool_state(pool_id, self.market_id, {
            "sqrt_price_x96": 0,  # not in this event
            "tick": (tick_lower + tick_upper) // 2,
        }, block_n, cur=cur)

        logger.debug(
            f"   📌 ModifyLiquidity: {sender[:10]}... [{tick_lower},{tick_upper}] Δ={delta}"
        )

    def _on_erc721_transfer(self, d, block_n, cur):
        """ERC721 Transfer → update LP position ownership."""
        token_id = d.get("token_id")
        to_addr = d.get("to", "").lower()
        from_addr = d.get("from", "").lower()

        if token_id is None:
            return
        zero = "0x" + "0" * 40

        if from_addr == zero:
            # Mint — register token_id with broker = `to`
            upsert_lp_position(
                token_id=token_id,
                broker_address=to_addr,
                block_number=block_n,
                mint_block=block_n,
                cur=cur,
            )
        elif to_addr == zero:
            # Burn — zero out liquidity
            upsert_lp_position(
                token_id=token_id,
                liquidity_delta=-(2 ** 63),  # effectively drain to 0 (floored at 0 in DB)
                block_number=block_n,
                cur=cur,
            )
        else:
            # Transfer ownership
            update_lp_owner(token_id, to_addr, block_number=block_n, cur=cur)
            if to_addr not in self.tracked_brokers:
                self.tracked_brokers.add(to_addr)
                upsert_broker_state(to_addr, self.market_id, block_number=block_n, cur=cur)

    def _on_erc20_transfer(self, d, block_n, cur):
        """ERC20 Transfer → update broker collateral/position balances."""
        from_addr = d.get("from", "").lower()
        to_addr = d.get("to", "").lower()
        value = d.get("value", 0)
        contract = d.get("contract", "").lower()
        zero = "0x" + "0" * 40

        coll = (self.collateral_token or "").lower()
        pos_tk = (self.position_token or "").lower()

        is_collateral = contract == coll
        is_position = contract == pos_tk

        if not (is_collateral or is_position):
            return

        if value == 0:
            return

        # Outflow from sender
        if from_addr != zero and from_addr in self.tracked_brokers:
            if is_collateral:
                upsert_broker_state(from_addr, collateral_delta=-value,
                                    block_number=block_n, cur=cur)
            elif is_position:
                upsert_broker_state(from_addr, position_delta=-value,
                                    block_number=block_n, cur=cur)

        # Inflow to receiver
        if to_addr != zero and to_addr in self.tracked_brokers:
            if is_collateral:
                upsert_broker_state(to_addr, collateral_delta=value,
                                    block_number=block_n, cur=cur)
            elif is_position:
                upsert_broker_state(to_addr, position_delta=value,
                                    block_number=block_n, cur=cur)

    # ──────────────────────────────────────────────────────
    # Oracle Price from Rates-Indexer (non-blocking, stale flag)
    # ──────────────────────────────────────────────────────

    def _get_index_price_from_rates(self) -> tuple[Optional[float], bool]:
        """
        Query rates-indexer for current index price.
        Returns (price, stale) — stale=True if rates-indexer unreachable.
        Never raises.
        """
        rates_url = os.environ.get("RATES_API_URL", "http://rates-indexer:8081")
        try:
            url = f"{rates_url}/api/rates?symbols=USDC"
            req = urllib.request.Request(url, headers={"Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=2) as resp:
                data = json.loads(resp.read())
                # rates-indexer returns {"USDC": {"apy": ..., "index_price": ...}} or similar
                usdc = data.get("USDC") or data.get("usdc") or {}
                price = usdc.get("index_price") or usdc.get("price")
                if price is not None:
                    return float(price), False
        except Exception:
            pass
        return None, True

    def _write_block_state(self, block_n: int, block_ts: int,
                           fired_events: Set[str], cur) -> None:
        """
        Write one block_state row after a state-changing block.
        Reads projected state from pool_state and market_state (already committed
        within this write_batch transaction via cur).
        """
        import psycopg2.extras
        # Read current pool state from DB (projected by _on_swap / _on_modify_liquidity)
        pool_row = None
        mkt_row = None
        try:
            cur.execute(
                "SELECT sqrt_price_x96, tick, liquidity, mark_price FROM pool_state LIMIT 1"
            )
            pool_row = cur.fetchone()
            cur.execute(
                "SELECT normalization_factor, total_debt FROM market_state LIMIT 1"
            )
            mkt_row = cur.fetchone()
        except Exception:
            pass

        index_price, price_stale = self._get_index_price_from_rates()

        upsert_block_state(
            block_number=block_n,
            block_ts=block_ts,
            normalization_factor=float(mkt_row[0]) / 1e18 if mkt_row and mkt_row[0] else None,
            total_debt=float(mkt_row[1]) if mkt_row and mkt_row[1] else None,
            sqrt_price_x96=int(pool_row[0]) if pool_row and pool_row[0] else None,
            tick=pool_row[1] if pool_row else None,
            liquidity=int(pool_row[2]) if pool_row and pool_row[2] else None,
            mark_price=float(pool_row[3]) if pool_row and pool_row[3] else None,
            index_price=index_price,
            price_stale=price_stale,
            events=sorted(fired_events),
            cur=cur,
        )
        logger.debug(
            f"   📌 block_state N={block_n} events={sorted(fired_events)} "
            f"mark={pool_row[3] if pool_row else None:.4f} "
            f"idx={index_price} stale={price_stale}"
        )

    def _on_bond_minted(self, d, tx_hash, block_n, block_ts, cur):
        broker = d.get("broker", "").lower()
        if not broker:
            return
        self.tracked_brokers.add(broker)
        upsert_bond(broker, {
            "owner": d.get("user", ""),
            "bond_type": "bond",
            "notional": d.get("notional", 0),
            "hedge": d.get("hedge", 0),
            "duration": d.get("duration", 0),
            "open_block": block_n,
            "open_ts": block_ts,
            "open_tx": tx_hash,
        }, cur=cur)
        upsert_broker_state(broker, self.market_id,
                            owner=d.get("user", ""),
                            block_number=block_n, block_ts=block_ts, cur=cur)
        logger.info(f"   🔗 BondMinted: {broker[:10]}... owner={d.get('user', '')[:10]}...")

    def _on_basis_opened(self, d, tx_hash, block_n, block_ts, cur):
        broker = d.get("broker", "").lower()
        if not broker:
            return
        self.tracked_brokers.add(broker)
        upsert_bond(broker, {
            "owner": d.get("user", ""),
            "bond_type": "basis_trade",
            "notional": d.get("notional", 0),
            "hedge": d.get("hedge", 0),
            "duration": d.get("duration", 0),
            "open_block": block_n,
            "open_ts": block_ts,
            "open_tx": tx_hash,
        }, cur=cur)
        upsert_broker_state(broker, self.market_id,
                            owner=d.get("user", ""),
                            block_number=block_n, block_ts=block_ts, cur=cur)

    def _on_bond_event(self, d, status, tx_hash, block_n, block_ts, cur):
        broker = d.get("broker", "").lower()
        if not broker:
            return
        close_bond(
            broker_address=broker,
            status=status,
            block_number=block_n,
            block_ts=block_ts,
            tx_hash=tx_hash,
            collateral_returned=d.get("collateral_returned", 0),
            position_returned=d.get("position_returned", 0),
            cur=cur,
        )
        logger.info(f"   🔓 {status.capitalize()}: {broker[:10]}...")

    def _on_submit_order(self, d, block_n, cur):
        pool_id = d.get("pool_id", "")
        owner = d.get("owner", "").lower()
        order_id = f"{pool_id}:{owner}:{block_n}"
        upsert_twamm_order(order_id, {
            "pool_id": pool_id,
            "owner": owner,
            "sell_rate": d.get("sell_rate", 0),
            "start_epoch": d.get("expiration", 0),
            "open_block": block_n,
        }, cur=cur)

    def _on_cancel_order(self, d, block_n, cur):
        pool_id = d.get("pool_id", "")
        owner = d.get("owner", "").lower()
        order_id = f"{pool_id}:{owner}"
        close_twamm_order(order_id, "cancelled", block_n, cur=cur)

    # ──────────────────────────────────────────────────────────
    # Safe Oracle Call (only on Swap — acceptable 1 extra RPC)
    # ──────────────────────────────────────────────────────────

    def _get_index_price_safe(self) -> Optional[float]:
        """Call oracle for index price. Non-fatal if unavailable."""
        if not self._oracle:
            return None
        try:
            zero = Web3.to_checksum_address("0x" + "0" * 40)
            price = self._oracle.functions.getIndexPrice(zero, zero).call()
            return price / 1e18
        except Exception:
            return None


# ──────────────────────────────────────────────────────────────
# Factory
# ──────────────────────────────────────────────────────────────

def create_indexer_from_config(config: dict) -> EventDrivenIndexer:
    """Create indexer from discovered config dict (output of discover_from_env)."""
    brokers_str = os.environ.get("BROKERS", "")
    brokers = [b.strip() for b in brokers_str.split(",") if b.strip()]

    indexer = EventDrivenIndexer(
        rpc_url=config["rpc_url"],
        rld_core=config["rld_core"],
        pool_manager=config["pool_manager"],
        market_id=config["market_id"],
        oracle_addr=config.get("rate_oracle"),
        tracked_brokers=brokers,
        collateral_token=config.get("collateral_token"),
        position_token=config.get("position_token"),
        twamm_hook_addr=config.get("twamm_hook"),
        bond_factory_addr=os.environ.get("BOND_FACTORY"),
        basis_trade_factory_addr=os.environ.get("BASIS_TRADE_FACTORY"),
        position_manager_addr=os.environ.get("V4_POSITION_MANAGER"),
        quoter_addr=os.environ.get("V4_QUOTER"),
    )
    indexer.bootstrap()
    return indexer
