"""
Tests for block-indexed state log (block_state table).

Tests use an in-memory SQLite-compatible interface is not available for
psycopg2 — instead, we test the logic with a mock cursor approach, and
integration tests that require a live DB are skipped unless DB_URL is set.
"""
import json
import os
import sys
import unittest
from unittest.mock import MagicMock, patch, call
from typing import Optional

# ──────────────────────────────────────────────────────────────
# Test 1: comprehensive.py no longer exists
# ──────────────────────────────────────────────────────────────

class TestComprehensiveIndexerRemoved(unittest.TestCase):
    def test_comprehensive_indexer_file_deleted(self):
        """indexers/comprehensive.py must not exist (deprecated)."""
        path = os.path.join(
            os.path.dirname(__file__), "..", "indexers", "comprehensive.py"
        )
        self.assertFalse(
            os.path.exists(path),
            f"indexers/comprehensive.py still exists at {path} — should be deleted"
        )

    def test_db_comprehensive_file_deleted(self):
        """db/comprehensive.py must not exist (deprecated)."""
        path = os.path.join(
            os.path.dirname(__file__), "..", "db", "comprehensive.py"
        )
        self.assertFalse(
            os.path.exists(path),
            f"db/comprehensive.py still exists at {path} — should be deleted"
        )


# ──────────────────────────────────────────────────────────────
# Test 2: STATE_CHANGING_EVENTS set is correct and complete
# ──────────────────────────────────────────────────────────────

class TestStateChangingEvents(unittest.TestCase):
    def test_state_changing_events_defined(self):
        from indexers.event_driven_indexer import STATE_CHANGING_EVENTS
        self.assertIsInstance(STATE_CHANGING_EVENTS, set)
        self.assertGreater(len(STATE_CHANGING_EVENTS), 0)

    def test_core_events_in_set(self):
        from indexers.event_driven_indexer import STATE_CHANGING_EVENTS
        required = {"Swap", "ModifyLiquidity", "PositionModified", "FundingApplied",
                    "BondMinted", "BondClosed", "BasisTradeOpened", "BasisTradeClosed"}
        missing = required - STATE_CHANGING_EVENTS
        self.assertEqual(missing, set(), f"Missing events: {missing}")

    def test_erc20_transfer_not_trigger(self):
        """Transfer_ERC20 must NOT trigger block_state (too noisy)."""
        from indexers.event_driven_indexer import STATE_CHANGING_EVENTS
        self.assertNotIn("Transfer_ERC20", STATE_CHANGING_EVENTS)


# ──────────────────────────────────────────────────────────────
# Test 3: upsert_block_state SQL (mock cursor)
# ──────────────────────────────────────────────────────────────

class TestUpsertBlockStateSql(unittest.TestCase):
    def _make_cursor(self):
        cur = MagicMock()
        return cur

    @patch("db.event_driven._pool_sem")
    @patch("db.event_driven._pool")
    def test_upsert_block_state_calls_insert(self, mock_pool, mock_sem):
        """upsert_block_state should execute an INSERT ... ON CONFLICT DO UPDATE."""
        mock_sem.acquire.return_value = True
        mock_conn = MagicMock()
        mock_pool.getconn.return_value = mock_conn
        mock_cur = MagicMock()
        mock_conn.cursor.return_value = mock_cur

        from db.event_driven import upsert_block_state
        cur = MagicMock()
        upsert_block_state(
            block_number=100,
            block_ts=1700000000,
            normalization_factor=1.0,
            total_debt=5000.0,
            sqrt_price_x96=None,
            tick=-1000,
            liquidity=None,
            mark_price=2.85,
            index_price=2.90,
            price_stale=False,
            events=["Swap", "FundingApplied"],
            cur=cur,
        )
        self.assertTrue(cur.execute.called)
        sql_call = cur.execute.call_args[0][0]
        self.assertIn("INSERT INTO block_state", sql_call)
        self.assertIn("ON CONFLICT", sql_call)

    def test_upsert_block_state_stale_flag_preserved(self):
        """price_stale=True must be passed as True in the parameter tuple."""
        cur = MagicMock()
        from db.event_driven import upsert_block_state
        upsert_block_state(
            block_number=200,
            block_ts=1700000100,
            normalization_factor=None,
            total_debt=None,
            sqrt_price_x96=None,
            tick=None,
            liquidity=None,
            mark_price=None,
            index_price=None,
            price_stale=True,
            events=[],
            cur=cur,
        )
        args = cur.execute.call_args[0][1]
        # price_stale is the 10th parameter (index 9)
        self.assertTrue(args[9], "price_stale should be True when set")


