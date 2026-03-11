"""
Aave V3 protocol adapter.

Fetches variable borrow rates from the Aave V3 Pool contract
via getReserveData(address asset).
"""

from rates.adapters.base import ProtocolAdapter, RateRecord


# getReserveData(address) function selector
FUNC_SELECTOR = "0x35ea6a75"


def _encode_call_data(asset_address: str) -> str:
    """Build calldata for getReserveData(asset_address)."""
    clean_addr = asset_address[2:] if asset_address.startswith("0x") else asset_address
    return FUNC_SELECTOR + clean_addr.zfill(64)


def _decode_variable_borrow_rate(hex_data: str) -> float | None:
    """Decode currentVariableBorrowRate from getReserveData response.

    The rate is at index 4 (5th 32-byte word) in the returned tuple.
    Raw value is in RAY (1e27), converted to APY percentage.
    """
    try:
        if not hex_data or hex_data == "0x":
            return None
        raw = hex_data[2:] if hex_data.startswith("0x") else hex_data
        # Index 4 = currentVariableBorrowRate (5th field, 0-indexed)
        start = 4 * 64
        end = 5 * 64
        if len(raw) < end:
            return None
        return int(raw[start:end], 16) / 10**27 * 100
    except (ValueError, IndexError):
        return None


class Adapter(ProtocolAdapter):
    """Aave V3 rate adapter — reads variable borrow rates for each asset."""

    def build_rpc_calls(self, block_hex: str) -> list[dict]:
        """Build one eth_call per asset → Aave Pool getReserveData."""
        calls = []
        for symbol, asset_cfg in self.assets.items():
            calls.append({
                "jsonrpc": "2.0",
                "method": "eth_call",
                "params": [
                    {"to": self.pool_address, "data": _encode_call_data(asset_cfg["address"])},
                    block_hex,
                ],
                # ID will be assigned by daemon — use metadata for routing
                "_meta": {"symbol": symbol},
            })
        return calls

    def decode_results(self, results: list[dict]) -> list[RateRecord]:
        """Decode getReserveData responses into RateRecord list."""
        records = []
        for res in results:
            meta = res.get("_meta", {})
            symbol = meta.get("symbol")
            if not symbol:
                continue

            rpc_result = res.get("result")
            if not rpc_result or "error" in res:
                continue

            apy = _decode_variable_borrow_rate(rpc_result)
            if apy is not None:
                records.append(RateRecord(symbol=symbol, apy=apy))

        return records
