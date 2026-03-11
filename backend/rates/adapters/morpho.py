"""
Morpho protocol adapter — STUB.

Morpho uses a different contract interface for borrow rates.
Implement build_rpc_calls() and decode_results() when ready to index.

Key contracts (Ethereum mainnet):
  - Morpho Blue: 0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb
  - Uses market-specific rate model via IRM contracts

Reference:
  - https://docs.morpho.org/
"""

from rates.adapters.base import ProtocolAdapter, RateRecord


class Adapter(ProtocolAdapter):
    """Morpho rate adapter — not yet implemented."""

    def build_rpc_calls(self, block_hex: str) -> list[dict]:
        raise NotImplementedError(
            "Morpho adapter not yet implemented. "
            "Need to call Morpho Blue market() for each market ID "
            "to get totalBorrow/totalSupply and derive rates from IRM."
        )

    def decode_results(self, results: list[dict]) -> list[RateRecord]:
        raise NotImplementedError("Morpho adapter not yet implemented.")
