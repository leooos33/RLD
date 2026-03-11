"""
Fluid protocol adapter — STUB.

Fluid (formerly Instadapp) uses Vault contracts for lending.
Implement build_rpc_calls() and decode_results() when ready to index.

Key contracts (Ethereum mainnet):
  - Fluid Liquidity: 0x52Aa899454998Be5b000Ad077a46Bbe360F4e497
  - Uses resolver contracts for rate data

Reference:
  - https://docs.fluid.instadapp.io/
"""

from rates.adapters.base import ProtocolAdapter, RateRecord


class Adapter(ProtocolAdapter):
    """Fluid rate adapter — not yet implemented."""

    def build_rpc_calls(self, block_hex: str) -> list[dict]:
        raise NotImplementedError(
            "Fluid adapter not yet implemented. "
            "Need to call Fluid resolver for borrow rates per token."
        )

    def decode_results(self, results: list[dict]) -> list[RateRecord]:
        raise NotImplementedError("Fluid adapter not yet implemented.")
