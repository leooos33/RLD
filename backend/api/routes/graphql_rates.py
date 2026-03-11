"""
GraphQL schema for the Rates API.

Provides a single-query interface to fetch all rate data at once,
eliminating sequential REST calls from the frontend.

Usage:
    POST /graphql
    {
      rates(symbol: "USDC", limit: 100) { timestamp apy ethPrice }
      ethPrices(limit: 24) { timestamp price }
      latestRates { timestamp usdc dai usdt sofr susde ethPrice }
    }
"""

import logging
from typing import Optional

import strawberry
from strawberry.fastapi import GraphQLRouter

from api.deps import get_db_connection, get_from_cache, set_cache

logger = logging.getLogger(__name__)

MAX_LIMIT = 10000


# ─── Types ──────────────────────────────────────────────────

@strawberry.type
class RatePoint:
    timestamp: int
    apy: Optional[float] = None
    eth_price: Optional[float] = strawberry.field(name="ethPrice", default=None)


@strawberry.type
class EthPricePoint:
    timestamp: int
    price: Optional[float] = None


@strawberry.type
class LatestRates:
    timestamp: int
    usdc: Optional[float] = None
    dai: Optional[float] = None
    usdt: Optional[float] = None
    sofr: Optional[float] = None
    susde: Optional[float] = None
    eth_price: Optional[float] = strawberry.field(name="ethPrice", default=None)


# ─── Resolvers ──────────────────────────────────────────────

SYMBOL_MAP = {
    "USDC": "usdc_rate",
    "DAI": "dai_rate",
    "USDT": "usdt_rate",
    "SOFR": "sofr_rate",
    "sUSDe": "susde_yield",
    "SUSDE": "susde_yield",
}


def _query_rates(
    symbol: str = "USDC",
    limit: int = 500,
    resolution: str = "1H",
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> list[RatePoint]:
    """Resolve rate data from clean_rates.db."""
    limit = min(limit, MAX_LIMIT)
    col = SYMBOL_MAP.get(symbol.upper()) or SYMBOL_MAP.get(symbol)
    if not col:
        return []

    cache_key = f"gql:rates:{symbol}:{resolution}:{limit}:{start_date}:{end_date}"
    cached = get_from_cache(cache_key)
    if cached is not None:
        return cached

    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        buckets = {"5M": 300, "1H": 3600, "4H": 14400, "1D": 86400, "1W": 604800}
        seconds = buckets.get(resolution, 3600)

        if resolution in ("1H", "5M"):
            select = f"timestamp, {col} as apy, eth_price"
            group = ""
        else:
            select = f"MAX(timestamp) as timestamp, AVG({col}) as apy, AVG(eth_price) as eth_price"
            group = f"GROUP BY CAST(timestamp / {seconds} AS INTEGER)"

        query = f"SELECT {select} FROM hourly_stats WHERE timestamp >= 1677801600"
        params = []

        if start_date:
            from datetime import datetime
            dt = datetime.strptime(start_date, "%Y-%m-%d")
            query += " AND timestamp >= ?"
            params.append(int(dt.timestamp()))
        if end_date:
            from datetime import datetime
            dt = datetime.strptime(end_date, "%Y-%m-%d")
            query += " AND timestamp <= ?"
            params.append(int(dt.timestamp()) + 86399)

        query += f" {group} ORDER BY timestamp DESC LIMIT {limit}"

        cursor.execute(query, params)
        rows = cursor.fetchall()
        conn.close()

        results = [
            RatePoint(
                timestamp=r["timestamp"],
                apy=r["apy"] if r["apy"] == r["apy"] else None,  # NaN check
                eth_price=r["eth_price"] if r["eth_price"] and r["eth_price"] == r["eth_price"] else None,
            )
            for r in rows
        ]
        results.sort(key=lambda r: r.timestamp)

        set_cache(cache_key, results)
        return results

    except Exception as e:
        logger.error(f"GraphQL rates error: {e}")
        return []


def _query_eth_prices(
    limit: int = 500,
    resolution: str = "1H",
) -> list[EthPricePoint]:
    """Resolve ETH price data."""
    limit = min(limit, MAX_LIMIT)

    cache_key = f"gql:eth:{resolution}:{limit}"
    cached = get_from_cache(cache_key)
    if cached is not None:
        return cached

    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        buckets = {"1H": 3600, "4H": 14400, "1D": 86400, "1W": 604800}
        seconds = buckets.get(resolution, 3600)

        if resolution == "1H":
            select = "timestamp, eth_price as price"
            group = ""
        else:
            select = f"MAX(timestamp) as timestamp, AVG(eth_price) as price"
            group = f"GROUP BY CAST(timestamp / {seconds} AS INTEGER)"

        query = f"SELECT {select} FROM hourly_stats WHERE timestamp >= 1677801600 {group} ORDER BY timestamp DESC LIMIT {limit}"
        cursor.execute(query)
        rows = cursor.fetchall()
        conn.close()

        results = [
            EthPricePoint(
                timestamp=r["timestamp"],
                price=r["price"] if r["price"] and r["price"] == r["price"] else None,
            )
            for r in rows
        ]
        results.sort(key=lambda r: r.timestamp)

        set_cache(cache_key, results)
        return results

    except Exception as e:
        logger.error(f"GraphQL eth_prices error: {e}")
        return []


def _query_latest() -> Optional[LatestRates]:
    """Resolve the most recent hourly snapshot."""
    cache_key = "gql:latest"
    cached = get_from_cache(cache_key)
    if cached is not None:
        return cached

    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM hourly_stats ORDER BY timestamp DESC LIMIT 1")
        row = cursor.fetchone()
        conn.close()

        if not row:
            return None

        def safe(v):
            if v is None:
                return None
            if isinstance(v, float) and v != v:  # NaN
                return None
            return v

        result = LatestRates(
            timestamp=row["timestamp"],
            usdc=safe(row["usdc_rate"]),
            dai=safe(row["dai_rate"]),
            usdt=safe(row["usdt_rate"]),
            sofr=safe(row["sofr_rate"]),
            susde=safe(row["susde_yield"]),
            eth_price=safe(row["eth_price"]),
        )
        set_cache(cache_key, result)
        return result

    except Exception as e:
        logger.error(f"GraphQL latest error: {e}")
        return None


# ─── Schema ─────────────────────────────────────────────────

@strawberry.type
class Query:
    @strawberry.field(description="Historical lending rates for a given symbol and resolution")
    def rates(
        self,
        symbol: str = "USDC",
        limit: int = 500,
        resolution: str = "1H",
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
    ) -> list[RatePoint]:
        return _query_rates(symbol, limit, resolution, start_date, end_date)

    @strawberry.field(description="Historical ETH/USD prices")
    def eth_prices(
        self,
        limit: int = 500,
        resolution: str = "1H",
    ) -> list[EthPricePoint]:
        return _query_eth_prices(limit, resolution)

    @strawberry.field(description="Latest snapshot of all rates and ETH price")
    def latest_rates(self) -> Optional[LatestRates]:
        return _query_latest()


schema = strawberry.Schema(query=Query)
graphql_router = GraphQLRouter(schema, path="/graphql")
