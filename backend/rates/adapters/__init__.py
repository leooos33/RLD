"""
Protocol adapters for rate indexing.

Each lending protocol gets an adapter module implementing ProtocolAdapter.
The daemon discovers and loads adapters based on config.PROTOCOLS entries.
"""

import importlib
import logging
from rates.adapters.base import ProtocolAdapter

logger = logging.getLogger(__name__)

_adapter_cache: dict[str, ProtocolAdapter] = {}


def get_adapter(protocol_id: str, protocol_config: dict) -> ProtocolAdapter:
    """Load and cache a protocol adapter by its ID.

    Args:
        protocol_id: Key from config.PROTOCOLS (e.g. 'aave_v3')
        protocol_config: The protocol's config dict from PROTOCOLS

    Returns:
        Instantiated ProtocolAdapter subclass
    """
    if protocol_id not in _adapter_cache:
        adapter_name = protocol_config["adapter"]
        try:
            module = importlib.import_module(f"rates.adapters.{adapter_name}")
            adapter_cls = module.Adapter
            _adapter_cache[protocol_id] = adapter_cls(protocol_config)
            logger.info(f"✅ Loaded adapter: {protocol_id} ({adapter_cls.__name__})")
        except (ImportError, AttributeError) as e:
            raise RuntimeError(
                f"Failed to load adapter for protocol '{protocol_id}' "
                f"(module: rates.adapters.{adapter_name}): {e}"
            ) from e

    return _adapter_cache[protocol_id]
