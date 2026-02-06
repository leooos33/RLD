# RPC Client with batching and retry logic
import asyncio
import logging
from dataclasses import dataclass
from typing import Any, Dict, List, Optional
import aiohttp

logger = logging.getLogger(__name__)


@dataclass
class RPCError(Exception):
    """RPC call error"""
    code: int
    message: str


class RPCClient:
    """
    Async Ethereum RPC client with batching and retry support.
    """
    
    def __init__(
        self,
        url: str,
        batch_size: int = 100,
        timeout: int = 30,
        max_retries: int = 3,
        retry_delay: float = 1.0,
    ):
        self.url = url
        self.batch_size = batch_size
        self.timeout = timeout
        self.max_retries = max_retries
        self.retry_delay = retry_delay
        self._session: Optional[aiohttp.ClientSession] = None
        self._request_id = 0
    
    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(
                timeout=aiohttp.ClientTimeout(total=self.timeout)
            )
        return self._session
    
    async def close(self):
        if self._session and not self._session.closed:
            await self._session.close()
    
    async def _call(self, method: str, params: List[Any]) -> Any:
        """Single RPC call with retry"""
        self._request_id += 1
        payload = {
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
            "id": self._request_id,
        }
        
        for attempt in range(self.max_retries):
            try:
                session = await self._get_session()
                async with session.post(self.url, json=payload) as resp:
                    data = await resp.json()
                    
                    if "error" in data:
                        raise RPCError(
                            data["error"].get("code", -1),
                            data["error"].get("message", "Unknown error")
                        )
                    
                    return data.get("result")
                    
            except (aiohttp.ClientError, asyncio.TimeoutError) as e:
                if attempt < self.max_retries - 1:
                    logger.warning(f"RPC call failed (attempt {attempt + 1}): {e}")
                    await asyncio.sleep(self.retry_delay * (attempt + 1))
                else:
                    raise
    
    async def _batch_call(self, calls: List[tuple]) -> List[Any]:
        """Batched RPC calls"""
        payloads = []
        for method, params in calls:
            self._request_id += 1
            payloads.append({
                "jsonrpc": "2.0",
                "method": method,
                "params": params,
                "id": self._request_id,
            })
        
        session = await self._get_session()
        async with session.post(self.url, json=payloads) as resp:
            results = await resp.json()
        
        # Sort by ID and extract results
        sorted_results = sorted(results, key=lambda x: x.get("id", 0))
        return [r.get("result") if "result" in r else None for r in sorted_results]
    
    # ==========================================================================
    # Ethereum Methods
    # ==========================================================================
    
    async def eth_block_number(self) -> int:
        """Get current block number"""
        result = await self._call("eth_blockNumber", [])
        return int(result, 16)
    
    async def eth_get_block_by_number(self, block: int, full_tx: bool = False) -> dict:
        """Get block by number"""
        return await self._call("eth_getBlockByNumber", [hex(block), full_tx])
    
    async def eth_get_logs(self, filter_params: dict) -> List[dict]:
        """Get logs matching filter"""
        return await self._call("eth_getLogs", [filter_params])
    
    async def eth_call(self, tx: dict, block: str = "latest") -> str:
        """Execute view call"""
        return await self._call("eth_call", [tx, block])
    
    async def eth_chain_id(self) -> int:
        """Get chain ID"""
        result = await self._call("eth_chainId", [])
        return int(result, 16)
    
    # ==========================================================================
    # Batch Operations
    # ==========================================================================
    
    async def get_blocks_range(self, start: int, end: int) -> List[dict]:
        """Get multiple blocks in batch"""
        calls = [("eth_getBlockByNumber", [hex(n), False]) for n in range(start, end + 1)]
        
        results = []
        for i in range(0, len(calls), self.batch_size):
            batch = calls[i:i + self.batch_size]
            batch_results = await self._batch_call(batch)
            results.extend(batch_results)
        
        return results
    
    async def get_logs_chunked(
        self,
        addresses: List[str],
        from_block: int,
        to_block: int,
        chunk_size: int = 1000
    ) -> List[dict]:
        """Get logs in chunks to avoid RPC limits"""
        all_logs = []
        
        for start in range(from_block, to_block + 1, chunk_size):
            end = min(start + chunk_size - 1, to_block)
            
            logs = await self.eth_get_logs({
                "address": addresses,
                "fromBlock": hex(start),
                "toBlock": hex(end),
            })
            
            all_logs.extend(logs)
        
        return all_logs


class RPCClientWithHistorical(RPCClient):
    """RPC client with historical state query support"""
    
    async def eth_call_at_block(self, tx: dict, block_number: int) -> str:
        """Execute view call at specific block"""
        return await self._call("eth_call", [tx, hex(block_number)])
    
    async def get_storage_at(self, address: str, slot: str, block: int = None) -> str:
        """Get storage at specific slot"""
        block_param = hex(block) if block else "latest"
        return await self._call("eth_getStorageAt", [address, slot, block_param])
