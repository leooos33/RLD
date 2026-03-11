"""
Shared dependencies for the API layer.

Provides DB connections, security helpers, and caching — imported by route modules.
"""

import os
import sqlite3
import logging
from cachetools import TTLCache
from fastapi import HTTPException, Security
from fastapi.security import APIKeyHeader

logger = logging.getLogger(__name__)

# --- Database ---
DB_DIR = os.getenv("DB_DIR", os.path.join(os.path.dirname(__file__), "..", "data"))
CLEAN_DB_PATH = os.path.join(DB_DIR, "clean_rates.db")
RAW_DB_PATH = os.path.join(DB_DIR, "aave_rates.db")


def get_db_connection():
    """Read-only connection to clean_rates.db (hourly aggregated)."""
    conn = sqlite3.connect(f'file:{CLEAN_DB_PATH}?mode=ro', uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def get_raw_db_connection():
    """Read-only connection to aave_rates.db (block-level raw data)."""
    conn = sqlite3.connect(f'file:{RAW_DB_PATH}?mode=ro', uri=True)
    conn.row_factory = sqlite3.Row
    return conn


# --- Security: API Key ---
API_KEY_NAME = "X-API-Key"
api_key_header = APIKeyHeader(name=API_KEY_NAME, auto_error=False)


async def get_api_key(api_key_header: str = Security(api_key_header)):
    expected_key = os.getenv("API_KEY")
    if expected_key:
        if api_key_header != expected_key:
            raise HTTPException(status_code=403, detail="Invalid or Missing API Key")
    return api_key_header


# --- Cache (TTL: 20s, Max: 1000 items) ---
CACHE_STORE = TTLCache(maxsize=1000, ttl=60)


def get_from_cache(key):
    return CACHE_STORE.get(key)


def set_cache(key, val):
    CACHE_STORE[key] = val
