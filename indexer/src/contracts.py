# RLD Contract Bindings - ABI and Event Decoding
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple
from eth_abi import decode
from web3 import Web3
import json

# Event signatures (keccak256 of event signature)
EVENT_TOPICS = {
    # RLDCore events
    "MarketCreated": Web3.keccak(text="MarketCreated(bytes32,address,address,uint128)").hex(),
    "PositionModified": Web3.keccak(text="PositionModified(bytes32,address,int256,int256)").hex(),
    "FundingApplied": Web3.keccak(text="FundingApplied(bytes32,uint256,uint256,int256,uint256)").hex(),
    "MarketStateUpdated": Web3.keccak(text="MarketStateUpdated(bytes32,uint128,uint128)").hex(),
    "AccountStateHash": Web3.keccak(text="AccountStateHash(bytes32,address,bytes32)").hex(),
    "Liquidated": Web3.keccak(text="Liquidated(bytes32,address,address,uint256,uint256)").hex(),
    
    # PrimeBroker events
    "AccountBalanceChanged": Web3.keccak(text="AccountBalanceChanged(address,address,int256,uint256,bytes32)").hex(),
    "StateAudit": Web3.keccak(text="StateAudit(address,uint256,uint256,uint128,uint256,uint256)").hex(),
    "OperatorUpdated": Web3.keccak(text="OperatorUpdated(address,bool)").hex(),
    
    # Factory events
    "BrokerCreated": Web3.keccak(text="BrokerCreated(address,address,bytes32)").hex(),
}

# Reverse lookup: topic -> event name
TOPIC_TO_EVENT = {v: k for k, v in EVENT_TOPICS.items()}

# Event ABI definitions for decoding
EVENT_ABIS = {
    "FundingApplied": {
        "indexed": [("marketId", "bytes32")],
        "data": [
            ("oldNormFactor", "uint256"),
            ("newNormFactor", "uint256"),
            ("fundingRate", "int256"),
            ("timeDelta", "uint256"),
        ]
    },
    "PositionModified": {
        "indexed": [("marketId", "bytes32"), ("broker", "address")],
        "data": [
            ("deltaCollateral", "int256"),
            ("deltaDebt", "int256"),
        ]
    },
    "MarketStateUpdated": {
        "indexed": [("marketId", "bytes32")],
        "data": [
            ("normalizationFactor", "uint128"),
            ("totalDebt", "uint128"),
        ]
    },
    "StateAudit": {
        "indexed": [("account", "address")],
        "data": [
            ("collateralBalance", "uint256"),
            ("positionBalance", "uint256"),
            ("debtPrincipal", "uint128"),
            ("nav", "uint256"),
            ("blockNumber", "uint256"),
        ]
    },
    "AccountBalanceChanged": {
        "indexed": [("account", "address"), ("token", "address")],
        "data": [
            ("delta", "int256"),
            ("newBalance", "uint256"),
            ("reason", "bytes32"),
        ]
    },
    "Liquidated": {
        "indexed": [("marketId", "bytes32"), ("broker", "address"), ("liquidator", "address")],
        "data": [
            ("collateralSeized", "uint256"),
            ("debtRepaid", "uint256"),
        ]
    },
    "BrokerCreated": {
        "indexed": [("broker", "address"), ("owner", "address")],
        "data": [
            ("marketId", "bytes32"),
        ]
    },
}


@dataclass
class DecodedLog:
    """Decoded event log with typed arguments"""
    event_name: str
    block_number: int
    tx_hash: str
    log_index: int
    contract_address: str
    args: Dict[str, Any]


