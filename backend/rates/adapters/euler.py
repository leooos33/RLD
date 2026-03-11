"""
Euler protocol adapter — STUB.

Euler V2 uses modular vault architecture for lending.
Implement build_rpc_calls() and decode_results() when ready to index.

Key contracts (Ethereum mainnet):
  - Euler Vault Lens: 0x...  (check docs for current deployment)
  - Each vault has its own interest rate model

Reference:
  - https://docs.euler.finance/
"""

from rates.adapters.base import ProtocolAdapter, RateRecord


class Adapter(ProtocolAdapter):
    """Euler rate adapter — not yet implemented."""

    def build_rpc_calls(self, block_hex: str) -> list[dict]:
        raise NotImplementedError(
            "Euler adapter not yet implemented. "
            "Need to call Euler vault interestRate() or use the Lens contract."
        )

    def decode_results(self, results: list[dict]) -> list[RateRecord]:
        raise NotImplementedError("Euler adapter not yet implemented.")