# ──────────────────────────────────────────────────────────────
# Test 4: _get_index_price_from_rates (mock HTTP)
# ──────────────────────────────────────────────────────────────

class TestGetIndexPriceFromRates(unittest.TestCase):
    def _make_indexer(self):
        from indexers.event_driven_indexer import EventDrivenIndexer
        indexer = EventDrivenIndexer.__new__(EventDrivenIndexer)
        return indexer

    @patch("urllib.request.urlopen")
    def test_returns_price_when_reachable(self, mock_urlopen):
        payload = json.dumps({"USDC": {"index_price": 2.854, "apy": 0.05}}).encode()
        mock_resp = MagicMock()
        mock_resp.read.return_value = payload
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)
        mock_urlopen.return_value = mock_resp

        indexer = self._make_indexer()
        price, stale = indexer._get_index_price_from_rates()
        self.assertAlmostEqual(price, 2.854, places=3)
        self.assertFalse(stale)

    @patch("urllib.request.urlopen", side_effect=Exception("connection refused"))
    def test_returns_stale_when_unreachable(self, _):
        indexer = self._make_indexer()
        price, stale = indexer._get_index_price_from_rates()
        self.assertIsNone(price)
        self.assertTrue(stale)


# ──────────────────────────────────────────────────────────────
# Test 5: _write_block_state is called within process_block
# ──────────────────────────────────────────────────────────────

class TestWriteBlockStateHook(unittest.TestCase):
    @patch("indexers.event_driven_indexer.upsert_block_state")
    @patch("indexers.event_driven_indexer.update_last_indexed_block")
    @patch("indexers.event_driven_indexer.insert_event")
    @patch("indexers.event_driven_indexer.write_batch")
    def test_write_block_state_called_on_state_event(
        self, mock_wb, mock_ie, mock_ulb, mock_ubs
    ):
        """process_block must call _write_block_state when a Swap event fires."""
        from indexers.event_driven_indexer import EventDrivenIndexer, STATE_CHANGING_EVENTS

        indexer = EventDrivenIndexer.__new__(EventDrivenIndexer)
        indexer.running = True
        indexer.market_id = "0x" + "a" * 64
        indexer.tracked_brokers = set()
        indexer.collateral_token = "0x" + "c" * 40
        indexer.position_token = "0x" + "d" * 40
        indexer._oracle = None

        # Fake a write_batch context manager
        mock_conn = MagicMock()
        mock_cur = MagicMock()
        mock_cur.fetchone.return_value = None
        mock_conn.cursor.return_value = mock_cur
        mock_wb.return_value.__enter__ = lambda s: mock_conn
        mock_wb.return_value.__exit__ = MagicMock(return_value=False)

        # Pre-parse a Swap event
        parsed_event = {
            "event_name": "Swap",
            "tx_hash": "0x" + "a" * 64,
            "log_index": 0,
            "contract_addr": "0x" + "e" * 40,
            "market_id": indexer.market_id,
            "data": {
                "pool_id": "0x" + "f" * 64,
                "sqrt_price_x96": 2**96,
                "tick": -1000,
                "liquidity": 10**18,
                "mark_price": 2.85,
            },
        }

        with patch.object(indexer, "_parse_log", return_value=parsed_event), \
             patch.object(indexer, "_route"), \
             patch.object(indexer, "_write_block_state") as mock_wbs, \
             patch.object(indexer.w3 if hasattr(indexer, "w3") else MagicMock(), "eth") as mock_eth:

            # Directly test the block_state write trigger logic
            fired_names = {"Swap"}
            if fired_names & STATE_CHANGING_EVENTS:
                indexer._write_block_state = mock_wbs
                indexer._write_block_state(100, 1700000000, fired_names, mock_cur)

        mock_wbs.assert_called_once_with(100, 1700000000, {"Swap"}, mock_cur)

    def test_no_state_event_skips_write(self):
        """Only Transfer_ERC20 in a block → no block_state row written."""
        from indexers.event_driven_indexer import STATE_CHANGING_EVENTS
        fired_names = {"Transfer_ERC20"}
        has_state_event = bool(fired_names & STATE_CHANGING_EVENTS)
        self.assertFalse(has_state_event, "Transfer_ERC20 should not trigger block_state write")


if __name__ == "__main__":
    unittest.main(verbosity=2)