class EventDecoder:
    """Decode raw logs into typed events"""
    
    def decode_log(self, log: dict) -> Optional[DecodedLog]:
        """Decode a raw log entry"""
        topics = log.get("topics", [])
        if not topics:
            return None
            
        topic0 = topics[0]
        if isinstance(topic0, bytes):
            topic0 = topic0.hex()
        if not topic0.startswith("0x"):
            topic0 = "0x" + topic0
            
        event_name = TOPIC_TO_EVENT.get(topic0)
        if not event_name:
            return None
            
        abi = EVENT_ABIS.get(event_name)
        if not abi:
            return None
            
        args = {}
        
        # Decode indexed parameters from topics
        topic_idx = 1
        for name, type_ in abi["indexed"]:
            if topic_idx < len(topics):
                topic = topics[topic_idx]
                if isinstance(topic, str):
                    topic = bytes.fromhex(topic[2:] if topic.startswith("0x") else topic)
                args[name] = self._decode_value(topic, type_)
                topic_idx += 1
        
        # Decode non-indexed parameters from data
        data = log.get("data", "0x")
        if isinstance(data, str):
            data = bytes.fromhex(data[2:] if data.startswith("0x") else data)
        
        if data and abi["data"]:
            types = [t for _, t in abi["data"]]
            names = [n for n, _ in abi["data"]]
            
            try:
                values = decode(types, data)
                for name, value in zip(names, values):
                    args[name] = value
            except Exception as e:
                print(f"Failed to decode {event_name} data: {e}")
                return None
        
        return DecodedLog(
            event_name=event_name,
            block_number=int(log.get("blockNumber", 0), 16) if isinstance(log.get("blockNumber"), str) else log.get("blockNumber", 0),
            tx_hash=log.get("transactionHash", ""),
            log_index=int(log.get("logIndex", 0), 16) if isinstance(log.get("logIndex"), str) else log.get("logIndex", 0),
            contract_address=log.get("address", ""),
            args=args,
        )
    
    def _decode_value(self, data: bytes, type_: str) -> Any:
        """Decode a single value from bytes"""
        if type_ == "address":
            return Web3.to_checksum_address("0x" + data[-20:].hex())
        elif type_ == "bytes32":
            return "0x" + data.hex()
        elif type_.startswith("uint") or type_.startswith("int"):
            return int.from_bytes(data, "big", signed=type_.startswith("int"))
        elif type_ == "bool":
            return data[-1] != 0
        return data


class RLDCoreContract:
    """Contract bindings for RLDCore"""
    
    def __init__(self, w3: Web3, address: str):
        self.w3 = w3
        self.address = Web3.to_checksum_address(address)
        
    async def get_market_state(self, market_id: bytes) -> dict:
        """Call getMarketState(bytes32)"""
        # ABI-encoded function call
        selector = Web3.keccak(text="getMarketState(bytes32)")[:4]
        data = selector + market_id
        
        result = self.w3.eth.call({
            "to": self.address,
            "data": data.hex()
        })
        
        # Decode MarketState struct
        types = ["uint48", "uint128", "uint128"]
        decoded = decode(types, result)
        
        return {
            "lastUpdateTimestamp": decoded[0],
            "normalizationFactor": decoded[1],
            "totalDebt": decoded[2],
        }
    
    async def get_position(self, market_id: bytes, broker: str) -> dict:
        """Call getPosition(bytes32, address)"""
        selector = Web3.keccak(text="getPosition(bytes32,address)")[:4]
        broker_bytes = bytes.fromhex(broker[2:]).rjust(32, b'\x00')
        data = selector + market_id + broker_bytes
        
        result = self.w3.eth.call({
            "to": self.address,
            "data": data.hex()
        })
        
        types = ["uint128", "uint48"]
        decoded = decode(types, result)
        
        return {
            "debtPrincipal": decoded[0],
            "lastUpdated": decoded[1],
        }


class PrimeBrokerContract:
    """Contract bindings for PrimeBroker"""
    
    def __init__(self, w3: Web3, address: str):
        self.w3 = w3
        self.address = Web3.to_checksum_address(address)
        
    async def get_full_state(self) -> dict:
        """Call getFullState()"""
        selector = Web3.keccak(text="getFullState()")[:4]
        
        result = self.w3.eth.call({
            "to": self.address,
            "data": selector.hex()
        })
        
        # Decode BrokerState struct
        types = [
            "uint256",  # collateralBalance
            "uint256",  # positionBalance
            "uint128",  # debtPrincipal
            "uint256",  # debtValue
            "uint256",  # twammSellOwed
            "uint256",  # twammBuyOwed
            "uint256",  # v4LPValue
            "uint256",  # netAccountValue
            "uint256",  # healthFactor
            "bool",     # isSolvent
        ]
        decoded = decode(types, result)
        
        return {
            "collateralBalance": decoded[0],
            "positionBalance": decoded[1],
            "debtPrincipal": decoded[2],
            "debtValue": decoded[3],
            "twammSellOwed": decoded[4],
            "twammBuyOwed": decoded[5],
            "v4LPValue": decoded[6],
            "netAccountValue": decoded[7],
            "healthFactor": decoded[8],
            "isSolvent": decoded[9],
        }
    
    async def get_net_account_value(self) -> int:
        """Call getNetAccountValue()"""
        selector = Web3.keccak(text="getNetAccountValue()")[:4]
        
        result = self.w3.eth.call({
            "to": self.address,
            "data": selector.hex()
        })
        
        return decode(["uint256"], result)[0]


def get_contract_addresses_from_env() -> Dict[str, str]:
    """Load contract addresses from environment"""
    import os
    return {
        "rld_core": os.getenv("RLD_CORE_ADDRESS", ""),
        "broker_factory": os.getenv("BROKER_FACTORY_ADDRESS", ""),
    }
